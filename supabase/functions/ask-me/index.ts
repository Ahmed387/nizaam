import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_sql",
      description:
        "ينفّذ استعلام SELECT للقراءة فقط على قاعدة بيانات النظام ويرجّع النتيجة JSON (بحد أقصى 500 صف). استخدمه لأي سؤال يحتاج أرقام أو بيانات فعلية.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "استعلام PostgreSQL يبدأ بـ SELECT أو WITH، بدون فاصلة منقوطة." },
        },
        required: ["query"],
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

    const { data: allowed, error: permissionError } = await sb.rpc("has_permission", {
      _user_id: user.id,
      _key: "admin_ask_me.view",
    });
    if (permissionError || !allowed) return json({ error: "ليس لديك صلاحية استخدام اسألني" }, 403);

    const body = await req.json().catch(() => ({}));
    const history: { role: string; content: string }[] = Array.isArray(body?.messages) ? body.messages : [];
    if (!history.length) return json({ error: "لا توجد رسائل" }, 400);

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return json({ error: "مفتاح الذكاء الاصطناعي غير مكوّن" }, 500);

    // ── schema snapshot (respects the caller's own permissions when queried later) ──
    const { data: schemaRows, error: schemaErr } = await sb.rpc("ai_sql", {
      query: `select table_name, string_agg(column_name || ':' || data_type, ', ' order by ordinal_position) as columns
              from information_schema.columns
              where table_schema = 'public'
              group by table_name
              order by table_name`,
    });
    if (schemaErr) return json({ error: schemaErr.message }, 400);

    const schemaText = (schemaRows as any[] ?? [])
      .map((r) => `- ${r.table_name}(${r.columns})`)
      .join("\n");

    const today = new Date().toISOString().slice(0, 10);

    const system = `أنت "اسألني" — المساعد الذكي لنظام Nizam ERP، وبتتكلم مع صاحب الشركة نفسه.

مهمتك: تجاوب على أي سؤال عن الشركة (مبيعات، أرباح، تكاليف، مصروفات، مخزون، منتجات، عملاء، موردين، موظفين، مرتبات، حضور، خزنة، محاسبة، شركاء، ورديات… أي حاجة) بأرقام حقيقية من قاعدة البيانات.

قواعد صارمة:
1. أي سؤال فيه أرقام أو بيانات → لازم تستدعي أداة run_sql الأول. ممنوع تخمّن أو تخترع رقم أبداً.
2. تقدر تستدعي run_sql أكتر من مرة لحد ما توصل للإجابة الكاملة.
3. لو الاستعلام رجع خطأ، صلّحه وجرّب تاني (بحد أقصى 3 محاولات لنفس الفكرة).
4. الرد يكون بالعامية المصرية، مختصر وواضح، وبصيغة Markdown. استخدم جداول Markdown لما تعرض أكتر من صف، وخلي الأرقام منسّقة بفواصل وبوحدة "ج.م".
5. لو النتيجة فاضية، قول بوضوح "مفيش بيانات للفترة/الشرط ده" ومتفبركش.
6. في آخر الرد ممكن تقترح سؤال متابعة مفيد سطر واحد.

معلومات مهمة عن قاعدة البيانات:
- تاريخ النهارده: ${today}
- الفواتير في invoices (invoice_date, total, paid_amount, status='active' يعني سارية، و'cancelled' ملغية) والأصناف في invoice_items (quantity, unit_price, cost_price, discount…).
- المرتجعات في returns/return_items، المشتريات/الشحنات في shipments/shipment_items، المصروفات في expenses، الخزنة في treasury، القيود في journal_entries/journal_entry_lines، شجرة الحسابات chart_of_accounts.
- المنتجات في products (name, brand, model, quantity, cost_price, selling_price…) والفروع في branches والموظفين في employees والمرتبات في salaries والحضور في attendance.
- استخدم دايماً joins لجلب أسماء مفهومة (اسم الفرع، اسم المنتج، اسم الموظف) بدل الـ id.
- فلترة الشهر: date_trunc('month', invoice_date) = date_trunc('month', date '2026-07-01') مثلاً.

مخطط الجداول المتاحة:
${schemaText}`;

    const messages: any[] = [
      { role: "system", content: system },
      ...history.slice(-24).map((m) => ({ role: m.role, content: m.content })),
    ];

    const steps: { query: string; rows: number; error?: string }[] = [];

    for (let i = 0; i < 8; i++) {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-3.6-flash", messages, tools: TOOLS }),
      });

      if (resp.status === 429) return json({ error: "الضغط عالي على الذكاء الاصطناعي، جرّب بعد شوية" }, 429);
      if (resp.status === 402) return json({ error: "رصيد الذكاء الاصطناعي خلص، محتاج تشحن كريدت" }, 402);
      if (!resp.ok) return json({ error: `خطأ من الذكاء الاصطناعي: ${await resp.text()}` }, 500);

      const data = await resp.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) return json({ error: "مفيش رد من الذكاء الاصطناعي" }, 500);

      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        return json({ content: msg.content ?? "", steps });
      }

      messages.push(msg);

      for (const call of calls) {
        let out: string;
        let q = "";
        try {
          q = JSON.parse(call.function?.arguments ?? "{}").query ?? "";
          const { data: rows, error } = await sb.rpc("ai_sql", { query: q });
          if (error) {
            out = JSON.stringify({ error: error.message });
            steps.push({ query: q, rows: 0, error: error.message });
          } else {
            const arr = (rows as any[]) ?? [];
            out = JSON.stringify(arr).slice(0, 60000);
            steps.push({ query: q, rows: arr.length });
          }
        } catch (e) {
          out = JSON.stringify({ error: String(e) });
          steps.push({ query: q, rows: 0, error: String(e) });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: out });
      }
    }

    return json({ content: "الاستفسار معقّد شوية ومقدرتش أوصل لإجابة نهائية — جرّب تسأل بشكل أبسط أو حدّد الفترة.", steps });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
