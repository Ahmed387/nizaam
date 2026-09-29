// Public edge function: bootstrap a full tenant (company + branches + partners + admin)
// with automatic Chart of Accounts seeding (via trg_seed_coa_on_tenant), treasuries,
// capital contributions, and trial-balance verification. verify_jwt = false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { friendlyAuthError } from '../_shared/authErrors.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface BranchInput { name: string; }
interface PartnerInput { name: string; capital_share: number; operating_share: number; initial_capital: number; }
interface Body {
  company_name: string;
  slug: string;
  admin_name: string;
  admin_email: string;
  admin_password: string;
  branches: BranchInput[];
  partners: PartnerInput[];
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // ---- authorization: only super admins, or an admin whose own tenant setup is unfinished ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "غير مصرح" }, 401);
    }
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { persistSession: false } }
    );
    const { data: claimsRes, error: claimsErr } = await authClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    const callerId = (claimsRes as any)?.claims?.sub as string | undefined;
    if (claimsErr || !callerId) return json({ error: "غير مصرح" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
    const { data: roleRows } = await admin
      .from("user_roles").select("role, tenant_id").eq("user_id", callerId);
    const roles = (roleRows ?? []).map((r: any) => r.role);
    // إعادة التأسيس/الإنشاء: سوبر أدمن فقط، أو مالك الشركة الفعلي (tenants.owner_user_id)
    // وشركته لسه ما اكتملش إعدادها. مجرد دور admin/owner مش كفاية.
    let allowed = roles.includes("super_admin");
    if (!allowed) {
      const { data: prof } = await admin
        .from("profiles").select("tenant_id").eq("id", callerId).maybeSingle();
      if (prof?.tenant_id) {
        const { data: t } = await admin
          .from("tenants").select("setup_completed, owner_user_id").eq("id", prof.tenant_id).maybeSingle();
        allowed = t?.owner_user_id === callerId && t?.setup_completed === false;
      }
    }
    if (!allowed) return json({ error: "غير مصرح بإنشاء شركة جديدة — مالك الشركة أو السوبر أدمن فقط" }, 403);

    const body: Body = await req.json();

    const {
      company_name, slug, admin_name, admin_email, admin_password,
      branches = [], partners = [],
    } = body;

    // ---- validation ----
    if (!company_name?.trim() || !slug?.trim() || !admin_email?.trim() || !admin_password || !admin_name?.trim()) {
      return json({ error: "بيانات ناقصة" }, 400);
    }
    if (admin_password.length < 6) return json({ error: "كلمة المرور قصيرة جداً (6 أحرف على الأقل)" }, 400);
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
      return json({ error: "المعرف (slug) يجب أن يكون أحرف إنجليزية صغيرة وأرقام و-" }, 400);
    }
    if (!branches.length) return json({ error: "أضف فرعاً واحداً على الأقل" }, 400);
    if (branches.some(b => !b.name?.trim())) return json({ error: "كل الفروع لازم تكون بأسماء" }, 400);

    if (partners.length) {
      const totalCap = partners.reduce((s, p) => s + Number(p.capital_share || 0), 0);
      const totalOp = partners.reduce((s, p) => s + Number(p.operating_share || 0), 0);
      if (Math.abs(totalCap - 100) > 0.01) return json({ error: `مجموع نسب رأس المال = ${totalCap}% (لازم = 100%)` }, 400);
      if (Math.abs(totalOp - 100) > 0.01) return json({ error: `مجموع نسب التشغيل = ${totalOp}% (لازم = 100%)` }, 400);
      if (partners.some(p => !p.name?.trim())) return json({ error: "كل الشركاء لازم يكونوا بأسماء" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // ---- 1. slug uniqueness ----
    const { data: existing } = await supabase.from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (existing) return json({ error: "هذا المعرف مستخدم بالفعل" }, 409);

    // ---- 2. create tenant (this triggers trg_seed_coa_on_tenant → seeds 60+ CoA) ----
    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .insert({ name: company_name.trim(), slug, plan: "free", is_active: true, setup_completed: true })
      .select()
      .single();
    if (tErr || !tenant) return json({ error: "فشل إنشاء الشركة: " + (tErr?.message ?? "") }, 500);

    const tenantId = tenant.id;
    const rollback = async (msg: string) => {
      await supabase.from("tenants").delete().eq("id", tenantId);
      return json({ error: msg }, 500);
    };

    // ---- 3. create admin user ----
    const { data: userRes, error: uErr } = await supabase.auth.admin.createUser({
      email: admin_email.trim(),
      password: admin_password,
      email_confirm: true,
      user_metadata: { name: admin_name.trim(), tenant_id: tenantId },
    });
    if (uErr || !userRes?.user) return await rollback(friendlyAuthError(uErr?.message));
    const userId = userRes.user.id;

    await supabase.from("profiles").upsert({
      id: userId, name: admin_name.trim(), username: admin_email.split("@")[0], tenant_id: tenantId,
    });
    const { error: rErr } = await supabase.from("user_roles").insert({
      user_id: userId, role: "admin", tenant_id: tenantId,
    });
    if (rErr) console.error("role insert:", rErr);

    // ---- 4. create branches ----
    const branchIds: { id: string; name: string }[] = [];
    for (const b of branches) {
      const { data: codeRow } = await supabase.rpc("next_branch_code");
      const code = (codeRow as any) ?? `FR-${Math.floor(Math.random() * 999)}`;
      const { data: br, error: bErr } = await supabase.from("branches").insert({
        name: b.name.trim(), code, tenant_id: tenantId, is_active: true,
      }).select().single();
      if (bErr || !br) return await rollback("فشل إنشاء فرع: " + (bErr?.message ?? ""));
      branchIds.push({ id: br.id, name: br.name });
      await supabase.from("branch_users").insert({
        user_id: userId, branch_id: br.id, tenant_id: tenantId,
      });
    }

    // Central financial containers are system-only and never operational branches.
    const { error: systemBranchErr } = await supabase.from("branches").insert([
      { name: "الخزينة الرئيسية (الإدارة)", code: "MAIN-TREASURY", tenant_id: tenantId, is_active: true, is_system: true },
      { name: "خزينة الشركاء", code: "PARTNER-CASH", tenant_id: tenantId, is_active: true, is_system: true },
    ]);
    if (systemBranchErr) return await rollback("فشل تجهيز الأوعية المالية المركزية: " + systemBranchErr.message);

    // ---- 5. create equity partners ----
    const partnerRows: any[] = [];
    for (const p of partners) {
      const { data: pr, error: pErr } = await supabase.from("equity_partners").insert({
        tenant_id: tenantId,
        name: p.name.trim(),
        capital_share: Number(p.capital_share),
        operating_share: Number(p.operating_share),
        initial_capital: Number(p.initial_capital) || 0,
        current_balance: Number(p.initial_capital) || 0,
        is_active: true,
      }).select().single();
      if (pErr || !pr) return await rollback("فشل إنشاء شريك: " + (pErr?.message ?? ""));
      partnerRows.push(pr);
    }

    // ---- 6. post capital contributions: Dr 1100 Cash / Cr 3100 Partner Capital ----
    const today = new Date().toISOString().slice(0, 10);
    const totalCapital = partnerRows.reduce((s, p) => s + Number(p.initial_capital || 0), 0);
    if (totalCapital > 0) {
      const lines: any[] = [
        { account_code: "1100", debit: totalCapital, credit: 0, description: `رأس مال افتتاحي — ${company_name}` },
      ];
      for (const p of partnerRows) {
        const cap = Number(p.initial_capital || 0);
        if (cap > 0) {
          lines.push({ account_code: "3100", debit: 0, credit: cap, description: `مساهمة الشريك ${p.name}` });
        }
      }
      const { error: jeErr } = await supabase.rpc("create_journal_entry", {
        p_tenant_id: tenantId,
        p_entry_date: today,
        p_description: `رأس المال الافتتاحي — ${company_name}`,
        p_source_type: "bootstrap_capital",
        p_source_id: tenantId,
        p_lines: lines,
      });
      if (jeErr) return await rollback("فشل قيد رأس المال: " + jeErr.message);

      // Seed the main branch treasury with the capital cash
      if (branchIds.length) {
        await supabase.from("treasury").insert({
          branch_id: branchIds[0].id,
          tenant_id: tenantId,
          type: "income",
          category: "رصيد افتتاحي",
          amount: totalCapital,
          description: `رأس المال الافتتاحي — ${company_name}`,
          created_by: userId,
        });
      }
    }

    // ---- 7. trial balance verification ----
    const { data: jeLines } = await supabase
      .from("journal_entry_lines")
      .select("debit, credit")
      .eq("tenant_id", tenantId);
    const sumDr = (jeLines ?? []).reduce((s, l) => s + Number(l.debit || 0), 0);
    const sumCr = (jeLines ?? []).reduce((s, l) => s + Number(l.credit || 0), 0);
    const variance = Math.round((sumDr - sumCr) * 100) / 100;

    // ---- 8. count seeded CoA ----
    const { count: coaCount } = await supabase
      .from("chart_of_accounts")
      .select("id", { head: true, count: "exact" })
      .eq("tenant_id", tenantId);

    return json({
      ok: true,
      tenant_id: tenantId,
      user_id: userId,
      branches: branchIds,
      partners: partnerRows.map(p => ({ id: p.id, name: p.name })),
      chart_of_accounts_count: coaCount ?? 0,
      trial_balance: { total_debit: sumDr, total_credit: sumCr, variance, balanced: variance === 0 },
    });
  } catch (e: any) {
    console.error("bootstrap-tenant error:", e);
    return json({ error: e?.message ?? "خطأ غير متوقع" }, 500);
  }
});
