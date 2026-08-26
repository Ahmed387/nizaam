// Employee unified sign-in (secure):
// Receives: email, password (+ optional phone/job_title from older UI)
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
  const normalizedDigits = (p ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  return normalizedDigits.replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(String(body.phone ?? ""));
    const password = String(body.password ?? "");

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "البريد الإلكتروني وكلمة المرور مطلوبين" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find active employees by email. Phone/job_title are labels or optional hints, not login blockers.
    const { data: candidates, error: lookupErr } = await admin
      .from("employees")
      .select("*")
      .ilike("email", email)
      .eq("is_active", true);
    if (lookupErr) throw lookupErr;

    const orderedCandidates = [...(candidates ?? [])].sort((a: any, b: any) => {
      if (!phone) return 0;
      const aMatch = normalizePhone(a.phone ?? "") === phone ? 0 : 1;
      const bMatch = normalizePhone(b.phone ?? "") === phone ? 0 : 1;
      return aMatch - bMatch;
    });

    if (!orderedCandidates.length) {
      return new Response(
        JSON.stringify({ ok: false, error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    let emp: any = null;
    for (const candidate of orderedCandidates) {
      if (!candidate.login_password) continue;
      const { data: ok, error: verifyErr } = await admin.rpc("verify_employee_password", {
        _employee_id: candidate.id,
        _password: password,
      });
      if (verifyErr) throw verifyErr;
      if (ok) {
        emp = candidate;
        break;
      }
    }

    if (!emp) {
      return new Response(
        JSON.stringify({ error: "Access Denied — البريد أو كلمة المرور غير صحيحة" }),
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
        // SECURITY: an auth account already exists for this email but it is NOT linked
        // to this employee row. Never reset its password or re-parent its profile —
        // that would allow taking over an unrelated (possibly other-tenant) account.
        return new Response(
          JSON.stringify({
            error:
              "هذا البريد مرتبط بحساب موجود بالفعل. يجب على مدير الشركة ربط الحساب بالموظف أولاً.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
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

      const { error: linkErr } = await admin
        .from("employees")
        .update({ user_id: authUserId, login_password: null })
        .eq("id", emp.id);
      if (linkErr) {
        await admin.auth.admin.deleteUser(authUserId).catch(() => {});
        throw linkErr;
      }
    } else {
      // Returning user: ensure auth password matches what was just verified
      // (covers the case where admin updated the DB hash from a new plain password)
      const { error: syncErr } = await admin.auth.admin.updateUserById(authUserId, { password });
      if (syncErr) throw syncErr;
      const { error: clearErr } = await admin
        .from("employees")
        .update({ login_password: null })
        .eq("id", emp.id);
      if (clearErr) throw clearErr;
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
