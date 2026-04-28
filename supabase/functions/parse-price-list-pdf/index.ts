const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pdfBase64 } = await req.json();
    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: "pdfBase64 required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    console.log("Received PDF, base64 length:", pdfBase64.length);

    const systemPrompt = `أنت خبير في استخراج البيانات من ملفات PDF لقوائم الأسعار العربية.
سيُعطى لك ملف PDF يحتوي على قائمة منتجات وأسعارها. مهمتك استخراج كل صف منتج وإرجاع JSON منظم.
- استخرج: SKU/الكود (إن وجد)، اسم المنتج، التصنيف (إن وجد)، الوصف (إن وجد)، السعر القديم، السعر الجديد، سعر السوق.
- لو لم يوجد سعر قديم، اجعله 0.
- لو لم يوجد سعر سوق، استخدم نفس السعر الجديد.
- تجاهل الرؤوس والتذييلات والصفوف الفارغة.
- الأسعار أرقام فقط (بدون عملة أو فواصل).
- استخرج كل المنتجات بدون استثناء.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "استخرج كل المنتجات والأسعار من ملف PDF التالي:" },
              { type: "file", file: { filename: "pricelist.pdf", file_data: `data:application/pdf;base64,${pdfBase64}` } },
            ],
          },
        ],
        tools: [{
          type: "function",
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
                      sku: { type: "string", description: "الكود/SKU، أو فارغ لو غير موجود" },
                      product_name: { type: "string", description: "اسم المنتج" },
                      category_name: { type: "string", description: "التصنيف، أو فارغ" },
                      description: { type: "string", description: "وصف اختياري" },
                      old_price: { type: "number", description: "السعر القديم، 0 لو غير موجود" },
                      new_price: { type: "number", description: "السعر الجديد" },
                      market_price: { type: "number", description: "سعر السوق" },
                    },
                    required: ["product_name", "new_price", "old_price", "market_price"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["products"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_price_list" } },
      }),
    });

    console.log("AI gateway status:", response.status);

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "تم تجاوز حد الاستخدام، حاول لاحقاً" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "رصيد AI غير كافٍ، أضف رصيد من إعدادات Lovable Cloud" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `خطأ في خدمة AI: ${t.slice(0, 200)}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call returned. Full response:", JSON.stringify(data).slice(0, 1000));
      return new Response(JSON.stringify({ error: "لم يتم استخراج أي بيانات من الملف" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const args = JSON.parse(toolCall.function.arguments);
    console.log("Extracted products count:", args.products?.length ?? 0);
    return new Response(JSON.stringify({ products: args.products ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-price-list-pdf error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
