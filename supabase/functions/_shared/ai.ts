// Provider-agnostic AI chat (OpenAI-compatible /chat/completions).
// Secrets (set in Supabase → Edge Functions → Secrets):
//   AI_API_KEY   — required. A Google Gemini API key by default (aistudio.google.com/apikey).
//   AI_BASE_URL  — optional. Any OpenAI-compatible base URL (default: Gemini's OpenAI endpoint).
//   AI_MODEL     — optional. Overrides the model for every call.
// LOVABLE_API_KEY is still accepted as a fallback, so the code keeps working on Lovable Cloud.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const LOVABLE_BASE = "https://ai.gateway.lovable.dev/v1";

function cfg() {
  const own = Deno.env.get("AI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  const key = own ?? lovable ?? null;
  const viaLovable = !own && !!lovable;
  const base = (Deno.env.get("AI_BASE_URL") ?? (viaLovable ? LOVABLE_BASE : GEMINI_BASE)).replace(/\/$/, "");
  return { key, base, viaLovable };
}

export function aiConfigured(): boolean {
  return !!cfg().key;
}

// 2026-10-25: Google closed gemini-2.5-flash / -flash-lite to new projects (404 «no longer available to new
// users»), so every «اسألني» question failed. The callers still ask for the old names; they are mapped to the
// current stable models, and a 404 «model not available» falls through to the next one.
const FLASH = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];  // lite last: when both are busy
const FLASH_LITE = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"];

function pickModels(requested: string, viaLovable: boolean): string[] {
  const forced = Deno.env.get("AI_MODEL");
  if (forced) return [forced];
  if (viaLovable) return [requested];
  const m = requested.replace(/^google\//, "");
  if (/^gemini-[3-9]/.test(m)) return [m, ...(m.includes("lite") ? FLASH_LITE : FLASH).filter((x) => x !== m)];
  return m.includes("lite") ? FLASH_LITE : FLASH;
}

export async function aiChat(body: Record<string, unknown> & { model: string }): Promise<Response> {
  const { key, base, viaLovable } = cfg();
  if (!key) {
    return new Response(JSON.stringify({ error: "مفتاح الذكاء الاصطناعي (AI_API_KEY) غير مضاف في أسرار Supabase" }), { status: 500 });
  }
  const models = healthyFirst(pickModels(body.model, viaLovable));
  let resp: Response | null = null;
  for (const model of models) {
    // 2026-11-07: Google answered 503 «This model is currently experiencing high demand» and «اسألني» showed the raw
    // error. Measured: gemini-3.8-flash answered 503 in 0.5 s once and HUNG 143 s before the 503 the next time (the
    // edge function dies at ≈ 150 s), while 3.5-flash / -lite answered in 2–4 s. So: every call has a time limit
    // (CALL_TIMEOUT_MS, a timeout counts as busy); a quick busy answer is tried once more after a short wait; a busy
    // model is skipped for SICK_MS (the next rounds of the same question and the next questions go straight to a
    // healthy one), then the next model is used.
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      resp = await timedFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model }),
      });
      if (!BUSY.has(resp.status)) break;
      if (attempt === 0 && Date.now() - t0 < 3000) { await resp.body?.cancel(); await sleep(1200); continue; }
      break;
    }
    if (BUSY.has(resp!.status)) sick.set(model, Date.now() + SICK_MS);
    if (resp!.status === 404 || BUSY.has(resp!.status)) {
      if (model !== models[models.length - 1]) { await resp!.body?.cancel(); continue; }
    }
    return resp!;
  }
  return resp!;
}

/** Answers that mean «busy right now»: worth a second try or another model. */
const BUSY = new Set([429, 500, 503]);
const CALL_TIMEOUT_MS = 35_000;   // a long answer over a big report takes ≈ 10–20 s; a hung model never ends
const SICK_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** model → until when it is skipped (kept while the edge worker lives). */
const sick = new Map<string, number>();
function healthyFirst(models: string[]): string[] {
  const now = Date.now();
  const ok = models.filter((m) => (sick.get(m) ?? 0) <= now);
  return [...ok, ...models.filter((m) => !ok.includes(m))];
}
/** fetch with a time limit; a timeout / network error comes back as a 503 so callers treat it as «busy». */
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (e) {
    console.error("ai call failed / timed out", String(e).slice(0, 200));
    return new Response(JSON.stringify({ error: "AI timeout" }), { status: 503 });
  }
}

/** The Google key + native endpoint, when calls go straight to Gemini (not Lovable / another OpenAI-compatible base). */
export function geminiNative(): { key: string; base: string } | null {
  const { key, viaLovable } = cfg();
  if (!key || viaLovable || Deno.env.get("AI_BASE_URL")) return null;
  return { key, base: "https://generativelanguage.googleapis.com/v1beta" };
}

/**
 * Native Gemini generateContent with a JSON schema (used for PDFs: the OpenAI-compatible endpoint does not take
 * a PDF file part). Tries the same model list as aiChat; a 404 «model not available» falls through.
 */
export async function geminiJson(opts: {
  model: string; system: string; parts: unknown[]; schema: unknown; maxOutputTokens?: number;
}): Promise<{ ok: true; json: any; finish: string } | { ok: false; status: number; error: string }> {
  const native = geminiNative();
  if (!native) return { ok: false, status: 500, error: "native Gemini needs AI_API_KEY without AI_BASE_URL" };
  let last = { ok: false as const, status: 404, error: "no model" };
  for (const model of healthyFirst(pickModels(opts.model, false))) {
    const r = await fetch(`${native.base}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": native.key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: opts.parts }],
        generationConfig: { responseMimeType: "application/json", responseSchema: opts.schema, maxOutputTokens: opts.maxOutputTokens ?? 65536 },
      }),
    });
    if (BUSY.has(r.status)) sick.set(model, Date.now() + SICK_MS);
    if (r.status === 404 || BUSY.has(r.status)) { last = { ok: false, status: r.status, error: await r.text() }; continue; }
    if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
    const data = await r.json();
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((x: any) => x?.text ?? "").join("");
    try { return { ok: true, json: JSON.parse(text), finish: cand?.finishReason ?? "" }; }
    catch { return { ok: false, status: 422, error: cand?.finishReason === "MAX_TOKENS" ? "MAX_TOKENS" : "bad json" }; }
  }
  return last;
}
