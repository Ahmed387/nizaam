import { aiChat, aiConfigured } from "../_shared/ai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { report_id } = await req.json();
    if (!report_id) return new Response(JSON.stringify({ error: "report_id مطلوب" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: report, error: rerr } = await sb.from("scheduled_reports").select("*").eq("id", report_id).maybeSingle();
    if (rerr || !report) return new Response(JSON.stringify({ error: "تقرير غير موجود" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const s = report.summary || {};
    const t = s.totals || {};

    const prompt = `أنت محلل أعمال خبير لمتاجر التجزئة. حلل التقرير التالي وقدم تحليلاً ذكياً ومختصراً بالعربية.

📅 الفترة: ${new Date(report.period_start).toLocaleDateString("ar-EG")} إلى ${new Date(report.period_end).toLocaleDateString("ar-EG")}

📊 المؤشرات الرئيسية:
- إجمالي المبيعات: ${t.sales ?? 0} ج.م
- المرتجعات: ${t.returns ?? 0} ج.م
- المصروفات: ${t.expenses ?? 0} ج.م
- صافي الربح: ${t.net_profit ?? 0} ج.م
- عدد الفواتير: ${t.invoice_count ?? 0}

🏬 الأداء حسب الفرع:
${(s.per_branch ?? []).map((b: any) => `- ${b.branch_name}: ${b.sales} ج.م`).join("\n")}

🔥 أعلى المنتجات مبيعاً:
${(s.top_products ?? []).slice(0, 10).map((p: any) => `- ${p.name}: كمية ${p.qty}, إجمالي ${p.total} ج.م`).join("\n")}

أعطني تحليلك في 4 أقسام مختصرة (Markdown):

## 🎯 أبرز النتائج
3 نقاط مختصرة

## ⚠️ نقاط التحذير
المشاكل أو الاتجاهات السلبية (إن وجدت)

## 💡 توصيات عملية
3-5 توصيات قابلة للتنفيذ

## 📈 الفرص
الفرص الواعدة بناءً على البيانات

كن مباشراً ومحدداً، استخدم أرقام التقرير، تجنب العموميات.`;

    if (!aiConfigured()) return new Response(JSON.stringify({ error: "مفتاح الذكاء الاصطناعي (AI_API_KEY) غير مضاف في أسرار Supabase" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const aiResp = await aiChat({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "أنت محلل بيانات تجاري محترف، تكتب باللغة العربية بأسلوب مختصر واضح." },
          { role: "user", content: prompt },
        ],
      });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "تم تجاوز الحد المسموح من طلبات الـ AI، حاول لاحقاً" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "يلزم شحن رصيد لاستخدام الذكاء الاصطناعي" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!aiResp.ok) {
      const errText = await aiResp.text();
      throw new Error(`AI error: ${errText}`);
    }

    const data = await aiResp.json();
    const analysis = data?.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
