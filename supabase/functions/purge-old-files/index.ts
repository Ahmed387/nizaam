// One-time go-live purge (migration 0150, owner 2026-11-04 «امسح اي داتا قديمة ... او صور»): removes every file of the old
// product photos and document attachments through the Storage API (storage refuses SQL deletes). Called only from the
// database with the one-time token in public.system_cron_tokens (name 'purge-old-files'); the token row is removed after the
// run, so the function answers 401 from then on. Only the two buckets below can be emptied.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = ["product-images", "record-attachments"];
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function listAll(admin: any, bucket: string, prefix: string): Promise<string[]> {
  const files: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const it of data) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) files.push(...(await listAll(admin, bucket, p)));
      else files.push(p);
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  return files;
}

Deno.serve(async (req) => {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const provided = req.headers.get("x-cron-secret") ?? "";
    const { data: tok } = await admin.from("system_cron_tokens").select("token").eq("name", "purge-old-files").maybeSingle();
    if (!tok?.token || provided.length < 16 || provided !== tok.token) return json({ ok: false, error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const buckets: string[] = (Array.isArray(body?.buckets) ? body.buckets : []).filter((b: string) => ALLOWED.includes(b));
    const out: Record<string, unknown> = {};
    for (const bucket of buckets) {
      const paths = await listAll(admin, bucket, "");
      let removed = 0;
      const errors: string[] = [];
      for (let i = 0; i < paths.length; i += 100) {
        const { data, error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) errors.push(error.message);
        else removed += data?.length ?? 0;
      }
      out[bucket] = { found: paths.length, removed, errors };
    }
    return json({ ok: true, result: out });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
