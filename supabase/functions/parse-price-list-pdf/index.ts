// Fast PDF price-list parser:
// 1) Extract text from PDF using unpdf (no native deps, Deno-friendly)
// 2) Send only text to Gemini flash-lite (5-10x faster than vision)
// 3) Fallback to vision mode only if text extraction yields too little
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const SYSTEM = (supplier: string) => `أنت خبير استخراج بيانات قوائم أسعار الموردين.
المورد: ${supplier}
استخرج كل صف منتج وأرجع JSON منظم بحقول:
- product_name: اسم المنتج
- model_code: رقم الموديل أو الكود (إن وجد)
- category: الفئة (ثلاجات، غسالات، تكييف، بوتاجازات، مراوح، ميكروويف، ديب فريزر، مبردات هواء)
- cost_price: سعر الشراء من المورد (السعر الأساسي في القائمة) — رقم فقط
- suggested_sell_price: سعر البيع المقترح (إن وجد، وإلا 0)
تجاهل الرؤوس والتذييلات والصفوف الفارغة. استخرج كل المنتجات بدون استثناء.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "save_price_list",
    description: "حفظ منتجات قائمة الأسعار المستخرجة",
    parameters: {
      type: "object",
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              product_name: { type: "string" },
              model_code: { type: "string" },
              category: { type: "string" },
              cost_price: { type: "number" },
              suggested_sell_price: { type: "number" },
            },
            required: ["product_name", "cost_price"],
            additionalProperties: false,
          },
        },
      },
      required: ["products"],
      additionalProperties: false,
    },
  },
};

async function callAI(messages: any[], apiKey: string) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages,
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "save_price_list" } },
    }),
  });
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pdfBase64, supplierName } = await req.json();
    if (!pdfBase64) return json({ error: "pdfBase64 required" }, 400);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const supplier = supplierName ?? "غير محدد";
    const t0 = Date.now();
    const bytes = b64ToBytes(pdfBase64);
    console.log(`[parse] supplier=${supplier} pdfBytes=${bytes.length}`);

    // 1) Try fast text extraction
    let extractedText = "";
    try {
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      extractedText = (Array.isArray(text) ? text.join("\n") : text)?.trim() ?? "";
      console.log(`[parse] extracted text chars=${extractedText.length} in ${Date.now() - t0}ms`);
    } catch (e) {
      console.warn("[parse] text extraction failed:", e);
    }

    // Decide path: if we have meaningful text, use TEXT mode (fast)
    const useText = extractedText.length > 200;
    const messages = useText
      ? [
          { role: "system", content: SYSTEM(supplier) },
          {
            role: "user",
            content:
              "النص التالي مستخرج من PDF قائمة أسعار. استخرج كل المنتجات منه:\n\n" +
              extractedText.slice(0, 120_000),
          },
        ]
      : [
          { role: "system", content: SYSTEM(supplier) },
          {
            role: "user",
            content: [
              { type: "text", text: "استخرج كل المنتجات والأسعار من ملف PDF التالي:" },
              {
                type: "file",
                file: {
                  filename: "pricelist.pdf",
                  file_data: `data:application/pdf;base64,${pdfBase64}`,
                },
              },
            ],
          },
        ];

    console.log(`[parse] mode=${useText ? "TEXT" : "VISION"}`);
    const tAI = Date.now();
    const response = await callAI(messages, apiKey);

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      if (response.status === 429) return json({ error: "تم تجاوز حد الاستخدام، حاول لاحقاً" }, 429);
      if (response.status === 402) return json({ error: "رصيد AI غير كافٍ" }, 402);
      return json({ error: `خطأ AI: ${t.slice(0, 200)}` }, 500);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return json({ error: "لم يتم استخراج أي بيانات من الملف" }, 422);

    const args = JSON.parse(toolCall.function.arguments);
    const products = args.products ?? [];
    console.log(`[parse] extracted ${products.length} products | ai=${Date.now() - tAI}ms total=${Date.now() - t0}ms`);

    return json({ products, mode: useText ? "text" : "vision" });
  } catch (e) {
    console.error("parse-price-list-pdf error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
