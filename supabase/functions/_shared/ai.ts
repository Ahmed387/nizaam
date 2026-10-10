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

function pickModel(requested: string, viaLovable: boolean): string {
  const forced = Deno.env.get("AI_MODEL");
  if (forced) return forced;
  if (viaLovable) return requested;
  const m = requested.replace(/^google\//, "");
  // Lovable-only aliases → nearest public Gemini model
  if (!/^gemini-2\.5-(flash|flash-lite|pro)$/.test(m)) return m.includes("lite") ? "gemini-2.5-flash-lite" : "gemini-2.5-flash";
  return m;
}

export async function aiChat(body: Record<string, unknown> & { model: string }): Promise<Response> {
  const { key, base, viaLovable } = cfg();
  if (!key) {
    return new Response(JSON.stringify({ error: "مفتاح الذكاء الاصطناعي (AI_API_KEY) غير مضاف في أسرار Supabase" }), { status: 500 });
  }
  return await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, model: pickModel(body.model, viaLovable) }),
  });
}
