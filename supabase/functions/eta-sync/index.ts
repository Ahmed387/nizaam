// «الفواتير الإلكترونية الواردة» (migration 0220, owner 2026-11-14 «عاوز استقبل بس»). RECEIVE ONLY.
// Called by pg_cron (eta_sync_all → nizam_cron_call, x-cron-secret = system_cron_tokens 'eta-sync') or by
// eta_sync_now (same path). Reads the company's ETA credentials (secret from Vault, through eta_credentials, service role),
// gets a token from the ETA identity server, searches the documents RECEIVED by the company
// (GET /api/v1.0/documents/search?direction=Received, windows of ≤ 30 days, pages with continuationToken, one request
// every 2.1 s — the ETA limit), and hands them to eta_ingest (upsert + notifications). Nothing is ever sent to the ETA.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HOSTS = {
  prod: { id: "https://id.eta.gov.eg", api: "https://api.invoicing.eta.gov.eg" },
  preprod: { id: "https://id.preprod.eta.gov.eg", api: "https://api.preprod.invoicing.eta.gov.eg" },
} as const;
const DAY = 86_400_000;
const FIRST_SYNC_DAYS = 30;   // first run: the last 30 days
const OVERLAP_DAYS = 8;       // re-read the last 8 days so cancellations / rejections (allowed within 7 days) are caught
const MAX_REQUESTS = 45;      // ≈ 95 s at 2.1 s each — well inside the edge function's limit
const SPACING_MS = 2100;

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const cron = req.headers.get("x-cron-secret") ?? "";
  const { data: tok } = await admin.from("system_cron_tokens").select("token").eq("name", "eta-sync").maybeSingle();
  if (!tok?.token || cron.length < 16 || tok.token !== cron) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const tenantId = String(body?.tenant_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) return json({ error: "tenant_id مطلوب" }, 400);

  const { data: cred, error: credErr } = await admin.rpc("eta_credentials", { p_tenant: tenantId });
  if (credErr || !cred) return json({ error: credErr?.message ?? "no settings" }, 400);
  if (!cred.enabled || !cred.client_id || !cred.client_secret) return json({ ok: true, skipped: "disabled" });
  const host = HOSTS[(cred.env === "preprod" ? "preprod" : "prod") as keyof typeof HOSTS];

  const docs: unknown[] = [];
  let until: string | null = null;
  let failure: string | null = null;
  try {
    // ---- token ----
    const form = new URLSearchParams({
      grant_type: "client_credentials", client_id: cred.client_id, client_secret: cred.client_secret, scope: "InvoicingAPI",
    });
    const tr = await fetch(`${host.id}/connect/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
    });
    if (!tr.ok) {
      const t = await tr.text().catch(() => "");
      throw new Error(tr.status === 400 || tr.status === 401
        ? "Client ID أو Client Secret غلط، أو نظام الـ ERP مش متفعّل على البوابة"
        : `ETA token ${tr.status}: ${t.slice(0, 200)}`);
    }
    const accessToken = (await tr.json())?.access_token as string;
    if (!accessToken) throw new Error("ETA: no access_token");

    // ---- windows ----
    const now = Date.now();
    const from = cred.synced_until
      ? new Date(cred.synced_until).getTime() - OVERLAP_DAYS * DAY
      : now - FIRST_SYNC_DAYS * DAY;
    let requests = 0;
    let reachedEnd = true;
    for (let wStart = from; wStart < now; wStart += 30 * DAY) {
      const wEnd = Math.min(wStart + 30 * DAY - 1000, now);
      let cont: string | null = null;
      for (;;) {
        if (requests >= MAX_REQUESTS) { reachedEnd = false; break; }
        if (requests > 0) await sleep(SPACING_MS);
        requests++;
        const q = new URLSearchParams({
          direction: "Received",
          issueDateFrom: new Date(wStart).toISOString(),
          issueDateTo: new Date(wEnd).toISOString(),
          pageSize: "100",
        });
        if (cont) q.set("continuationToken", cont);
        const r = await fetch(`${host.api}/api/v1.0/documents/search?${q}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (r.status === 429) { await sleep(10_000); continue; }
        if (!r.ok) throw new Error(`ETA search ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
        const page = await r.json();
        for (const d of page?.result ?? []) docs.push(d);
        cont = page?.metadata?.continuationToken ?? null;
        if (!cont || cont === "EndofResultSet" || !(page?.result?.length)) break;
      }
      if (!reachedEnd) {
        until = new Date(wStart).toISOString(); // the next run starts again from this window
        break;
      }
    }
    if (reachedEnd) until = new Date(now).toISOString();
  } catch (e) {
    failure = errText(e);
  }

  const { data: res, error: ingErr } = await admin.rpc("eta_ingest", {
    p_tenant: tenantId, p_docs: docs, p_until: failure ? null : until, p_error: failure,
  });
  if (ingErr) return json({ ok: false, error: ingErr.message }, 500);
  return json({ ok: !failure, fetched: docs.length, ...(res ?? {}), error: failure ?? undefined });
});
