// Employee unified sign-in (secure):
// Receives: email, phone, job_title, password
// Verifies password against bcrypt hash in DB via verify_employee_password()
// If valid → ensures auth user exists, syncs auth password, returns credentials
// Plaintext passwords are NEVER stored in DB.

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
    const password = String(body.password ?? "");

    if (!email || !phone || !jobTitle || !password) {
      return new Response(
        JSON.stringify({ error: "البريد، التليفون، الوظيفة، وكلمة المرور كلها مطلوبة" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find candidate employee
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

    if (!emp || !emp.login_password) {
      return new Response(
        JSON.stringify({ error: "Access Denied — البيانات غير مطابقة" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify password against bcrypt hash via DB function
    const { data: ok, error: verifyErr } = await admin.rpc("verify_employee_password", {
      _employee_id: emp.id,
      _password: password,
    });
    if (verifyErr) throw verifyErr;
    if (!ok) {
      return new Response(
        JSON.stringify({ error: "كلمة المرور غير صحيحة" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let authUserId = emp.user_id as string | null;

    // First-time: create auth user with the plain password (not the hash)
    if (!authUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: emp.name, tenant_id: emp.tenant_id },
      });
      if (createErr) {
        const { data: existing } = await admin.auth.admin.listUsers();
        const found = existing?.users?.find(
          (u: any) => (u.email ?? "").toLowerCase() === email,
        );
        if (!found) throw createErr;
        authUserId = found.id;
        // sync existing user's password to the verified one
        await admin.auth.admin.updateUserById(authUserId, { password });
      } else {
        authUserId = created.user!.id;
      }

      await admin.from("profiles").upsert({
        id: authUserId,
        name: emp.name,
        username: email.split("@")[0],
        tenant_id: emp.tenant_id,
      });

      if (emp.role) {
        await admin.from("user_roles").upsert(
          { user_id: authUserId, role: emp.role, tenant_id: emp.tenant_id },
          { onConflict: "user_id,role" },
        );
      }

      if (emp.branch_id) {
        await admin.from("branch_users").upsert({
          user_id: authUserId, branch_id: emp.branch_id, tenant_id: emp.tenant_id,
        });
      }

      await admin.from("employees").update({ user_id: authUserId }).eq("id", emp.id);
    } else {
      // Returning user: ensure auth password matches what was just verified
      // (covers the case where admin updated the DB hash from a new plain password)
      await admin.auth.admin.updateUserById(authUserId, { password });
    }

    return new Response(
      JSON.stringify({ ok: true, email, password }),
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
