// Folder backup finalize (migration 0152, owner 2026-11-04 «تتقسم لكذا ملف كل واحد أصغر من 50 ميجا … تجمعها في فولدر
// واحد»). `scheduled-backup` (modes plan / part) leaves one small .json.gz per table / piece in
// «<tenant>/_staging/<job>/»; this MOVES them into ONE folder «<tenant>/backup-<stamp>/» with a manifest.json — no single
// archive above the free plan's 50 MB upload limit. `restore-system-backup` reads the folder back; the backup screen
// downloads it as one .zip. Callers: the nightly job (x-cron-secret = system_cron_tokens 'backup-folder') or the owner.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUCKET = "system-backups";
const KEEP = 12;

async function listFolder(admin: any, dir: string): Promise<{ name: string; size: number }[]> {
  const out: { name: string; size: number }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(BUCKET).list(dir, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const f of data ?? []) if (f.id) out.push({ name: f.name, size: Number((f as any).metadata?.size ?? 0) });
    if (!data || data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body?.tenant_id ?? "");
    const jobId = String(body?.job_id ?? "");
    const counts: Record<string, number> = body?.counts && typeof body.counts === "object" ? body.counts : {};
    if (!/^[0-9a-f-]{36}$/.test(jobId)) return json({ error: "job_id مطلوب" }, 400);

    // ---- who: the nightly job (its token) or an owner / super admin of that company ----
    let allowedTenant: string | null = null;
    const cron = req.headers.get("x-cron-secret") ?? "";
    if (cron.length >= 16) {
      const { data: tok } = await admin.from("system_cron_tokens").select("token").eq("name", "backup-folder").maybeSingle();
      if (tok?.token && tok.token === cron) allowedTenant = tenantId || null;
    }
    if (!allowedTenant) {
      const auth = req.headers.get("Authorization");
      if (!auth) return json({ error: "Unauthorized" }, 401);
      const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const { data: claims } = await authClient.auth.getClaims(auth.replace("Bearer ", ""));
      const uid = claims?.claims?.sub as string | undefined;
      if (!uid) return json({ error: "Unauthorized" }, 401);
      const { data: roles } = await admin.from("user_roles").select("tenant_id").eq("user_id", uid).in("role", ["owner", "super_admin"]);
      const mine = [...new Set((roles ?? []).map((r: any) => r.tenant_id).filter(Boolean))] as string[];
      if (!mine.length) return json({ error: "النسخ الاحتياطي مقصور على المالك فقط" }, 403);
      allowedTenant = tenantId && mine.includes(tenantId) ? tenantId : (!tenantId && mine.length === 1 ? mine[0] : null);
      if (!allowedTenant) return json({ error: "Forbidden" }, 403);
    }

    const stageDir = `${allowedTenant}/_staging/${jobId}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const folder = `${allowedTenant}/backup-${stamp}`;
    const fail = async (message: string) => {
      await admin.from("system_backups").insert({ tenant_id: allowedTenant, filename: `backup-${stamp}`, size_bytes: 0,
        table_counts: counts, status: "failed", error: message, storage_path: null });
      await admin.from("backup_settings").upsert({ tenant_id: allowedTenant, last_error: message }, { onConflict: "tenant_id" });
      return json({ ok: false, results: [{ tenant_id: allowedTenant, status: "failed", error: message }] }, 500);
    };

    const staged = await listFolder(admin, stageDir);
    if (!staged.length) return await fail("مفيش ملفات في المرحلة");
    const moveOne = async (f: { name: string }): Promise<string | null> => {
      let last = "";
      for (let attempt = 1; attempt <= 4; attempt++) {
        const { error } = await admin.storage.from(BUCKET).move(`${stageDir}/${f.name}`, `${folder}/${f.name}`);
        if (!error) return null;
        last = error.message;
        await sleep(800 * attempt);
      }
      return `نقل ${f.name}: ${last}`;
    };
    for (let i = 0; i < staged.length; i += 5) {
      const errs = (await Promise.all(staged.slice(i, i + 5).map(moveOne))).filter(Boolean);
      if (errs.length) return await fail(errs[0]!);
    }

    // table totals: pieces «<table>#<lo>-<hi>» are summed into their table
    const tables: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) {
      const name = k.split("#")[0];
      tables[name] = (tables[name] ?? 0) + Number(v ?? 0);
    }
    const { data: manifestRows } = await admin.rpc("backup_table_manifest");
    const order = ((manifestRows ?? []) as { ord: number; table_name: string }[]).slice().sort((a, b) => a.ord - b.ord).map((t) => t.table_name);
    const manifest = new TextEncoder().encode(JSON.stringify({
      tenant_id: allowedTenant, exported_at: new Date().toISOString(), format: "nizam-backup/3-folder",
      order: order.length ? order : Object.keys(tables), tables,
      total_rows: Object.values(tables).reduce((s, n) => s + n, 0),
      files: staged.map((f) => ({ name: f.name, size: f.size })),
    }, null, 2));
    const { error: mErr } = await admin.storage.from(BUCKET).upload(`${folder}/manifest.json`, manifest, { contentType: "application/json", upsert: true });
    if (mErr) return await fail(`manifest: ${mErr.message}`);
    const bytes = staged.reduce((s, f) => s + f.size, 0) + manifest.byteLength;

    const { data: inserted } = await admin.from("system_backups").insert({
      tenant_id: allowedTenant, filename: `backup-${stamp}`, size_bytes: bytes, table_counts: tables,
      status: "success", error: null, storage_path: `${folder}/`,
    }).select("id").maybeSingle();
    await admin.from("backup_settings").upsert({ tenant_id: allowedTenant, last_error: null }, { onConflict: "tenant_id" });

    // the owner gets one notification (no link to the files — they stay owner-gated)
    try {
      const { data: owners } = await admin.from("user_roles").select("user_id").eq("tenant_id", allowedTenant).in("role", ["owner", "super_admin"]);
      const ids = [...new Set((owners ?? []).map((r: any) => r.user_id))];
      const rows = Object.values(tables).reduce((s, n) => s + n, 0);
      if (ids.length) await admin.from("notifications").insert(ids.map((uid) => ({
        user_id: uid, tenant_id: allowedTenant, title: "✅ نسخة احتياطية جديدة",
        body: `فولدر واحد • ${staged.length + 1} ملف • ${rows.toLocaleString("en-US")} سجل • ${(bytes / 1048576).toFixed(1)} MB`,
        type: "general", link: "/admin/settings?tab=backup", related_entity: "system_backups",
      })));
    } catch (e) { console.warn("notify", e); }

    // keep the last 12 successful backups; a folder is removed file by file
    const { data: oldOnes } = await admin.from("system_backups").select("id, storage_path")
      .eq("tenant_id", allowedTenant).eq("status", "success").order("created_at", { ascending: false }).range(KEEP, 999);
    for (const o of oldOnes ?? []) {
      const sp = String(o.storage_path ?? "");
      if (sp.endsWith("/")) {
        const dir = sp.slice(0, -1);
        const files = await listFolder(admin, dir).catch(() => []);
        for (let i = 0; i < files.length; i += 100) {
          await admin.storage.from(BUCKET).remove(files.slice(i, i + 100).map((f) => `${dir}/${f.name}`));
        }
      } else if (sp) {
        await admin.storage.from(BUCKET).remove([sp]);
      }
      await admin.from("system_backups").delete().eq("id", o.id);
    }
    return json({ ok: true, results: [{ tenant_id: allowedTenant, backup_id: inserted?.id, folder: `${folder}/`,
      files: staged.length + 1, size: bytes, rows: Object.values(tables).reduce((s, n) => s + n, 0), status: "success" }] });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
