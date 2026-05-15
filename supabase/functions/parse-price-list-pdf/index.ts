const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pdfBase64, supplierName } = await req.json();
    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: "pdfBase64 required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    console.log("Parsing PDF for supplier:", supplierName, "size:", pdfBase64.length);

    const systemPrompt = `أنت خبير في استخراج البيانات من قوائم أسعار الموردين.
المورد: ${supplierName ?? 'غير محدد'}
استخرج كل صف منتج وأرجع JSON منظم:
- product_name: اسم المنتج
- model_code: رقم الموديل أو الكود (إن وجد)
- category: الفئة (ثلاجات، غسالات، تكييف، بوتاجازات، مراوح، ميكروويف، ديب فريزر، مبردات هواء)
- cost_price: سعر الشراء من المورد (هذا هو السعر الأساسي في القائمة)
- suggested_sell_price: سعر البيع المقترح (إن وجد، وإلا اتركه 0)

ملاحظات:
- الأسعار أرقام فقط بدون فواصل أو عملة
- تجاهل الرؤوس والتذييلات والصفوف الفارغة
- استخرج كل المنتجات بدون استثناء
- إذا لم تجد فئة واضحة، خمنها من اسم المنتج`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
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
        }],
        tool_choice: { type: "function", function: { name: "save_price_list" } },
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "تم تجاوز حد الاستخدام، حاول لاحقاً" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "رصيد AI غير كافٍ" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `خطأ AI: ${t.slice(0, 200)}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "لم يتم استخراج أي بيانات من الملف" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const args = JSON.parse(toolCall.function.arguments);
    console.log("Extracted products:", args.products?.length ?? 0);
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
