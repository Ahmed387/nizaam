// Full disaster-recovery export.
// Builds ONE .tar.gz per tenant containing:
//   data.json      — every public table, strictly filtered to the tenant
//   media/...      — the physical files of the storage buckets
//   manifest.json  — row counts + integrity numbers
// The archive is streamed straight into the private `system-backups` bucket and
// then mirrored to Google Drive with an in-place `files.update` when configured.
import { createClient } from "npm:@supabase/supabase-js@2";
import { tarHeader, tarPadding, TAR_END, gzipStream } from "../_shared/tarGzip.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const PAGE = 1000;
const MEDIA_BUCKETS = ["product-images", "employee-cards", "voucher-attachments", "attachments"];
const MEDIA_BUDGET_BYTES = 250 * 1024 * 1024; // guard against Edge Function timeouts
const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const DRIVE_FILE_NAME = "AL_SHOROUK_ERP_MASTER_BACKUP.tar.gz";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ManifestRow = { ord: number; table_name: string; scope: "tenant" | "global"; filter_sql: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    let requestedTenant: string | undefined;
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      if (body?.tenant_id) requestedTenant = body.tenant_id;
    } catch { /* ignore */ }

    // ---- Authorization: cron secret OR an owner / super_admin JWT (admins are blocked) ----
    const providedCron = req.headers.get("x-cron-secret");
    let isCron = false;
    if (providedCron) {
      const envSecret = Deno.env.get("CRON_SECRET");
      if (envSecret && providedCron === envSecret) isCron = true;
      if (!isCron) {
        const { data: tok } = await admin
          .from("system_cron_tokens").select("token").eq("name", "scheduled-backup").maybeSingle();
        if (tok?.token && providedCron === tok.token) isCron = true;
      }
    }

    let tenantIds: string[] = [];
    if (!isCron) {
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
      if (ownerTenants.length === 0) {
        return jsonResponse({ error: "النسخ الاحتياطي مقصور على المالك فقط" }, 403);
      }
      if (requestedTenant) {
        if (!ownerTenants.includes(requestedTenant)) return jsonResponse({ error: "Forbidden" }, 403);
        tenantIds = [requestedTenant];
      } else {
        tenantIds = ownerTenants;
      }
    } else {
      if (requestedTenant) tenantIds = [requestedTenant];
      if (!tenantIds.length) {
        const { data: tenants } = await admin.from("tenants").select("id").eq("is_suspended", false);
        tenantIds = (tenants ?? []).map((t: any) => t.id);
      }
    }

    // ---- Single source of truth for the table list + topological order ----
    const { data: manifestRows, error: manErr } = await admin.rpc("backup_table_manifest");
    if (manErr) throw new Error(`فهرس الجداول: ${manErr.message}`);
    // كل الجداول تُنسخ: المرتبطة بالشركة بفلترتها، والجداول العامة (الأرشيف التاريخي وسجلات المالك) بالكامل
    const tables = (manifestRows as ManifestRow[]).slice().sort((a, b) => a.ord - b.ord);

    const results: any[] = [];

    for (const tenantId of tenantIds) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `backup-${stamp}.tar.gz`;
      const storagePath = `${tenantId}/${filename}`;
      const counts: Record<string, number> = {};
      const media: { bucket: string; path: string; size: number }[] = [];
      let bytesWritten = 0;

      const fail = async (message: string) => {
        await admin.from("system_backups").insert({
          tenant_id: tenantId, filename, size_bytes: 0, table_counts: counts,
          status: "failed", error: message, storage_path: null,
        });
        await admin.from("backup_settings").upsert(
          { tenant_id: tenantId, last_error: message }, { onConflict: "tenant_id" },
        );
        results.push({ tenant_id: tenantId, status: "failed", error: message });
      };

      const enc = new TextEncoder();

      async function* archiveChunks(): AsyncGenerator<Uint8Array> {
        // ---------- 1) data.json (buffered per entry, tar needs the size up front) ----------
        const parts: Uint8Array[] = [];
        let dataSize = 0;
        const push = (s: string) => { const b = enc.encode(s); parts.push(b); dataSize += b.byteLength; };

        push(`{"tenant_id":${JSON.stringify(tenantId)},"exported_at":${JSON.stringify(new Date().toISOString())},"order":${JSON.stringify(tables.map((t) => t.table_name))},"data":{`);
        let first = true;
        for (const t of tables) {
          push(`${first ? "" : ","}${JSON.stringify(t.table_name)}:[`);
          first = false;
          let offset = 0;
          let total = 0;
          while (true) {
            const { data, error } = await admin.rpc("backup_fetch_page", {
              _table: t.table_name, _tenant: tenantId, _offset: offset, _limit: PAGE,
            });
            if (error) throw new Error(`جدول ${t.table_name}: ${error.message}`);
            const rows = (data ?? []) as any[];
            if (rows.length) {
              const buf: string[] = [];
              for (const r of rows) buf.push(JSON.stringify(r));
              push((total ? "," : "") + buf.join(","));
              total += rows.length;
            }
            if (rows.length < PAGE) break;
            offset += PAGE;
          }
          push("]");
          counts[t.table_name] = total;
        }
        push("}}");

        yield tarHeader("data.json", dataSize);
        for (const p of parts) yield p;
        parts.length = 0;
        yield tarPadding(dataSize);

        // ---------- 2) media files ----------
        let mediaBytes = 0;
        for (const bucket of MEDIA_BUCKETS) {
          // شركة واحدة ⇒ نمسح الحاوية بالكامل؛ عدة شركات ⇒ مجلد الشركة فقط لمنع التسريب
          const queue: string[] = [tenantIds.length === 1 ? "" : tenantId];
          while (queue.length) {
            const prefix = queue.shift()!;
            const { data: entries, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
            if (error) break; // bucket may not exist — media is best-effort, data is not
            for (const e of entries ?? []) {
              const full = prefix ? `${prefix}/${e.name}` : e.name;
              if (!e.id) { queue.push(full); continue; } // folder
              if (mediaBytes >= MEDIA_BUDGET_BYTES) continue;
              const { data: file, error: dErr } = await admin.storage.from(bucket).download(full);
              if (dErr || !file) continue;
              const bytes = new Uint8Array(await file.arrayBuffer());
              mediaBytes += bytes.byteLength;
              media.push({ bucket, path: full, size: bytes.byteLength });
              yield tarHeader(`media/${bucket}/${full}`, bytes.byteLength);
              yield bytes;
              yield tarPadding(bytes.byteLength);
            }
          }
        }

        // ---------- 3) manifest.json ----------
        const manifest = enc.encode(JSON.stringify({
          tenant_id: tenantId,
          exported_at: new Date().toISOString(),
          format: "nizam-backup/1",
          tables: counts,
          total_rows: Object.values(counts).reduce((s, n) => s + n, 0),
          media_files: media.length,
          media_bytes: mediaBytes,
          media_truncated: mediaBytes >= MEDIA_BUDGET_BYTES,
          media_index: media,
        }, null, 2));
        yield tarHeader("manifest.json", manifest.byteLength);
        yield manifest;
        yield tarPadding(manifest.byteLength);

        yield TAR_END;
      }

      let streamError: string | null = null;
      let uploadOk = false;
      let uploadErr: string | null = null;

      // محاولتان: أخطاء الشبكة العابرة أثناء الرفع المتدفق لا يجوز أن تُفشل النسخة
      for (let attempt = 1; attempt <= 2 && !uploadOk; attempt++) {
        streamError = null;
        bytesWritten = 0;
        for (const k of Object.keys(counts)) delete counts[k];
        media.length = 0;

        const source = archiveChunks();
        const counted = (async function* () {
          try {
            for await (const chunk of source) { bytesWritten += chunk.byteLength; yield chunk; }
          } catch (e: any) { streamError = e?.message ?? String(e); throw e; }
        })();

        try {
          const res = await fetch(`${url}/storage/v1/object/system-backups/${storagePath}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
              "Content-Type": "application/gzip",
              "x-upsert": "true",
            },
            body: gzipStream(counted),
            // @ts-ignore Deno streaming request body
            duplex: "half",
          });
          uploadOk = res.ok;
          if (!res.ok) uploadErr = `رفع الملف: ${res.status} ${await res.text()}`;
        } catch (e: any) {
          uploadErr = streamError ?? (e?.message ?? String(e));
        }
        if (streamError) break; // خطأ في البيانات نفسها — لا فائدة من الإعادة
      }

      if (!uploadOk) {
        try { await admin.storage.from("system-backups").remove([storagePath]); } catch { /* ignore */ }
        await fail(streamError ?? uploadErr ?? "فشل غير معروف");
        continue;
      }

      const { data: inserted } = await admin.from("system_backups").insert({
        tenant_id: tenantId,
        filename,
        size_bytes: bytesWritten,
        table_counts: counts,
        status: "success",
        error: null,
        storage_path: storagePath,
      }).select("id").maybeSingle();

      // ---------- 4) Google Drive in-place sync ----------
      let drive: { synced: boolean; error?: string } = { synced: false };
      try {
        drive = await syncToDrive(admin, url, serviceKey, tenantId, storagePath);
      } catch (e: any) {
        drive = { synced: false, error: e?.message ?? String(e) };
      }

      await notifyOwners(admin, tenantId, filename, counts, bytesWritten, drive);

      // Retention: keep the last 12 successful backups per tenant
      const { data: oldOnes } = await admin
        .from("system_backups").select("id, storage_path")
        .eq("tenant_id", tenantId).eq("status", "success")
        .order("created_at", { ascending: false }).range(12, 999);
      if (oldOnes?.length) {
        const paths = oldOnes.map((o: any) => o.storage_path).filter(Boolean);
        if (paths.length) await admin.storage.from("system-backups").remove(paths);
        await admin.from("system_backups").delete().in("id", oldOnes.map((o: any) => o.id));
      }

      results.push({
        tenant_id: tenantId, backup_id: inserted?.id, filename,
        size: bytesWritten, tables: Object.keys(counts).length,
        rows: Object.values(counts).reduce((s, n) => s + n, 0),
        media: media.length, drive, status: "success",
      });
    }

    const anyFailed = results.some((r) => r.status === "failed");
    return jsonResponse({ ok: !anyFailed, results }, anyFailed ? 500 : 200);
  } catch (e: any) {
    return jsonResponse({ error: e.message ?? String(e) }, 500);
  }
});

// ---------------------------------------------------------------- Drive sync
async function syncToDrive(
  admin: any, url: string, serviceKey: string, tenantId: string, storagePath: string,
): Promise<{ synced: boolean; error?: string; file_id?: string }> {
  const { data: settings } = await admin
    .from("backup_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!settings?.drive_connected) return { synced: false };

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const connectionKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");
  if (!lovableKey || !connectionKey) {
    return { synced: false, error: "لم يتم ربط Google Drive بعد" };
  }
  const gwHeaders = { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": connectionKey };

  // Stream the archive straight from storage into Drive — never buffered here.
  const objectRes = await fetch(`${url}/storage/v1/object/system-backups/${storagePath}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  if (!objectRes.ok || !objectRes.body) {
    return { synced: false, error: `تعذر قراءة ملف النسخة: ${objectRes.status}` };
  }

  let fileId: string | null = settings.drive_file_id ?? null;

  // In-place update when we already own a file, otherwise create it once.
  const doUpload = async (id: string | null) => {
    const endpoint = id
      ? `${GATEWAY}/upload/drive/v3/files/${id}?uploadType=media&supportsAllDrives=true`
      : `${GATEWAY}/upload/drive/v3/files?uploadType=media&supportsAllDrives=true`;
    return await fetch(endpoint, {
      method: id ? "PATCH" : "POST",
      headers: { ...gwHeaders, "Content-Type": "application/gzip" },
      body: objectRes.body,
      // @ts-ignore Deno streaming request body
      duplex: "half",
    });
  };

  let res = await doUpload(fileId);
  if (!res.ok && fileId) {
    // The remembered file is gone — fall back to creating a fresh one.
    fileId = null;
    const retry = await fetch(`${url}/storage/v1/object/system-backups/${storagePath}`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    res = await fetch(`${GATEWAY}/upload/drive/v3/files?uploadType=media&supportsAllDrives=true`, {
      method: "POST",
      headers: { ...gwHeaders, "Content-Type": "application/gzip" },
      body: retry.body,
      // @ts-ignore Deno streaming request body
      duplex: "half",
    });
  }
  if (!res.ok) {
    const detail = await res.text();
    const message = `Google Drive [${res.status}]: ${detail}`;
    await admin.from("backup_settings").update({ last_error: message }).eq("tenant_id", tenantId);
    return { synced: false, error: message };
  }

  const created = await res.json().catch(() => ({}));
  const newId = created?.id ?? fileId;

  // Name + parent folder are metadata — set them on the same file id.
  if (newId) {
    const meta: Record<string, unknown> = { name: settings.drive_file_name || DRIVE_FILE_NAME };
    const query = !fileId && settings.drive_folder_id
      ? `?addParents=${encodeURIComponent(settings.drive_folder_id)}&supportsAllDrives=true`
      : "?supportsAllDrives=true";
    await fetch(`${GATEWAY}/drive/v3/files/${newId}${query}`, {
      method: "PATCH",
      headers: { ...gwHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
  }

  await admin.from("backup_settings").upsert({
    tenant_id: tenantId,
    drive_file_id: newId,
    drive_connected: true,
    last_synced_at: new Date().toISOString(),
    last_error: null,
  }, { onConflict: "tenant_id" });

  return { synced: true, file_id: newId };
}

// --------------------------------------------------------- Owner notification
async function notifyOwners(
  admin: any, tenantId: string, filename: string,
  counts: Record<string, number>, size: number,
  drive: { synced: boolean; error?: string },
) {
  try {
    const { data: roles } = await admin
      .from("user_roles").select("user_id")
      .eq("tenant_id", tenantId).in("role", ["owner", "super_admin"]);
    const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
    if (!ids.length) return;

    const rows = Object.values(counts).reduce((s: number, n: any) => s + Number(n || 0), 0);
    const sizeMB = (size / (1024 * 1024)).toFixed(1);
    const driveLine = drive.synced
      ? "تمت المزامنة مع Google Drive بنجاح."
      : drive.error
        ? `تعذّرت المزامنة مع Google Drive: ${drive.error}`
        : "لم يتم ربط Google Drive.";

    // No download links inside notifications — the file stays owner-gated.
    await admin.from("notifications").insert(ids.map((uid) => ({
      user_id: uid,
      tenant_id: tenantId,
      title: drive.synced ? "✅ نسخة احتياطية جديدة وتمت مزامنتها" : "✅ نسخة احتياطية جديدة",
      body: `${Object.keys(counts).length} جدول • ${rows.toLocaleString("en-US")} سجل • ${sizeMB} MB\nالملف: ${filename}\n${driveLine}`,
      type: "general",
      link: "/admin/settings?tab=backup",
      related_entity: "system_backups",
    })));
  } catch (e) {
    console.warn("notify owners failed:", e);
  }
}
