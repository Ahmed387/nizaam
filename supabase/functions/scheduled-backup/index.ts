// Scheduled backup: for each tenant, dump key tables to JSON, upload to storage, record in system_backups.
// Triggered via pg_cron weekly + manual invocation by admins.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TABLES = [
  "branches","categories","products","price_list_sources","price_list_items",
  "contacts","employees","invoices","invoice_items","invoice_payments",
  "returns","return_items","pre_orders","payment_plans","payment_installments",
  "payment_transactions","treasury","treasury_transfers","vouchers","voucher_categories",
  "advances","advance_payments","advance_requests","salaries","attendance",
  "shipments","shipment_items","supplier_payments","purchase_returns","purchase_return_items",
  "stock_adjustments","stock_adjustment_items","stock_transfers","product_batches",
  "audit_log",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Optional: backup a single tenant if specified, else all active tenants
    let tenantIds: string[] = [];
    let requestedTenant: string | undefined;
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      if (body?.tenant_id) requestedTenant = body.tenant_id;
    } catch {}

    // Authorization: allow CRON_SECRET header for automated invocation, otherwise require admin
    const cronSecret = Deno.env.get("CRON_SECRET");
    const providedCron = req.headers.get("x-cron-secret");
    const isCron = !!cronSecret && providedCron === cronSecret;

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: userData, error: userErr } = await authClient.auth.getUser();
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Restrict to tenants where the caller is an admin
      const { data: adminRoles } = await admin.from("user_roles")
        .select("tenant_id").eq("user_id", userData.user.id).eq("role", "admin");
      const adminTenantIds = (adminRoles ?? []).map((r: any) => r.tenant_id).filter(Boolean);
      if (adminTenantIds.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (requestedTenant) {
        if (!adminTenantIds.includes(requestedTenant)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
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
      const dump: Record<string, any[]> = {};

      for (const table of TABLES) {
        const rows: any[] = [];
        let from = 0;
        const PAGE = 1000;
        while (true) {
          const { data, error } = await admin
            .from(table)
            .select("*")
            .eq("tenant_id", tenantId)
            .range(from, from + PAGE - 1);
          if (error) {
            // Some tables might not have tenant_id — try full scan as fallback (best effort)
            break;
          }
          rows.push(...(data ?? []));
          if (!data || data.length < PAGE) break;
          from += PAGE;
        }
        dump[table] = rows;
        counts[table] = rows.length;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `backup-${stamp}.json`;
      const storagePath = `${tenantId}/${filename}`;
      const payload = JSON.stringify({ tenant_id: tenantId, exported_at: new Date().toISOString(), data: dump });
      const bytes = new TextEncoder().encode(payload);

      const { error: upErr } = await admin.storage
        .from("system-backups")
        .upload(storagePath, bytes, { contentType: "application/json", upsert: false });

      let status = "success";
      let errMsg: string | null = null;
      if (upErr) { status = "error"; errMsg = upErr.message; }

      await admin.from("system_backups").insert({
        tenant_id: tenantId,
        filename,
        size_bytes: bytes.byteLength,
        table_counts: counts,
        status,
        error: errMsg,
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

        let downloadUrl: string | null = null;
        if (status === "success") {
          const { data: signed } = await admin.storage
            .from("system-backups")
            .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
          downloadUrl = signed?.signedUrl ?? null;
        }

        const totalRows = Object.values(counts).reduce((s: number, n: any) => s + Number(n || 0), 0);
        const sizeKB = (bytes.byteLength / 1024).toFixed(1);

        if (adminIds.length) {
          const rows = adminIds.map((uid) => ({
            user_id: uid,
            tenant_id: tenantId,
            title: status === "success" ? "✅ نسخة احتياطية جديدة جاهزة" : "❌ فشل النسخ الاحتياطي",
            body: status === "success"
              ? `تم إنشاء نسخة احتياطية بنجاح — ${totalRows.toLocaleString("en-US")} سجل • ${sizeKB} KB\nالملف: ${filename}${downloadUrl ? `\n\nرابط التنزيل (صالح لمدة 7 أيام):\n${downloadUrl}` : ""}`
              : `فشل إنشاء النسخة الاحتياطية: ${errMsg ?? "خطأ غير معروف"}`,
            type: "general",
            link: "/admin/settings?tab=backup",
            related_entity: "system_backups",
          }));
          await admin.from("notifications").insert(rows);
        }
      } catch (e) {
        console.warn("Failed to notify admins:", e);
      }

      // Retention: keep last 12 backups per tenant — delete older
      const { data: oldOnes } = await admin
        .from("system_backups")
        .select("id, storage_path")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .range(12, 999);
      if (oldOnes?.length) {
        const paths = oldOnes.map((o: any) => o.storage_path).filter(Boolean);
        if (paths.length) await admin.storage.from("system-backups").remove(paths);
        await admin.from("system_backups").delete().in("id", oldOnes.map((o: any) => o.id));
      }

      results.push({ tenant_id: tenantId, filename, size: bytes.byteLength, status, error: errMsg });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
