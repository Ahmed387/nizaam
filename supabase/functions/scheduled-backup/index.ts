// Full disaster-recovery export.
// Builds ONE .tar per tenant containing:
//   tables/{name}.json — one JSON array per public table, strictly filtered to the tenant
//   media/...          — the physical files of the storage buckets
//   manifest.json      — row counts + integrity numbers
// The archive is streamed straight into the private `system-backups` bucket and
// then mirrored to Google Drive with an in-place `files.update` when configured.
import { createClient } from "npm:@supabase/supabase-js@2";
import { tarHeader, tarPadding, TAR_END } from "../_shared/tarGzip.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const PAGE = 2000; // دفعات كبيرة لتقليل عدد النداءات
const RPC_RETRIES = 3;
const RPC_RETRY_DELAY_MS = 800;
const MEDIA_BUCKETS = ["product-images", "employee-cards", "voucher-attachments", "attachments"];
const MEDIA_BUDGET_BYTES = 120 * 1024 * 1024; // guard against Edge Function timeouts
const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const DRIVE_FILE_NAME = "A&N.tar";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rpcWithRetry<T = any>(
  client: any,
  fn: string,
  args: Record<string, unknown>,
  context: string,
): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= RPC_RETRIES; attempt++) {
    try {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw error;
      return (data ?? []) as T;
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message ?? String(e);
      console.warn(`rpc retry ${attempt}/${RPC_RETRIES} ${fn} (${context}): ${msg}`);
      if (attempt < RPC_RETRIES) await sleep(RPC_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

// جلب النتيجة كـ JSON خام دون تحليلها/إعادة تسلسلها لتوفير استهلاك CPU
async function fetchPageRaw(
  url: string, serviceKey: string, fn: string, args: Record<string, unknown>, context: string,
): Promise<string> {
  let lastErr: any;
  for (let attempt = 1; attempt <= RPC_RETRIES; attempt++) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return await res.text();
    } catch (e: any) {
      lastErr = e;
      console.warn(`raw rpc retry ${attempt}/${RPC_RETRIES} ${fn} (${context}): ${e?.message ?? String(e)}`);
      if (attempt < RPC_RETRIES) await sleep(RPC_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function concatArrays(arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.byteLength;
  }
  return out;
}

type ManifestRow = { ord: number; table_name: string; scope: "tenant" | "global"; filter_sql: string };

// Storage refuses objects above the project's upload limit (50 MB on the free plan), and the audit log
// alone is bigger than that as JSON. Staged parts and the final archive are therefore gzip-compressed
// (JSON shrinks ~10×). restore-system-backup already reads both .tar and .tar.gz.
async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    let requestedTenant: string | undefined;
    let ensureFolderOnly = false;
    let mode: string | undefined;
    let jobId: string | undefined;
    let partTable: string | undefined;
    let clientCounts: Record<string, number> | undefined;
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      if (body?.tenant_id) requestedTenant = body.tenant_id;
      if (body?.ensure_folder_only) ensureFolderOnly = true;
      if (typeof body?.mode === "string") mode = body.mode;
      if (typeof body?.job_id === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(body.job_id)) jobId = body.job_id;
      if (typeof body?.table === "string") partTable = body.table;
      if (body?.counts && typeof body.counts === "object") clientCounts = body.counts;
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

    // ---- Drive-folder-only mode (manual activation from BackupTab) ----
    if (ensureFolderOnly) {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      const connectionKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");
      if (!lovableKey || !connectionKey) {
        return jsonResponse({ error: "لم يتم ربط Google Drive بعد" }, 400);
      }
      const gwHeaders = { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": connectionKey };
      const folders: any[] = [];
      for (const tenantId of tenantIds) {
        const { data: settings } = await admin.from("backup_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
        const folder = await ensureDriveFolder(admin, tenantId, settings ?? {}, gwHeaders);
        folders.push({ tenant_id: tenantId, ...folder });
      }
      const anyError = folders.some((f) => f.error);
      return jsonResponse({ ok: !anyError, folders }, anyError ? 500 : 200);
    }

    let stagedJobDir: string | null = null;
    let stagedCounts: Record<string, number> = {};

    // ---- Single source of truth for the table list + topological order ----
    const { data: manifestRows, error: manErr } = await admin.rpc("backup_table_manifest");
    if (manErr) throw new Error(`فهرس الجداول: ${manErr.message}`);
    const tables = (manifestRows as ManifestRow[]).slice().sort((a, b) => a.ord - b.ord);

    // تحديد عمود الترتيب لكل جدول مرة واحدة فقط — لا نفحص pg_attribute في كل صفحة
    const orderByMap = new Map<string, string>();
    const tableNames = tables.map((t) => t.table_name);
    const { data: ctidInfo, error: ctidErr } = await admin.rpc("backup_table_ctid_check", {
      _tables: tableNames,
    });
    if (!ctidErr && Array.isArray(ctidInfo)) {
      for (const row of ctidInfo) {
        if (row?.table_name) orderByMap.set(row.table_name, row.has_ctid ? "x.ctid" : "1");
      }
    }

    // ---- Staged (chunked) mode: the browser drives one small step per call ----
    if (mode && mode !== "full") {
      if (tenantIds.length !== 1) return jsonResponse({ error: "حدد شركة واحدة للنسخ المرحلي" }, 400);
      const tenantId = tenantIds[0];
      if (mode === "plan") {
        // Big tables come as 16 pieces «<table>#<hex>» (backup_part_list, migration 0104).
        const { data: partRows, error: plErr } = await admin.rpc("backup_part_list");
        const names = !plErr && Array.isArray(partRows) && partRows.length
          ? (partRows as { table_name: string }[]).map((p) => p.table_name)
          : tables.map((t) => t.table_name);
        return jsonResponse({ ok: true, job_id: crypto.randomUUID(), tables: names });
      }
      if (!jobId) return jsonResponse({ error: "job_id مطلوب" }, 400);
      const stageDir = `${tenantId}/_staging/${jobId}`;
      const pieceMatch = partTable ? /^([a-z0-9_]+)#([0-9a-f]{2})-([0-9a-f]{2})?$/.exec(partTable) : null;
      if (mode === "part" && partTable && pieceMatch) {
        // One piece of a big table: ids from <lo> up to <hi> (first two hex digits), keyset paging on id
        // (no deep OFFSET) — migrations 0104 / 0105.
        const tableName = pieceMatch[1], lo = pieceMatch[2], hi = pieceMatch[3] ?? "";
        if (!tables.some((x) => x.table_name === tableName)) return jsonResponse({ error: "جدول غير معروف" }, 400);
        const enc = new TextEncoder();
        const parts: Uint8Array[] = [];
        let total = 0, after: string | null = null, first = true;
        while (true) {
          const raw = await fetchPageRaw(url, serviceKey, "backup_fetch_range", {
            _table: tableName, _tenant: tenantId, _lo: lo, _hi: hi, _after: after, _limit: PAGE,
          }, partTable);
          const rows = JSON.parse(raw) as any[];
          const n = rows.length;
          if (n > 0) {
            const page = enc.encode(raw);
            if (first) parts.push(page);
            else { parts.push(enc.encode(",")); parts.push(page.subarray(1, page.byteLength - 1)); }
            first = false;
            after = String(rows[n - 1].id);
          }
          total += n;
          if (n < PAGE) break;
        }
        const content = first ? enc.encode("[]") : concatArrays(parts);
        parts.length = 0;
        const packed = await gzipBytes(content);
        const { error: upErr } = await admin.storage.from("system-backups")
          .upload(`${stageDir}/${tableName}.${lo}.json.gz`, packed, { contentType: "application/gzip", upsert: true });
        if (upErr) return jsonResponse({ error: `رفع ${partTable}: ${upErr.message}` }, 500);
        return jsonResponse({ ok: true, table: partTable, rows: total, bytes: content.byteLength, packed: packed.byteLength });
      }
      if (mode === "part") {
        const t = tables.find((x) => x.table_name === partTable);
        if (!t) return jsonResponse({ error: "جدول غير معروف" }, 400);
        const enc = new TextEncoder();
        const orderBy = orderByMap.get(t.table_name) ?? "1";
        const parts: Uint8Array[] = [];
        let total = 0, offset = 0, first = true;
        while (true) {
          const raw = await fetchPageRaw(url, serviceKey, "backup_fetch_page", {
            _table: t.table_name, _tenant: tenantId, _offset: offset, _limit: PAGE, _order_by: orderBy,
          }, t.table_name);
          const n = (JSON.parse(raw) as any[]).length;
          const page = enc.encode(raw);
          if (n > 0) {
            if (first) parts.push(page);
            else { parts.push(enc.encode(",")); parts.push(page.subarray(1, page.byteLength - 1)); }
            first = false;
          }
          total += n;
          if (n < PAGE) break;
          offset += PAGE;
        }
        const content = first ? enc.encode("[]") : concatArrays(parts);
        parts.length = 0;
        const packed = await gzipBytes(content);
        const { error: upErr } = await admin.storage.from("system-backups")
          .upload(`${stageDir}/${t.table_name}.json.gz`, packed, { contentType: "application/gzip", upsert: true });
        if (upErr) return jsonResponse({ error: `رفع ${t.table_name}: ${upErr.message}` }, 500);
        return jsonResponse({ ok: true, table: t.table_name, rows: total, bytes: content.byteLength, packed: packed.byteLength });
      }
      if (mode === "finalize") {
        stagedJobDir = stageDir;
        stagedCounts = clientCounts ?? {};
        // fall through to the archive builder below, reading staged files
      } else {
        return jsonResponse({ error: "mode غير معروف" }, 400);
      }
    }

    const results: any[] = [];

    for (const tenantId of tenantIds) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      // staged (cron / browser) → plain .tar holding per-table .json.gz; one-shot "full" → whole .tar.gz
      const filename = stagedJobDir ? `backup-${stamp}.tar` : `backup-${stamp}.tar.gz`;
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
        // ---------- 1) one JSON file per table (streamed one table at a time, raw text) ----------
        for (const t of tables) {
          if (stagedJobDir) {
            // A big table staged in pieces (<table>#<lo>-<hi>) → tables/<table>.<lo>.json.gz, joined back on restore.
            const pieceKeys = Object.keys(stagedCounts).filter((k) => k.startsWith(`${t.table_name}#`)).sort();
            if (pieceKeys.length) {
              let sum = 0;
              for (const key of pieceKeys) {
                const lo = key.slice(t.table_name.length + 1).split("-")[0];
                const piece = await admin.storage.from("system-backups").download(`${stagedJobDir}/${t.table_name}.${lo}.json.gz`);
                if (piece.error || !piece.data) throw new Error(`جزء ${key} غير موجود في المرحلة`);
                const packed = new Uint8Array(await piece.data.arrayBuffer());
                sum += Number(stagedCounts[key] ?? 0);
                yield tarHeader(`tables/${t.table_name}.${lo}.json.gz`, packed.byteLength);
                yield packed;
                yield tarPadding(packed.byteLength);
              }
              counts[t.table_name] = sum;
              continue;
            }
            // Staged parts are already gzip-compressed: they go into the tar as tables/<name>.json.gz untouched
            // (no re-compression — the edge worker's CPU budget is too small to gzip the whole archive).
            const gz = await admin.storage.from("system-backups").download(`${stagedJobDir}/${t.table_name}.json.gz`);
            if (!gz.error && gz.data) {
              const packed = new Uint8Array(await gz.data.arrayBuffer());
              counts[t.table_name] = Number(stagedCounts[t.table_name] ?? 0);
              yield tarHeader(`tables/${t.table_name}.json.gz`, packed.byteLength);
              yield packed;
              yield tarPadding(packed.byteLength);
              continue;
            }
            let content: Uint8Array;
            {
              const { data: f, error: fErr } = await admin.storage.from("system-backups")
                .download(`${stagedJobDir}/${t.table_name}.json`);
              if (fErr || !f) throw new Error(`ملف الجدول ${t.table_name} غير موجود في المرحلة`);
              content = new Uint8Array(await f.arrayBuffer());
            }
            counts[t.table_name] = Number(stagedCounts[t.table_name] ?? 0);
            yield tarHeader(`tables/${t.table_name}.json`, content.byteLength);
            yield content;
            yield tarPadding(content.byteLength);
            continue;
          }
          const orderBy = orderByMap.get(t.table_name) ?? "1";
          const parts: Uint8Array[] = [];
          let total = 0;
          let offset = 0;
          let first = true;
          while (true) {
            const raw = await fetchPageRaw(url, serviceKey, "backup_fetch_page", {
              _table: t.table_name, _tenant: tenantId, _offset: offset, _limit: PAGE,
              _order_by: orderBy,
            }, t.table_name);
            const pageRows = JSON.parse(raw) as any[];
            const page = enc.encode(raw);
            if (pageRows.length > 0) {
              if (first) {
                parts.push(page);
              } else {
                parts.push(enc.encode(","));
                parts.push(page.subarray(1, page.byteLength - 1));
              }
              first = false;
            }
            total += pageRows.length;
            if (pageRows.length < PAGE) break;
            offset += PAGE;
          }
          counts[t.table_name] = total;

          const content = first ? enc.encode("[]") : concatArrays(parts);
          yield tarHeader(`tables/${t.table_name}.json`, content.byteLength);
          yield content;
          yield tarPadding(content.byteLength);
        }

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
              if (stagedJobDir || mediaBytes >= MEDIA_BUDGET_BYTES) { media.push({ bucket, path: full, size: Number((e as any).metadata?.size ?? 0) }); continue; }
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
          format: "nizam-backup/2",
          order: tables.map((t) => t.table_name),
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

      // محاولات متعددة: أخطاء الشبكة العابرة أثناء الرفع المتدفق لا يجوز أن تُفشل النسخة
      for (let attempt = 1; attempt <= 4 && !uploadOk; attempt++) {
        if (attempt > 1) await new Promise((r) => setTimeout(r, 1500 * attempt));
        streamError = null;
        bytesWritten = 0;
        for (const k of Object.keys(counts)) delete counts[k];
        media.length = 0;

        const source = archiveChunks();
        const raw = new ReadableStream<Uint8Array>({
          async pull(ctrl) {
            try {
              const { value, done } = await source.next();
              if (done) ctrl.close(); else ctrl.enqueue(value);
            } catch (e: any) { streamError = e?.message ?? String(e); ctrl.error(e); }
          },
        });
        const gzReader = (stagedJobDir ? raw : raw.pipeThrough(new CompressionStream("gzip"))).getReader();
        const counted = (async function* () {
          while (true) {
            const { value, done } = await gzReader.read();
            if (done) break;
            bytesWritten += value.byteLength;
            yield value;
          }
        })();

        try {
          const res = await fetch(`${url}/storage/v1/object/system-backups/${storagePath}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
              "Content-Type": stagedJobDir ? "application/x-tar" : "application/gzip",
              "x-upsert": "true",
            },
            body: counted,
            // @ts-expect-error Deno supports the streaming request-body duplex option.
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
        if (stagedJobDir) {
          // Drive sync and staging cleanup run in the background so the call returns fast
          const dir = stagedJobDir;
          // @ts-ignore EdgeRuntime is provided by the Supabase runtime
          EdgeRuntime.waitUntil((async () => {
            try { await syncToDrive(admin, url, serviceKey, tenantId, storagePath); } catch (e) { console.warn("drive", e); }
            const { data: files } = await admin.storage.from("system-backups").list(dir, { limit: 1000 });
            if (files?.length) await admin.storage.from("system-backups").remove(files.map((x: any) => `${dir}/${x.name}`));
          })());
          drive = { synced: false, error: undefined };
        } else {
          drive = await syncToDrive(admin, url, serviceKey, tenantId, storagePath);
        }
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

// ---------------------------------------------------------------- Drive folder
async function ensureDriveFolder(
  admin: any, tenantId: string, settings: any, gwHeaders: Record<string, string>,
): Promise<{ folder_id: string | null; folder_name: string | null; created: boolean; error?: string }> {
  const existingId = settings?.drive_folder_id?.trim();
  const existingName = settings?.drive_folder_name?.trim();
  if (existingId) {
    const check = await fetch(`${GATEWAY}/drive/v3/files/${existingId}?fields=id,name,mimeType,trashed`, {
      headers: gwHeaders,
    });
    if (check.ok) {
      const meta = await check.json().catch(() => ({}));
      if (meta?.id && meta?.mimeType === "application/vnd.google-apps.folder" && !meta?.trashed) {
        return { folder_id: existingId, folder_name: existingName || meta?.name || null, created: false };
      }
    }
    // stale / invalid folder: fall through to recreate
  }

  const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  const rawName = tenant?.name?.trim() || tenantId.slice(0, 8);
  const sanitized = rawName.replace(/[^a-zA-Z0-9\u0600-\u06FF]+/g, "_").replace(/^_+|_+$/g, "");
  const folderName = sanitized
    ? `Nizam_Backup_${sanitized}`
    : `Nizam_Backup_${tenantId.slice(0, 8)}`;

  const res = await fetch(`${GATEWAY}/drive/v3/files`, {
    method: "POST",
    headers: { ...gwHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return { folder_id: null, folder_name: null, created: false, error: `Google Drive [${res.status}]: ${detail}` };
  }
  const created = await res.json().catch(() => ({}));
  const folderId = created?.id;
  if (!folderId) {
    return { folder_id: null, folder_name: null, created: false, error: "لم يُرجع Google Drive معرّف المجلد" };
  }

  await admin.from("backup_settings").upsert({
    tenant_id: tenantId,
    drive_folder_id: folderId,
    drive_folder_name: folderName,
    drive_connected: true,
    last_error: null,
  }, { onConflict: "tenant_id" });

  return { folder_id: folderId, folder_name: folderName, created: true };
}

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

  const folder = await ensureDriveFolder(admin, tenantId, settings, gwHeaders);
  if (folder.error) {
    await admin.from("backup_settings").update({ last_error: folder.error }).eq("tenant_id", tenantId);
    return { synced: false, error: folder.error };
  }

  // Stream the archive straight from storage into Drive — never buffered here.
  const objectRes = await fetch(`${url}/storage/v1/object/system-backups/${storagePath}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  if (!objectRes.ok || !objectRes.body) {
    return { synced: false, error: `تعذر قراءة ملف النسخة: ${objectRes.status}` };
  }

  let fileId: string | null = settings.drive_file_id ?? null;

  const doUpload = async (id: string | null, body: ReadableStream<Uint8Array> | null) => {
    const endpoint = id
      ? `${GATEWAY}/upload/drive/v3/files/${id}?uploadType=media&supportsAllDrives=true`
      : `${GATEWAY}/upload/drive/v3/files?uploadType=media&supportsAllDrives=true`;
    return await fetch(endpoint, {
      method: id ? "PATCH" : "POST",
      headers: { ...gwHeaders, "Content-Type": "application/x-tar" },
      body,
      // @ts-expect-error Deno supports the streaming request-body duplex option.
      duplex: "half",
    });
  };

  let res = await doUpload(fileId, objectRes.body);
  if (!res.ok && fileId) {
    // The remembered file is gone — fall back to creating a fresh one.
    fileId = null;
    const retry = await fetch(`${url}/storage/v1/object/system-backups/${storagePath}`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    res = await doUpload(null, retry.body);
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
    const query = folder.folder_id
      ? `?addParents=${encodeURIComponent(folder.folder_id)}&supportsAllDrives=true`
      : "?supportsAllDrives=true";
    const patchRes = await fetch(`${GATEWAY}/drive/v3/files/${newId}${query}`, {
      method: "PATCH",
      headers: { ...gwHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    if (!patchRes.ok) {
      const detail = await patchRes.text();
      console.warn(`Drive metadata patch failed [${patchRes.status}]: ${detail}`);
    }
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
