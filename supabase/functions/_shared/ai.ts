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
const FLASH = ["gemini-3.8-flash", "gemini-3.5-flash"];
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
  const models = pickModels(body.model, viaLovable);
  let resp: Response | null = null;
  for (const model of models) {
    resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, model }),
    });
    if (resp.status !== 404) return resp;
  }
  return resp!;
}
