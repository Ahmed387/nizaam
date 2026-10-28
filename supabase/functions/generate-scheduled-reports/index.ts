import { isCronCall } from "../_shared/cron.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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
    const isCron = await isCronCall(req, admin, "generate-scheduled-reports");

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
      let roleQuery = admin.from("user_roles").select("tenant_id").eq("user_id", userData.user.id).in("role", ["admin", "owner"]);
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
          .select("tenant_id").eq("user_id", userData.user.id).in("role", ["admin", "owner"]);
        const allowed = (adminTenants ?? []).map((r: any) => r.tenant_id);
        allowedTenants = allowed;
      }
    }

    // 0133: the week = the last 7 full Cairo days (yesterday and the 6 before), the same days the card reads
    const cairoDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const addDays = (day: string, n: number) => {
      const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
    };
    const toDay = addDays(cairoDay(new Date()), -1);
    const fromDay = addDays(toDay, -6);
    const periodStart = new Date(`${fromDay}T00:00:00+03:00`);
    const periodEnd = new Date(`${toDay}T23:59:59+03:00`);

    let q = admin.from("tenants").select("id, name, is_active, is_suspended");
    if (onlyTenant) q = q.eq("id", onlyTenant);
    if (!isCron && !onlyTenant) q = q.in("id", allowedTenants ?? []);
    const { data: tenants, error: terr } = await q;
    if (terr) throw terr;

    const results: any[] = [];

    for (const t of tenants ?? []) {
      if (!t.is_active || t.is_suspended) continue;

      // Same numbers as the card «لقطة البيزنس» (owner_business_snapshot, owner «نفذ» 2026-10-28): sales by the
      // invoice's day, a return on ITS day (money and cost back), cost of goods at the moving average, expenses =
      // payment vouchers in deductible categories by voucher day. It used to be sales − returns typed that week −
      // expenses, with no cost of goods: 8–15/9 showed 2,872,340 «profit» (the card: 10,015).
      const { data: snap, error: serr } = await admin.rpc("owner_business_snapshot", { p_from: fromDay, p_to: toDay, p_tenant: t.id });
      if (serr) { results.push({ tenant_id: t.id, error: serr.message }); continue; }
      const tot: any = (snap as any)?.total ?? {};
      const num = (v: any) => Number(v ?? 0) || 0;

      // Treasury movement of the week (by the till day, never created_at)
      const { data: tr } = await admin
        .from("treasury")
        .select("type, amount")
        .eq("tenant_id", t.id)
        .gte("transaction_date", fromDay)
        .lte("transaction_date", toDay);
      let trIncome = 0, trExpense = 0;
      for (const r of tr ?? []) {
        if (r.type === "income") trIncome += Number(r.amount || 0);
        else trExpense += Number(r.amount || 0);
      }

      const perBranch = (((snap as any)?.branches ?? []) as any[]).map((b: any) => ({
        branch_id: b.branch_id,
        branch_name: b.branch,
        sales: num(b.sales),
        returns: num(b.returns),
        cogs: num(b.cogs),
        expenses: num(b.expenses),
        net_profit: num(b.net_profit),
      }));

      const { data: weekInvs } = await admin
        .from("invoices")
        .select("id")
        .eq("tenant_id", t.id)
        .eq("status", "active")
        .gte("invoice_date", periodStart.toISOString())
        .lte("invoice_date", periodEnd.toISOString())
        .limit(1000);
      const activeInvs = weekInvs ?? [];

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

      const summary = {
        tenant_name: t.name,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        method: "owner_business_snapshot",
        totals: {
          sales: num(tot.sales),
          returns: num(tot.returns),
          cogs: num(tot.cogs),
          gross_profit: num(tot.gross_profit),
          expenses: num(tot.expenses),
          treasury_income: trIncome,
          treasury_expense: trExpense,
          net_profit: num(tot.net_profit),
          invoice_count: num(tot.invoices),
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
        .from("user_roles").select("user_id").eq("tenant_id", t.id).in("role", ["admin", "owner"]);
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
