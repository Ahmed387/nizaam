// Go-live import, step 1 (migrations 0154 / 0155, owner 2026-11-05 «نفذها بالكامل وارفع الكل»): reads the .xlsx files
// the owner dropped into the private bucket `sahl-import` and stores their rows in `sahl_import.records`, record by
// record, exactly as the old program «سهل» printed them (same reading as the analysis done with the owner: a document
// row + its item rows; the stock count; the account balances). A file is accepted only when its SHA-256 is one of the
// files analysed with the owner (KNOWN) or is mapped to a branch in the call (body.map). Changes NO business table.
// Called only from the database with the token in public.system_cron_tokens (name 'sahl-import'), one file per call
// (body.file = its path in the bucket) so each run stays inside the edge CPU limit. Storage refuses Arabic file names, so
// the owner may upload ONE .zip of the files instead: body.file = the zip, body.entry = the file's index inside it
// (without body.entry the call lists the zip's .xlsx entries).
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { unzipSync } from "npm:fflate@0.8.2";
import { KNOWN, parse, str, type Branch } from "./parse.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
async function sha256(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const provided = req.headers.get("x-cron-secret") ?? "";
    const { data: tok } = await admin.from("system_cron_tokens").select("token").eq("name", "sahl-import").maybeSingle();
    if (!tok?.token || provided.length < 16 || provided !== tok.token) return json({ ok: false, error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));

    if (body?.list) {
      const { data, error } = await admin.storage.from("sahl-import").list("", { limit: 1000 });
      if (error) throw error;
      const files: string[] = [];
      for (const it of data ?? []) {
        if (it.id) { files.push(it.name); continue; }
        const { data: sub } = await admin.storage.from("sahl-import").list(it.name, { limit: 1000 });
        for (const s of sub ?? []) if (s.id) files.push(`${it.name}/${s.name}`);
      }
      return json({ ok: true, files });
    }

    const path = String(body?.file ?? "");
    if (!path) return json({ ok: false, error: "file is required" }, 400);
    const { data: blob, error: dErr } = await admin.storage.from("sahl-import").download(path);
    if (dErr || !blob) return json({ ok: false, file: path, error: `download: ${dErr?.message}` }, 500);
    let bytes = new Uint8Array(await blob.arrayBuffer());
    let name = path;
    if (path.toLowerCase().endsWith(".zip")) {
      const all = unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith(".xlsx") && !f.name.startsWith("__MACOSX") });
      const names = Object.keys(all).sort();
      if (body?.entry === undefined || body?.entry === null) {
        const list = [];
        for (const n of names) list.push({ entry: names.indexOf(n), name: n, size: all[n].length, sha256: await sha256(all[n]) });
        return json({ ok: true, zip: path, entries: list });
      }
      const i = Number(body.entry);
      if (!(i >= 0 && i < names.length)) return json({ ok: false, zip: path, error: `no entry ${body.entry}` }, 400);
      name = `${path}#${names[i]}`;
      bytes = all[names[i]];
    }
    const sha = await sha256(bytes);
    const extra = (body?.map ?? {}) as Record<string, Branch>;
    const known = KNOWN[sha];
    const branch = known?.[0] ?? extra[sha];
    if (!branch) return json({ ok: false, file: name, sha256: sha, error: "unknown file" }, 422);

    const wb = XLSX.read(bytes, { type: "array", cellDates: true, dense: true, cellNF: false, cellStyles: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }) as unknown[][];
    const kind = String(str(rows[0]?.[0]) ?? "");
    const period = rows[1]?.[0] == null ? null : String(rows[1][0]);
    if (known && known[1] !== kind) return json({ ok: false, file: name, sha256: sha, error: `kind ${kind} ≠ ${known[1]}` }, 422);
    const recs = parse(rows, kind);
    const file = { sha256: sha, name, branch, kind, period, n_records: recs.length };
    let staged = 0;
    const CHUNK = 400;
    for (let i = 0; i === 0 || i < recs.length; i += CHUNK) {
      const { data: n, error } = await admin.rpc("sahl_import_stage", {
        p_file: file, p_records: recs.slice(i, i + CHUNK), p_offset: i,
      });
      if (error) return json({ ok: false, file: name, error: `stage: ${error.message}`, staged }, 500);
      staged += Number(n ?? 0);
      if (recs.length === 0) break;
    }
    const items = recs.reduce((s, r: any) => s + (Array.isArray(r.items) ? r.items.length : 0), 0);
    return json({ ok: true, file: name, sha256: sha, branch, kind, period, records: recs.length, items, staged });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
