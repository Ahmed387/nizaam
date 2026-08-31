// Scheduled backup: for each tenant, dump ALL public tables to JSON, upload to storage, record in system_backups.
// Triggered via pg_cron weekly (x-cron-secret header) + manual invocation by admins.
// Strict mode: any table read failure aborts the whole backup and records status = "failed".
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Tables scoped per tenant (they all have a tenant_id column)
const TENANT_TABLES = [
  "advance_payments","advance_requests","advances","ai_ask_log","approval_requests","attachments",
  "attendance","audit_log","bank_accounts","branch_capital_allocations","branch_closures","branch_schedules",
  "branch_users","branches","brands","budgets","capacities","cashier_shifts","categories","chart_of_accounts",
  "colors","contacts","customer_credit_log","depreciation_entries","discount_approval_requests","employees",
  "equity_partners","expenses","fiscal_periods","fixed_assets","health_check_runs","inventory_count_batch_moves",
  "inventory_reservations","inventory_sessions","invoice_items","invoice_payments","invoices","journal_entries",
  "journal_entry_lines","migration_batches","notifications","partner_advances","partner_share_history",
  "partner_transactions","partner_users","payment_installments","payment_plans","payment_transactions",
  "pre_order_transactions","pre_orders","price_audit_log","price_list_items","price_list_sources",
  "product_batches","product_types","products","profiles","profit_distributions","purchase_returns","quotes",
  "return_items","returns","role_permissions","salaries","scheduled_reports","settings","shift_cash_handovers",
  "shift_schedules","shipment_items","shipments","sizes","stock_adjustments","stock_transfers",
  "supplier_payments","transfer_fees","treasury","treasury_transfers","user_permissions","user_presence",
  "user_roles","voucher_categories","voucher_sequences","vouchers",
];

// Tables without a tenant_id column — dumped in full (child/global tables)
const GLOBAL_TABLES = [
  "bank_statement_lines","bank_statements","historical_invoice_items","historical_invoices","historical_vouchers",
  "inventory_adjustments","inventory_session_items","onboarding_progress","owner_expenses_access",
  "owner_personal_deposits","owner_personal_expenses","partner_advance_installments","partner_advance_payments",
  "profit_distribution_lines","purchase_return_items","quote_items","stock_adjustment_items","voucher_attachments",
];

const PAGE = 1000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    let tenantIds: string[] = [];
    let requestedTenant: string | undefined;
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      if (body?.tenant_id) requestedTenant = body.tenant_id;
    } catch { /* ignore */ }

    // ---- Authorization: cron secret (env or DB-stored token) OR an admin JWT ----
    const providedCron = req.headers.get("x-cron-secret");
    let isCron = false;
    if (providedCron) {
      const envSecret = Deno.env.get("CRON_SECRET");
      if (envSecret && providedCron === envSecret) isCron = true;
      if (!isCron) {
        const { data: tok } = await admin
          .from("system_cron_tokens")
          .select("token")
          .eq("name", "scheduled-backup")
          .maybeSingle();
        if (tok?.token && providedCron === tok.token) isCron = true;
      }
    }

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);
      const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claims, error: claimsErr } = await authClient.auth.getClaims(token);
      const callerId = claims?.claims?.sub as string | undefined;
      if (claimsErr || !callerId) return jsonResponse({ error: "Unauthorized" }, 401);

      const { data: adminRoles } = await admin.from("user_roles")
        .select("tenant_id, role").eq("user_id", callerId)
        .in("role", ["admin", "owner", "super_admin"]);
      const adminTenantIds = [...new Set((adminRoles ?? []).map((r: any) => r.tenant_id).filter(Boolean))];
      if (adminTenantIds.length === 0) return jsonResponse({ error: "Forbidden: admin role required" }, 403);
      if (requestedTenant) {
        if (!adminTenantIds.includes(requestedTenant)) return jsonResponse({ error: "Forbidden" }, 403);
        tenantIds = [requestedTenant];
      } else {
        tenantIds = adminTenantIds;
      }
    } else {
      if (requestedTenant) tenantIds = [requestedTenant];
      if (!tenantIds.length) {
        const { data: tenants } = await admin.from("tenants").select("id").eq("is_suspended", false);
        tenantIds = (tenants ?? []).map((t: any) => t.id);
      }
    }

    const results: any[] = [];

    for (const tenantId of tenantIds) {
      const counts: Record<string, number> = {};
      // Serialized chunks — row objects are released after each table (memory management)
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `backup-${stamp}.json`;
      const storagePath = `${tenantId}/${filename}`;
      let bytesWritten = 0;

      const fail = async (message: string) => {
        await admin.from("system_backups").insert({
          tenant_id: tenantId,
          filename,
          size_bytes: 0,
          table_counts: counts,
          status: "failed",
          error: message,
          storage_path: null,
        });
        results.push({ tenant_id: tenantId, status: "failed", error: message });
      };

      // Streaming generator: never keeps more than one page of rows in memory
      async function* jsonChunks(): AsyncGenerator<string> {
        yield `{"tenant_id":${JSON.stringify(tenantId)},"exported_at":${JSON.stringify(new Date().toISOString())},"data":{`;
        let firstTable = true;
        const tables: [string, boolean][] = [
          ...TENANT_TABLES.map((t) => [t, true] as [string, boolean]),
          ...GLOBAL_TABLES.map((t) => [t, false] as [string, boolean]),
        ];
        for (const [table, scoped] of tables) {
          yield `${firstTable ? "" : ","}${JSON.stringify(table)}:[`;
          firstTable = false;
          let from = 0;
          let total = 0;
          while (true) {
            let q = admin.from(table).select("*").range(from, from + PAGE - 1);
            if (scoped) q = q.eq("tenant_id", tenantId);
            const { data, error } = await q;
            if (error) throw new Error(`جدول ${table}: ${error.message}`);
            const rows = data ?? [];
            if (rows.length) {
              const buf: string[] = [];
              for (const r of rows) buf.push(JSON.stringify(r));
              yield (total ? "," : "") + buf.join(",");
              total += rows.length;
              buf.length = 0;
            }
            const len = rows.length;
            rows.length = 0; // release page from memory
            if (len < PAGE) break;
            from += PAGE;
          }
          yield "]";
          counts[table] = total;
        }
        yield "}}";
      }

      let streamError: string | null = null;
      const encoder = new TextEncoder();
      const iterator = jsonChunks()[Symbol.asyncIterator]();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { value, done } = await iterator.next();
            if (done) return controller.close();
            const chunk = encoder.encode(value);
            bytesWritten += chunk.byteLength;
            controller.enqueue(chunk);
          } catch (e: any) {
            streamError = e?.message ?? String(e);
            controller.error(new Error(streamError!));
          }
        },
      });


      let uploadOk = false;
      let uploadErrMsg: string | null = null;
      try {
        const res = await fetch(`${url}/storage/v1/object/system-backups/${storagePath}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "Content-Type": "application/json",
            "x-upsert": "false",
          },
          body,
          // @ts-ignore Deno streaming request body
          duplex: "half",
        });
        uploadOk = res.ok;
        if (!res.ok) uploadErrMsg = `رفع الملف: ${res.status} ${await res.text()}`;
      } catch (e: any) {
        uploadErrMsg = streamError ?? (e?.message ?? String(e));
      }

      if (!uploadOk) {
        // Atomic: remove any partial object and record a failed backup
        try { await admin.storage.from("system-backups").remove([storagePath]); } catch { /* ignore */ }
        await fail(streamError ?? uploadErrMsg ?? "فشل غير معروف");
        continue;
      }

      const bytes = { byteLength: bytesWritten };


      await admin.from("system_backups").insert({
        tenant_id: tenantId,
        filename,
        size_bytes: bytes.byteLength,
        table_counts: counts,
        status: "success",
        error: null,
        storage_path: storagePath,
      });

      // Notify all admins of this tenant with a signed download link (7 days)
      try {
        const { data: adminRoles } = await admin
          .from("user_roles")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .eq("role", "admin");
        const adminIds = Array.from(new Set((adminRoles ?? []).map((r: any) => r.user_id)));

        const { data: signed } = await admin.storage
          .from("system-backups")
          .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
        const downloadUrl = signed?.signedUrl ?? null;

        const totalRows = Object.values(counts).reduce((s: number, n: any) => s + Number(n || 0), 0);
        const sizeKB = (bytes.byteLength / 1024).toFixed(1);

        if (adminIds.length) {
          const rows = adminIds.map((uid) => ({
            user_id: uid,
            tenant_id: tenantId,
            title: "✅ نسخة احتياطية جديدة جاهزة",
            body: `تم إنشاء نسخة احتياطية بنجاح — ${Object.keys(counts).length} جدول • ${totalRows.toLocaleString("en-US")} سجل • ${sizeKB} KB\nالملف: ${filename}${downloadUrl ? `\n\nرابط التنزيل (صالح لمدة 7 أيام):\n${downloadUrl}` : ""}`,
            type: "general",
            link: "/admin/settings?tab=backup",
            related_entity: "system_backups",
          }));
          await admin.from("notifications").insert(rows);
        }
      } catch (e) {
        console.warn("Failed to notify admins:", e);
      }

      // Retention: keep last 12 successful backups per tenant — delete older
      const { data: oldOnes } = await admin
        .from("system_backups")
        .select("id, storage_path")
        .eq("tenant_id", tenantId)
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .range(12, 999);
      if (oldOnes?.length) {
        const paths = oldOnes.map((o: any) => o.storage_path).filter(Boolean);
        if (paths.length) await admin.storage.from("system-backups").remove(paths);
        await admin.from("system_backups").delete().in("id", oldOnes.map((o: any) => o.id));
      }

      results.push({
        tenant_id: tenantId,
        filename,
        size: bytes.byteLength,
        tables: Object.keys(counts).length,
        status: "success",
      });
    }

    const anyFailed = results.some((r) => r.status === "failed");
    return jsonResponse({ ok: !anyFailed, results }, anyFailed ? 500 : 200);
  } catch (e: any) {
    return jsonResponse({ error: e.message ?? String(e) }, 500);
  }
});
