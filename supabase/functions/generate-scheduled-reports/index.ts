import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const onlyTenant = url.searchParams.get("tenant_id");

    // Authorization: allow CRON_SECRET header for automated invocation, otherwise require admin user
    const cronSecret = Deno.env.get("CRON_SECRET");
    const providedCron = req.headers.get("x-cron-secret");
    const isCron = !!cronSecret && providedCron === cronSecret;

    let allowedTenants: string[] | undefined;
    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: userData, error: userErr } = await authClient.auth.getUser();
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Must be admin; if tenant_id specified, must be admin of that tenant
      let roleQuery = admin.from("user_roles").select("tenant_id").eq("user_id", userData.user.id).eq("role", "admin");
      if (onlyTenant) roleQuery = roleQuery.eq("tenant_id", onlyTenant);
      const { data: roles } = await roleQuery.limit(1);
      if (!roles || roles.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // If no tenant_id specified, restrict to tenants where the user is admin
      if (!onlyTenant) {
        const { data: adminTenants } = await admin.from("user_roles")
          .select("tenant_id").eq("user_id", userData.user.id).eq("role", "admin");
        const allowed = (adminTenants ?? []).map((r: any) => r.tenant_id);
        allowedTenants = allowed;
      }
    }

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    let q = admin.from("tenants").select("id, name, is_active, is_suspended");
    if (onlyTenant) q = q.eq("id", onlyTenant);
    if (!isCron && !onlyTenant) q = q.in("id", allowedTenants ?? []);
    const { data: tenants, error: terr } = await q;
    if (terr) throw terr;

    const results: any[] = [];

    for (const t of tenants ?? []) {
      if (!t.is_active || t.is_suspended) continue;

      const sinceISO = periodStart.toISOString();
      const untilISO = periodEnd.toISOString();

      // Sales
      const { data: invoices } = await admin
        .from("invoices")
        .select("id, total, branch_id, created_at, status")
        .eq("tenant_id", t.id)
        .gte("created_at", sinceISO)
        .lte("created_at", untilISO);

      const activeInvs = (invoices ?? []).filter((i: any) => i.status === "active");
      const totalSales = activeInvs.reduce((s, i: any) => s + Number(i.total || 0), 0);

      // Returns
      const { data: returns } = await admin
        .from("returns")
        .select("total_refund")
        .eq("tenant_id", t.id)
        .gte("created_at", sinceISO)
        .lte("created_at", untilISO);
      const totalReturns = (returns ?? []).reduce((s, r: any) => s + Number(r.total_refund || 0), 0);

      // Expenses
      const { data: expenses } = await admin
        .from("expenses")
        .select("amount")
        .eq("tenant_id", t.id)
        .gte("created_at", sinceISO)
        .lte("created_at", untilISO);
      const totalExpenses = (expenses ?? []).reduce((s, e: any) => s + Number(e.amount || 0), 0);

      // Treasury net
      const { data: tr } = await admin
        .from("treasury")
        .select("type, amount")
        .eq("tenant_id", t.id)
        .gte("created_at", sinceISO)
        .lte("created_at", untilISO);
      let trIncome = 0, trExpense = 0;
      for (const r of tr ?? []) {
        if (r.type === "income") trIncome += Number(r.amount || 0);
        else trExpense += Number(r.amount || 0);
      }

      // Per branch breakdown
      const branchMap: Record<string, number> = {};
      for (const i of activeInvs) {
        branchMap[i.branch_id] = (branchMap[i.branch_id] || 0) + Number(i.total || 0);
      }
      const { data: branches } = await admin
        .from("branches")
        .select("id, name")
        .eq("tenant_id", t.id)
        .neq("code", "PARTNER-CASH");
      const perBranch = (branches ?? []).map((b: any) => ({
        branch_id: b.id,
        branch_name: b.name,
        sales: branchMap[b.id] || 0,
      }));

      // Top products
      const { data: items } = await admin
        .from("invoice_items")
        .select("product_name, quantity, total, invoice_id")
        .eq("tenant_id", t.id)
        .in("invoice_id", activeInvs.map((i: any) => i.id).slice(0, 1000) as any);
      const prodMap: Record<string, { qty: number; total: number }> = {};
      for (const it of items ?? []) {
        const k = it.product_name;
        if (!prodMap[k]) prodMap[k] = { qty: 0, total: 0 };
        prodMap[k].qty += Number(it.quantity || 0);
        prodMap[k].total += Number(it.total || 0);
      }
      const topProducts = Object.entries(prodMap)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // Counts
      const { count: invoiceCount } = await admin
        .from("invoices").select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id).gte("created_at", sinceISO).lte("created_at", untilISO);

      const summary = {
        tenant_name: t.name,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        totals: {
          sales: totalSales,
          returns: totalReturns,
          expenses: totalExpenses,
          treasury_income: trIncome,
          treasury_expense: trExpense,
          net_profit: totalSales - totalReturns - totalExpenses,
          invoice_count: invoiceCount ?? 0,
        },
        per_branch: perBranch,
        top_products: topProducts,
      };

      const { data: row, error: ierr } = await admin.from("scheduled_reports").insert({
        tenant_id: t.id,
        period: "weekly",
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        summary,
      }).select("id").single();
      if (ierr) { results.push({ tenant_id: t.id, error: ierr.message }); continue; }

      // Notify all admins of the tenant
      const { data: admins } = await admin
        .from("user_roles").select("user_id").eq("tenant_id", t.id).eq("role", "admin");
      const notifs = (admins ?? []).map((a: any) => ({
        user_id: a.user_id,
        tenant_id: t.id,
        title: "📊 تقرير أسبوعي جديد جاهز",
        body: `تقرير الفترة ${periodStart.toLocaleDateString("ar-EG")} - ${periodEnd.toLocaleDateString("ar-EG")} متاح للتحميل`,
        type: "report",
        related_entity: "scheduled_report",
        related_entity_id: row.id,
        link: "/admin/scheduled-reports",
      }));
      if (notifs.length) await admin.from("notifications").insert(notifs);

      results.push({ tenant_id: t.id, report_id: row.id });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
