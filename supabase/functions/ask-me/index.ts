import { aiChat, aiConfigured } from "../_shared/ai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// SEC-005: the model never writes SQL. It picks one report from a fixed list (ai_report_catalog in the
// database) and passes its parameters; ai_report runs a fixed, read-only, parameterised query with the
// user's own rights, inside his company, branches and permissions.
const REPORTS = [
  "sales_summary", "sales_by_day", "top_products", "returns_summary", "purchases_summary", "expenses_by_type",
  "low_stock", "till_balances", "customer_balances", "supplier_balances", "aging", "overdue_installments", "invoice_lookup",
] as const;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_report",
      description:
        "يشغّل تقرير جاهز (قراءة فقط) من قائمة ثابتة ويرجّع النتيجة JSON. استخدمه لأي سؤال يحتاج أرقام أو بيانات فعلية.",
      parameters: {
        type: "object",
        properties: {
          report: { type: "string", enum: REPORTS, description: "اسم التقرير من القائمة." },
          params: {
            type: "object",
            description: "باراميترات التقرير: from / to (YYYY-MM-DD)، branch_id، limit، side (customer|supplier)، as_of، number.",
            properties: {
              from: { type: "string" }, to: { type: "string" }, branch_id: { type: "string" }, limit: { type: "integer" },
              side: { type: "string", enum: ["customer", "supplier"] }, as_of: { type: "string" }, number: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        required: ["report"],
        additionalProperties: false,
      },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "غير مصرح" }, 401);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "غير مصرح" }, 401);

    // Single source of truth for access — same gate the database enforces inside ai_report().
    const { data: level, error: gateError } = await sb.rpc("ask_me_access_level", { _user_id: user.id });
    if (gateError || !level || level === "none") {
      await sb.from("ai_ask_log").insert({ user_id: user.id, kind: "denied", question: null, error: "no access" });
      return json({ error: "معندكش صلاحية استخدام اسألني — كلّم المالك عشان يفعّلها لك" }, 403);
    }
    const scoped = level === "scoped";

    const body = await req.json().catch(() => ({}));
    const history: { role: string; content: string }[] = Array.isArray(body?.messages) ? body.messages : [];
    if (!history.length) return json({ error: "لا توجد رسائل" }, 400);

    if (!aiConfigured()) return json({ error: "مفتاح الذكاء الاصطناعي (AI_API_KEY) غير مضاف في أسرار Supabase" }, 500);

    // ── the fixed list of reports (no table schema is sent to the model any more) ──
    const { data: catalog, error: catErr } = await sb.rpc("ai_report_catalog");
    if (catErr) return json({ error: catErr.message }, 400);
    const reportsText = ((catalog as any[]) ?? [])
      .map((r) => `- ${r.report}(${r.params}): ${r.about}`)
      .join("\n");
    const { data: branchRows } = await sb.from("branches").select("id, name").eq("is_active", true);
    const branchesText = ((branchRows as any[]) ?? []).map((b) => `- ${b.name}: ${b.id}`).join("\n");

    const today = new Date().toISOString().slice(0, 10);

    const system = `أنت "اسألني" — المساعد الذكي لنظام Nizam ERP.

مهمتك: تجاوب على أسئلة المستخدم بأرقام حقيقية من قاعدة البيانات، في حدود الجداول المتاحة له تحت.

قواعد صارمة:
1. أي سؤال فيه أرقام أو بيانات → لازم تستدعي أداة run_report الأول. ممنوع تخمّن أو تخترع رقم أبداً.
2. تقدر تستدعي run_report أكتر من مرة (تقارير مختلفة أو فترات مختلفة) لحد ما توصل للإجابة الكاملة.
3. لو التقرير رجع خطأ في الباراميترات، صلّحها وجرّب تاني (بحد أقصى 3 محاولات).
4. الرد يكون بالعامية المصرية، مختصر وواضح، وبصيغة Markdown. استخدم جداول Markdown لما تعرض أكتر من صف، وخلي الأرقام منسّقة بفواصل وبوحدة "ج.م".
5. لو النتيجة فاضية، قول بوضوح "مفيش بيانات للفترة/الشرط ده" ومتفبركش.
6. ممنوع تماماً أي تعديل على البيانات (حذف/تحديث/إضافة) — الأداة للقراءة فقط.
7. استخدم بس التقارير الموجودة في القائمة تحت. لو السؤال محتاج حاجة مش في القائمة، قول للمستخدم إن التقرير ده مش متاح في "اسألني" ومتحاولش تلتف عليها.
8. في آخر الرد ممكن تقترح سؤال متابعة مفيد سطر واحد.
${scoped ? "\n⚠️ المستخدم ده صلاحياته محدودة: الأرقام اللي هترجع بتخص فرعه/نطاقه فقط، والبيانات الحساسة (المرتبات، الشركاء، الأرباح الموزعة، مصروفات المالك) مش متاحة له إطلاقاً. لو سأل عنها اعتذر بأدب.\n" : ""}
معلومات مهمة:
- تاريخ النهارده: ${today}
- أرصدة العملاء والموردين من الدفتر الموحد: حساب العميل وحساب المورد منفصلين تماماً ومفيش أي مقاصة بينهم.
- لو المستخدم ما حددش فترة، الافتراضي من أول الشهر الحالي لحد النهارده.

الفروع (branch_id):
${branchesText}

التقارير المتاحة:
${reportsText}`;


    const messages: any[] = [
      { role: "system", content: system },
      ...history.slice(-24).map((m) => ({ role: m.role, content: m.content })),
    ];

    const steps: { report: string; params: unknown; rows: number; error?: string }[] = [];

    for (let i = 0; i < 8; i++) {
      const resp = await aiChat({ model: "google/gemini-2.5-flash", messages, tools: TOOLS });

      if (resp.status === 429) return json({ error: "الضغط عالي على الذكاء الاصطناعي، جرّب بعد شوية" }, 429);
      if (resp.status === 402) return json({ error: "رصيد الذكاء الاصطناعي خلص، محتاج تشحن كريدت" }, 402);
      if (!resp.ok) return json({ error: `خطأ من الذكاء الاصطناعي: ${await resp.text()}` }, 500);

      const data = await resp.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) return json({ error: "مفيش رد من الذكاء الاصطناعي" }, 500);

      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        const answer = msg.content ?? "";
        // Audit trail: who asked what, and what the assistant answered.
        await sb.from("ai_ask_log").insert({
          user_id: user.id,
          kind: "question",
          question: history[history.length - 1]?.content ?? "",
          answer,
          rows_returned: steps.reduce((a, s) => a + s.rows, 0),
          steps,
        });
        return json({ content: answer, steps });
      }

      messages.push(msg);

      for (const call of calls) {
        let out: string;
        let report = "";
        let params: Record<string, unknown> = {};
        try {
          const args = JSON.parse(call.function?.arguments ?? "{}");
          report = String(args.report ?? "");
          params = args.params && typeof args.params === "object" ? args.params : {};
          if (!(REPORTS as readonly string[]).includes(report)) throw new Error(`تقرير غير معروف: ${report}`);
          const { data: rows, error } = await sb.rpc("ai_report", { p_report: report, p_params: params });
          if (error) {
            out = JSON.stringify({ error: error.message });
            steps.push({ report, params, rows: 0, error: error.message });
          } else {
            const arr = (rows as any[]) ?? [];
            out = JSON.stringify(arr).slice(0, 60000);
            steps.push({ report, params, rows: arr.length });
          }
        } catch (e) {
          out = JSON.stringify({ error: String(e) });
          steps.push({ report, params, rows: 0, error: String(e) });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: out });
      }
    }

    return json({ content: "الاستفسار معقّد شوية ومقدرتش أوصل لإجابة نهائية — جرّب تسأل بشكل أبسط أو حدّد الفترة.", steps });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
