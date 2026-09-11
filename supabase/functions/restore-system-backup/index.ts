// Disaster recovery engine — owner only.
// Reads a .tar.gz produced by `scheduled-backup`, replays it through the
// atomic `restore_tenant_snapshot` database function (triggers disabled inside
// one transaction), then puts the media files back into their buckets.
import { createClient } from "npm:@supabase/supabase-js@2";
import { untar, gunzip } from "../_shared/untar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const CONFIRM_PHRASE = "أوافق على استبدال كافة البيانات الحالية بالنسخة الاحتياطية";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const backupId: string | undefined = body?.backup_id;
    const confirm: string = String(body?.confirm ?? "").trim();
    const dryRun: boolean = body?.dry_run === true;

    if (!backupId) return jsonResponse({ error: "backup_id مطلوب" }, 400);
    if (!dryRun && confirm !== CONFIRM_PHRASE) {
      return jsonResponse({ error: "نص التأكيد غير مطابق" }, 400);
    }

    // ---- Owner-only authorization ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);
    const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = claims?.claims?.sub as string | undefined;
    if (claimsErr || !callerId) return jsonResponse({ error: "Unauthorized" }, 401);

    const { data: roles } = await admin.from("user_roles")
      .select("tenant_id, role").eq("user_id", callerId).in("role", ["owner", "super_admin"]);
    const ownerTenants = [...new Set((roles ?? []).map((r: any) => r.tenant_id).filter(Boolean))];
    if (!ownerTenants.length) {
      return jsonResponse({ error: "الاستعادة مقصورة على المالك فقط" }, 403);
    }

    const { data: backup, error: bErr } = await admin
      .from("system_backups").select("*").eq("id", backupId).maybeSingle();
    if (bErr || !backup) return jsonResponse({ error: "النسخة غير موجودة" }, 404);
    if (!ownerTenants.includes(backup.tenant_id)) return jsonResponse({ error: "Forbidden" }, 403);
    if (!backup.storage_path) return jsonResponse({ error: "لا يوجد ملف لهذه النسخة" }, 400);

    // ---- Read + unpack the archive (gzip or raw tar) ----
    const objectRes = await fetch(`${url}/storage/v1/object/system-backups/${backup.storage_path}`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    if (!objectRes.ok || !objectRes.body) {
      return jsonResponse({ error: `تعذر قراءة ملف النسخة: ${objectRes.status}` }, 500);
    }
    const compressed = await objectRes.bytes();
    const isGzip = compressed.byteLength >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;
    const raw = isGzip
      ? await gunzip(new Response(compressed).body as ReadableStream<Uint8Array>)
      : compressed;
    const entries = untar(raw);

    const manifestEntry = entries.find((e) => e.name === "manifest.json");
    const manifest = manifestEntry
      ? JSON.parse(new TextDecoder().decode(manifestEntry.bytes))
      : null;

    // ---- Build payload from either the legacy data.json or per-table files ----
    const data: Record<string, any[]> = {};
    const legacyEntry = entries.find((e) => e.name === "data.json");
    if (legacyEntry) {
      const payload = JSON.parse(new TextDecoder().decode(legacyEntry.bytes));
      if (payload?.data && typeof payload.data === "object") {
        Object.assign(data, payload.data);
      }
    } else {
      for (const entry of entries) {
        if (!entry.name.startsWith("tables/") || !entry.name.endsWith(".json")) continue;
        const tableName = entry.name.slice("tables/".length, -".json".length);
        data[tableName] = JSON.parse(new TextDecoder().decode(entry.bytes));
      }
    }

    const order: string[] = manifest?.order ?? Object.keys(data);
    const payload = {
      tenant_id: backup.tenant_id,
      exported_at: manifest?.exported_at ?? new Date().toISOString(),
      order,
      data,
    };

    const mediaEntries = entries.filter((e) => e.name.startsWith("media/"));

    // ---- Dry run: just report what the archive holds ----
    if (dryRun) {
      const tableCounts: Record<string, number> = {};
      for (const [k, v] of Object.entries(data)) {
        tableCounts[k] = Array.isArray(v) ? v.length : 0;
      }
      return jsonResponse({
        ok: true, dry_run: true, tenant_id: backup.tenant_id,
        tables: Object.keys(tableCounts).length,
        total_rows: Object.values(tableCounts).reduce((s, n) => s + n, 0),
        media_files: mediaEntries.length,
        counts: tableCounts,
        manifest_matches: manifest
          ? Object.entries(manifest.tables ?? {}).every(([k, v]) => tableCounts[k] === v)
          : null,
      });
    }

    // ---- Atomic restore (single transaction, triggers disabled inside) ----
    const { data: restored, error: rErr } = await admin.rpc("restore_tenant_snapshot", {
      _tenant: backup.tenant_id,
      _payload: payload,
    });
    if (rErr) return jsonResponse({ error: rErr.message }, 500);

    // ---- Media files back into their buckets ----
    let mediaRestored = 0;
    const mediaErrors: string[] = [];
    for (const entry of mediaEntries) {
      const rest = entry.name.slice("media/".length);
      const slash = rest.indexOf("/");
      if (slash < 0) continue;
      const bucket = rest.slice(0, slash);
      const path = rest.slice(slash + 1);
      const { error } = await admin.storage.from(bucket).upload(path, entry.bytes, { upsert: true });
      if (error) mediaErrors.push(`${bucket}/${path}: ${error.message}`);
      else mediaRestored++;
    }

    // ---- Post-restore verification ----
    const verify: Record<string, number> = {};
    for (const table of ["historical_invoices", "historical_vouchers", "owner_personal_expenses", "owner_personal_deposits", "products", "product_batches", "branches"]) {
      const { count } = await admin.from(table).select("id", { count: "exact", head: true })
        .eq("tenant_id", backup.tenant_id);
      verify[table] = count ?? 0;
    }

    return jsonResponse({
      ok: true,
      restored,
      media_restored: mediaRestored,
      media_errors: mediaErrors.slice(0, 20),
      verification: verify,
      manifest: manifest?.tables ?? null,
    });
  } catch (e: any) {
    return jsonResponse({ error: e?.message ?? String(e) }, 500);
  }
});
