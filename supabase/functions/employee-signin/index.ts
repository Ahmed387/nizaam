// Employee unified sign-in:
// Receives: email, phone, job_title (position)
// Looks up matching employee. If found:
//   - Creates an auth user (first time) using the admin-set login_password
//   - Sets up profiles.tenant_id, user_roles, branch_users (first time)
//   - Returns the email + password so the client can do signInWithPassword
// If no match → 403 Access Denied.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(p: string): string {
  return (p ?? "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(String(body.phone ?? ""));
    const jobTitle = String(body.job_title ?? "").trim();

    if (!email || !phone || !jobTitle) {
      return new Response(
        JSON.stringify({ error: "البريد، التليفون، والوظيفة كلها مطلوبة" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find an active employee with matching email
    const { data: candidates, error: lookupErr } = await admin
      .from("employees")
      .select("*")
      .ilike("email", email)
      .eq("is_active", true);

    if (lookupErr) throw lookupErr;

    const emp = (candidates ?? []).find(
      (e: any) =>
        normalizePhone(e.phone ?? "") === phone &&
        (e.job_title ?? "").trim() === jobTitle,
    );

    if (!emp) {
      return new Response(
        JSON.stringify({ error: "Access Denied — البيانات غير مطابقة" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!emp.login_password) {
      return new Response(
        JSON.stringify({ error: "لم يقم المدير بتعيين كلمة مرور لك بعد" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let authUserId = emp.user_id as string | null;

    // First-time login: create the auth user
    if (!authUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: emp.login_password,
        email_confirm: true,
        user_metadata: { name: emp.name, tenant_id: emp.tenant_id },
      });
      if (createErr) {
        // If user already exists in auth (orphan), try to find them
        const { data: existing } = await admin.auth.admin.listUsers();
        const found = existing?.users?.find(
          (u: any) => (u.email ?? "").toLowerCase() === email,
        );
        if (!found) throw createErr;
        authUserId = found.id;
      } else {
        authUserId = created.user!.id;
      }

      // Ensure profile has correct tenant_id (trigger may have run with null)
      await admin
        .from("profiles")
        .upsert({
          id: authUserId,
          name: emp.name,
          username: email.split("@")[0],
          tenant_id: emp.tenant_id,
        });

      // Assign role
      if (emp.role) {
        await admin
          .from("user_roles")
          .upsert(
            { user_id: authUserId, role: emp.role, tenant_id: emp.tenant_id },
            { onConflict: "user_id,role" },
          );
      }

      // Assign branch
      if (emp.branch_id) {
        await admin
          .from("branch_users")
          .upsert(
            { user_id: authUserId, branch_id: emp.branch_id, tenant_id: emp.tenant_id },
          );
      }

      // Link employee → user
      await admin
        .from("employees")
        .update({ user_id: authUserId })
        .eq("id", emp.id);
    } else {
      // Returning user: ensure password matches what admin set (in case admin changed it)
      await admin.auth.admin.updateUserById(authUserId, {
        password: emp.login_password,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        email,
        password: emp.login_password,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("employee-signin error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "حدث خطأ غير متوقع" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
