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

قواعد صارمة جداً — اتبعها حرفياً:
1. انسخ اسم المنتج (product_name) **حرفياً كما هو مكتوب في الملف بدون أي تعديل**.
   - ممنوع الترجمة بين العربي والإنجليزي.
   - ممنوع التصحيح الإملائي أو إعادة الصياغة أو الاختصار أو التوسيع.
   - ممنوع تغيير حالة الأحرف (Upper/Lower) أو ترتيب الكلمات.
   - حافظ على المسافات والرموز والأرقام بنفس الترتيب.
2. **لا تدمج رقم/كود الموديل داخل اسم المنتج**. ضعه في خانة model_code منفصلاً تماماً.
   إن لم يكن هناك عمود موديل واضح، اترك model_code فارغاً ولا تخترعه من اسم المنتج.
3. لا تخلط بين صفوف مختلفة. كل صف منتج مستقل بذاته.
4. تجاهل الرؤوس والتذييلات وأسطر العناوين والصفوف الفارغة، لكن لا تتجاهل أي منتج حقيقي.
5. category: اختر الأنسب من (ثلاجات، غسالات، تكييف، بوتاجازات، مراوح، ميكروويف، ديب فريزر، مبردات هواء) أو اتركها فارغة لو غير واضحة.
6. cost_price: السعر الأساسي للشراء من المورد — رقم فقط بدون عملة أو فواصل.
7. suggested_sell_price: لو موجود في القائمة، وإلا 0.

ارجع البيانات كما هي تماماً. الأمانة في النقل أهم من أي تنظيم.`;

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
      temperature: 0,
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
