import { aiChat, aiConfigured, geminiJson, geminiNative } from "../_shared/ai.ts";
// Fast PDF price-list parser:
// 1) Extract text from PDF using unpdf (no native deps, Deno-friendly)
// 2) Send only text to Gemini flash-lite (5-10x faster than vision)
// 3) Fallback to vision mode only if text extraction yields too little
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { createClient } from "npm:@supabase/supabase-js@2";

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

// ---- Additive, supplier-specific focus hints (never removes generic rules) ----
function brandHints(supplier: string): string {
  const s = (supplier ?? "").toUpperCase();
  const hints: string[] = [];
  if (s.includes("KIRIAZI") || supplier.includes("كريازي")) {
    hints.push(
      "تنبيه خاص لكريازي: عمود الموديل يحتوي سلاشات لاتينية وأرقاماً مدمجة؛ وفي البوتاجازات والسخانات يقع الموديل غالباً في الكلمة الأولى قبل اسم الصنف (مثل 90FC9/1 أو KH10/1AD). استخرجها بدقة في حقل model_code."
    );
  }
  if (s.includes("ZANUSSI") || supplier.includes("زانوسي")) {
    hints.push(
      "تنبيه خاص لزانوسي: الصفحة تتكون من عدة جداول متجاورة؛ عمود 'كود' الرقمي (مثل 1019، 409، 573) يُعتبر هو model_code في جداول السخانات والثلاجات، بينما الأكواد بين أقواس مثل (ZCG622A6XB) هي الموديل في البوتاجازات والأفران. لا تترك model_code فارغاً."
    );
  }
  return hints.length ? `\nتوجيهات إضافية خاصة بالمورد:\n- ${hints.join("\n- ")}\n` : "";
}

// ---- Unified model fallback (mirror of src/lib/priceListColumns.ts) ----
const AR_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

function normalizeArabicText(input: unknown): string {
  let s = String(input ?? "");
  if (!s) return "";
  try { s = s.normalize("NFKC"); } catch { /* ignore */ }
  s = s.replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d);
  s = s.replace(/[\u0640]/g, "");
  s = s.replace(/[\u064B-\u0652\u0670]/g, "");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

const MODEL_PATTERNS: RegExp[] = [
  /\(([A-Z0-9/\-]{4,})\)/i,
  /\[([A-Z0-9/\-]{4,})\]/i,
  /(?:^|\s)\/([A-Z0-9/\-]{3,})/i,
  /^([A-Z0-9]{1,6}[/\-][A-Z0-9]{1,8}|[A-Z]{1,4}\d{2,5}[A-Z0-9]*)\b/i,
  /-\s*([A-Z0-9]{2,}[A-Z0-9\-]*)\s*$/i,
  /\b[A-Z]{1,5}[-_/]?[A-Z0-9]*\d[A-Z0-9-]{2,}\b/,
  /\b\d{4,6}\b/,
];

function extractModelFromName(name: string): string | undefined {
  const s = normalizeArabicText(name);
  for (const re of MODEL_PATTERNS) {
    const m = s.match(re);
    const v = (m?.[1] ?? m?.[0] ?? "").trim().replace(/^[([]|[)\]]$/g, "");
    if (v.length >= 3) return v;
  }
  return undefined;
}

// Heuristic: many short lines carrying 3+ separate price-like numbers indicates adjacent tables.
function looksMultiColumn(text: string): boolean {
  const lines = (text ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 10);
  if (lines.length < 15) return false;
  const dense = lines.filter((l) => (l.match(/\d{3,6}(?:[.,]\d+)?/g) ?? []).length >= 4).length;
  return dense / lines.length > 0.35;
}

const SYSTEM = (supplier: string) => `أنت خبير استخراج بيانات قوائم أسعار الموردين.


المورد: ${supplier}

قواعد صارمة جداً — اتبعها حرفياً:
1. انسخ اسم المنتج (product_name) **حرفياً كما هو مكتوب في الملف بدون أي تعديل**.
   - ممنوع الترجمة بين العربي والإنجليزي.
   - ممنوع التصحيح الإملائي أو إعادة الصياغة أو الاختصار أو التوسيع.
   - ممنوع تغيير حالة الأحرف (Upper/Lower) أو ترتيب الكلمات.
   - حافظ على المسافات والرموز والأرقام بنفس الترتيب.
2. استخراج الموديل (model_code) بنظامين:
   - لو فيه عمود مستقل للموديل/الطراز/الكود: انقله كما هو.
   - لو مفيش عمود مستقل والموديل مدمج داخل اسم المنتج (مثل GR-RT468WE أو أرقام موديل 8600 / 9600):
     استخرج كود الموديل وضعه في model_code بدقة، مع إبقاء الاسم كما هو أو تجريده من الكود.
   - حالات إضافية إلزامية لاستخراج model_code:
     * (أ) عمود مستقل أو مسمى "كود": اقرأ الموديل من عمود (الموديل / الطراز / كود / Code / Item Code).
     * (ب) كود محاط بأقواس مثل (ZCG622A6XB) أو [ZCG94396X]: استخرجه كموديل مجرداً من الأقواس.
     * (ج) كود يسبق اسم الصنف مثل "90FC9/1 بوتاجاز..." أو "S6400 بوتاجاز..." أو "HF18 مروحة...": الكود هو الموديل.
     * (د) أكواد فيها شرطة مائلة مثل /KH69015 أو 15/KH690LN أو /E4702 أو KH282/1 LD: تُستخرج بالكامل كموديل نقي.
     * (هـ) كود في نهاية الاسم بعد شرطة مثل "- 2G1664245" أو "- ZQENFIX1": يُستخرج كموديل.
   - ممنوع اختراع كود غير موجود في الوثيقة، وممنوع ترك model_code فارغاً طالما يوجد كود في السطر.
3. لا تخلط بين صفوف مختلفة. كل صف منتج مستقل بذاته.
4. تجاهل الرؤوس والتذييلات وأسطر العناوين والصفوف الفارغة، لكن لا تتجاهل أي منتج حقيقي.


5. category: اختر الأنسب من (ثلاجات، غسالات، تكييف، بوتاجازات، مراوح، ميكروويف، ديب فريزر، مبردات هواء) أو اتركها فارغة لو غير واضحة.
6. cost_price: السعر الأساسي للشراء من المورد — رقم فقط بدون عملة أو فواصل.
7. suggested_sell_price: ابحث عن أي عمود لسعر البيع بأي مسمى:
   (سعر البيع المقترح، سعر المستهلك، القطاعي، سعر العميل، Retail، RRP، Consumer Price).
   لا تضع 0 إلا لو الوثيقة خالية تماماً من أي سعر بيع.
8. اكتب النصوص العربية بحروف عربية قياسية سليمة، وممنوع إخراج رموز مشوهة أو أشكال حروف غير قياسية.

${brandHints(supplier)}
ارجع البيانات كما هي تماماً. الأمانة في النقل أهم من أي تنظيم.`;


// ---- Text-quality inspector: detect mojibake / broken CMap output ----
function textQuality(raw: string) {
  const s = (raw ?? "").replace(/---\s*صفحة\s*\d+\s*---/g, " ");
  const chars = [...s].filter((c) => !/\s/.test(c));
  const total = chars.length;
  if (!total) return { total: 0, corrupt: true, ratio: 1, reason: "empty" };
  let presentation = 0;
  let alien = 0;
  let arabic = 0;
  let latinDigit = 0;
  for (const c of chars) {
    const cp = c.codePointAt(0)!;
    if ((cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) presentation++;
    else if (cp >= 0x0600 && cp <= 0x06ff) arabic++;
    else if (cp < 0x0250) latinDigit++;
    else if (cp !== 0xfffd && (cp < 0x2000 || cp > 0x206f) && (cp < 0x20a0 || cp > 0x20cf)) alien++;
    if (cp === 0xfffd) alien++;
  }
  const known = arabic + latinDigit;
  const ratio = (presentation + alien) / total;
  const reason = ratio > 0.08 ? "suspicious-glyphs" : known / total < 0.6 ? "low-known-chars" : "ok";
  return { total, corrupt: reason !== "ok", ratio, reason };
}

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

// 2026-10-25 review: gemini-2.5 was closed (404) → the shared helper maps to gemini-3.x; Gemini 3 is meant to run at
// its default temperature (a forced 0 can make it loop), and a long list needs a big output budget.
async function callAI(messages: any[]) {
  return await aiChat({
    model: "google/gemini-2.5-flash-lite",
    messages,
    max_tokens: 32768,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "save_price_list" } },
  });
}

// The same product list as a native Gemini JSON schema (PDF read as a file — vision mode)
const PRODUCTS_SCHEMA = {
  type: "OBJECT",
  properties: {
    products: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          product_name: { type: "STRING" }, model_code: { type: "STRING" }, category: { type: "STRING" },
          cost_price: { type: "NUMBER" }, suggested_sell_price: { type: "NUMBER" },
        },
        required: ["product_name", "cost_price"],
      },
    },
  },
  required: ["products"],
};

/** Pages → chunks of at most `max` characters (a page is never split), so each AI call stays small and complete. */
export function chunkPages(pages: string[], max = 18_000): string[] {
  const out: string[] = [];
  let cur = "";
  pages.forEach((p, i) => {
    const block = `--- صفحة ${i + 1} ---\n${(p ?? "").trim()}`;
    if (cur && cur.length + block.length > max) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n\n${block}` : block;
  });
  if (cur) out.push(cur);
  return out;
}

/** Same product twice (a row repeated across a page break / chunk edge) is kept once. */
export function mergeProducts(lists: any[][]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const list of lists) for (const p of list ?? []) {
    const k = `${normalizeArabicText(p?.product_name)}|${String(p?.model_code ?? "").trim()}|${Number(p?.cost_price) || 0}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(p);
  }
  return out;
}

const MAX_PDF_BYTES = 15 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Require authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    // price lists are applied by the company admin only (apply_price_list_update) — don't spend AI quota for others
    const uid = userData.user.id;
    const [{ data: adm }, { data: own }] = await Promise.all([
      authClient.rpc("is_admin", { _user_id: uid }), authClient.rpc("is_owner", { _user_id: uid }),
    ]);
    if (!adm && !own) return json({ error: "قراءة قوائم الأسعار للمدير العام أو صاحب الشركة بس" }, 403);

    const { pdfBase64, supplierName } = await req.json();
    if (!pdfBase64) return json({ error: "pdfBase64 required" }, 400);

    if (!aiConfigured()) return json({ error: "مفتاح الذكاء الاصطناعي (AI_API_KEY) غير مضاف في أسرار Supabase" }, 500);

    const supplier = supplierName ?? "غير محدد";
    const t0 = Date.now();
    const bytes = b64ToBytes(pdfBase64);
    console.log(`[parse] supplier=${supplier} pdfBytes=${bytes.length}`);
    if (bytes.length > MAX_PDF_BYTES) return json({ error: "الملف أكبر من 15 ميجا — قسّمه لأكتر من ملف" }, 413);

    // 1) Try fast text extraction (keep page boundaries to preserve row layout)
    let extractedText = "";
    let pageTexts: string[] = [];
    try {
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: false });
      const pages = Array.isArray(text) ? text : [text ?? ""];
      pageTexts = pages.map((x) => String(x ?? ""));
      extractedText = pages
        .map((p, i) => `--- صفحة ${i + 1} ---\n${(p ?? "").trim()}`)
        .join("\n\n")
        .trim();
      console.log(`[parse] extracted text chars=${extractedText.length} pages=${pages.length} in ${Date.now() - t0}ms`);
    } catch (e) {
      console.warn("[parse] text extraction failed:", e);
    }

    // Decide path: enough text AND clean text quality, otherwise force VISION mode
    const quality = textQuality(extractedText);
    // Multi-column / adjacent-tables layouts (e.g. Zanussi) scramble in raw text mode → force VISION.
    const multiColumn =
      /ZANUSSI/i.test(supplier) || supplier.includes("زانوسي") || looksMultiColumn(extractedText);
    const useText = extractedText.length > 200 && !quality.corrupt && !multiColumn;

    console.log(`[parse] textQuality reason=${quality.reason} ratio=${quality.ratio.toFixed(3)} chars=${quality.total}`);
    console.log(`[parse] mode=${useText ? "TEXT" : "VISION"}`);
    const tAI = Date.now();
    let raw: any[] = [];

    const aiError = (status: number, t: string) => {
      console.error("AI error:", status, t.slice(0, 500));
      if (status === 429) return json({ error: "تم تجاوز حد الاستخدام، حاول لاحقاً" }, 429);
      if (status === 402) return json({ error: "رصيد AI غير كافٍ" }, 402);
      return json({ error: `خطأ AI: ${t.slice(0, 200)}` }, 500);
    };

    if (useText) {
      // every page is read: the old code cut the text at 120,000 characters and lost the rest of a long list
      const chunks = chunkPages(pageTexts);
      const results: any[][] = new Array(chunks.length);
      let next = 0;
      let failed: Response | null = null;
      const worker = async () => {
        while (next < chunks.length && !failed) {
          const i = next++;
          const response = await callAI([
            { role: "system", content: SYSTEM(supplier) },
            { role: "user", content: "النص التالي مستخرج من PDF قائمة أسعار (جزء من الملف). استخرج كل المنتجات منه:\n\n" + chunks[i] },
          ]);
          if (!response.ok) { failed = aiError(response.status, await response.text()); return; }
          const data = await response.json();
          const call = data.choices?.[0]?.message?.tool_calls?.[0];
          try { results[i] = call ? (JSON.parse(call.function.arguments).products ?? []) : []; }
          catch { failed = json({ error: `الجزء ${i + 1} من الملف رجع ناقص من الذكاء الاصطناعي — جرّب تاني أو قسّم الملف` }, 422); return; }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (failed) return failed;
      raw = mergeProducts(results);
      console.log(`[parse] text chunks=${chunks.length}`);
    } else if (geminiNative()) {
      // vision: the PDF itself goes to Gemini's native API (the OpenAI-compatible endpoint has no PDF part)
      const r = await geminiJson({
        model: "google/gemini-2.5-flash",
        system: SYSTEM(supplier),
        parts: [{ text: "استخرج كل المنتجات والأسعار من ملف PDF ده:" }, { inline_data: { mime_type: "application/pdf", data: pdfBase64 } }],
        schema: PRODUCTS_SCHEMA,
      });
      if (r.ok === false) {
        if (r.error === "MAX_TOKENS") return json({ error: "القائمة طويلة جداً على قراءة الصور — قسّم الملف لأكتر من جزء" }, 422);
        return aiError(r.status, r.error);
      }
      raw = r.json?.products ?? [];
    } else {
      // Lovable / another OpenAI-compatible gateway: keep the file part it understands
      const response = await callAI([
        { role: "system", content: SYSTEM(supplier) },
        { role: "user", content: [
          { type: "text", text: "استخرج كل المنتجات والأسعار من ملف PDF التالي:" },
          { type: "file", file: { filename: "pricelist.pdf", file_data: `data:application/pdf;base64,${pdfBase64}` } },
        ] },
      ]);
      if (!response.ok) return aiError(response.status, await response.text());
      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) return json({ error: "لم يتم استخراج أي بيانات من الملف" }, 422);
      try { raw = JSON.parse(toolCall.function.arguments).products ?? []; }
      catch { return json({ error: "الرد رجع ناقص من الذكاء الاصطناعي — قسّم الملف لأكتر من جزء" }, 422); }
    }
    if (!raw.length) return json({ error: "لم يتم استخراج أي بيانات من الملف" }, 422);

    // Safety net: fill any empty model_code from the product name (same logic as the Excel path).
    const products = raw.map((p: any) => ({
      ...p,
      model_code: String(p?.model_code ?? "").trim() || extractModelFromName(String(p?.product_name ?? "")) || "",
    }));
    const withModel = products.filter((p: any) => p.model_code).length;
    console.log(`[parse] extracted ${products.length} products | withModel=${withModel} | ai=${Date.now() - tAI}ms total=${Date.now() - t0}ms`);

    return json({ products, mode: useText ? "text" : "vision" });

  } catch (e) {
    console.error("parse-price-list-pdf error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
