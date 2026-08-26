// Public edge function: creates a new tenant + admin user atomically.
// No auth required (verify_jwt = false).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { friendlyAuthError } from '../_shared/authErrors.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  company_name: string;
  slug: string;
  admin_email: string;
  admin_password: string;
  admin_name: string;
  branch_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body: Body = await req.json();
    const { company_name, slug, admin_email, admin_password, admin_name, branch_name } = body;

    if (!company_name || !slug || !admin_email || !admin_password || !admin_name) {
      return json({ error: "بيانات ناقصة" }, 400);
    }
    if (admin_password.length < 6) return json({ error: "كلمة المرور قصيرة جداً" }, 400);
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
      return json({ error: "الـ slug يجب أن يكون أحرف إنجليزية صغيرة وأرقام و-" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // 1. slug uniqueness
    const { data: existing } = await supabase.from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (existing) return json({ error: "هذا المعرف مستخدم بالفعل، اختر معرف آخر" }, 409);

    // 2. create tenant
    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .insert({ name: company_name, slug, plan: "free", is_active: true })
      .select()
      .single();
    if (tErr || !tenant) return json({ error: "فشل إنشاء الشركة: " + (tErr?.message ?? "") }, 500);

    // 3. create admin user (auto-confirmed for SaaS-no-payment flow)
    const { data: userRes, error: uErr } = await supabase.auth.admin.createUser({
      email: admin_email,
      password: admin_password,
      email_confirm: true,
      user_metadata: { name: admin_name, tenant_id: tenant.id },
    });
    if (uErr || !userRes?.user) {
      await supabase.from("tenants").delete().eq("id", tenant.id);
      return json({ error: friendlyAuthError(uErr?.message) }, 400);
    }

    const userId = userRes.user.id;

    // 4. ensure profile has tenant_id (handle_new_user trigger should have done this, but enforce)
    await supabase.from("profiles").upsert({
      id: userId,
      name: admin_name,
      username: admin_email.split("@")[0],
      tenant_id: tenant.id,
    });

    // 5. assign admin role
    const { error: rErr } = await supabase.from("user_roles").insert({
      user_id: userId,
      role: "admin",
      tenant_id: tenant.id,
    });
    if (rErr) console.error("role insert error", rErr);

    // 6. optional first branch
    let branchId: string | null = null;
    if (branch_name) {
      const { data: codeRow } = await supabase.rpc("next_branch_code");
      const code = (codeRow as any) ?? `FR-${Math.floor(Math.random() * 999)}`;
      const { data: br } = await supabase
        .from("branches")
        .insert({ name: branch_name, code, tenant_id: tenant.id, is_active: true })
        .select()
        .single();
      if (br) {
        branchId = br.id;
        await supabase.from("branch_users").insert({
          user_id: userId,
          branch_id: br.id,
          tenant_id: tenant.id,
        });
      }
    }

    return json({ ok: true, tenant_id: tenant.id, user_id: userId, branch_id: branchId });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? "خطأ غير متوقع" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
