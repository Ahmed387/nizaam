import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function friendlyAuthError(message: string): string {
  const v = String(message ?? "").toLowerCase();
  if (v.includes("weak") || v.includes("guess") || v.includes("pwned")) {
    return "كلمة المرور ضعيفة أو مستخدمة بكثرة. اختار كلمة أقوى فيها حروف كبيرة وصغيرة وأرقام ورمز.";
  }
  if (v.includes("already been registered") || v.includes("already registered") || v.includes("duplicate")) {
    return "الإيميل ده مستخدم بالفعل في حساب تاني. جرّب إيميل مختلف.";
  }
  if (v.includes("invalid email") || v.includes("email address")) {
    return "الإيميل غير صالح. تأكد إنه إيميل حقيقي زي name@company.com";
  }
  if (v.includes("password should be at least")) {
    return "كلمة المرور قصيرة. لازم 8 أحرف على الأقل وتحتوي على حرف ورقم.";
  }
  return message || "حصل خطأ غير متوقع";
}

function validatePassword(password: string): string | null {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "كلمة المرور لازم تكون 8 أحرف على الأقل وتحتوي على حرف ورقم";
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return j({ error: "لازم تكون مسجل دخول" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SRK);

    // Identify caller
    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !userData.user) return j({ error: "الجلسة منتهية، سجّل دخول تاني" }, 401);
    const callerId = userData.user.id;

    // Verify caller is admin / owner
    const [{ data: callerProfile }, { data: callerRoles }] = await Promise.all([
      admin.from("profiles").select("tenant_id, name").eq("id", callerId).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", callerId),
    ]);
    const roles = (callerRoles ?? []).map((r: any) => r.role);
    let isAdmin = roles.includes("admin") || roles.includes("super_admin") || roles.includes("owner");
    const tenantId = callerProfile?.tenant_id as string | undefined;
    if (!isAdmin && tenantId) {
      const { data: t } = await admin.from("tenants").select("owner_user_id").eq("id", tenantId).maybeSingle();
      if (t?.owner_user_id === callerId) isAdmin = true;
    }
    if (!isAdmin) return j({ error: "مسموح للمدير أو المالك بس" }, 403);
    if (!tenantId) return j({ error: "حسابك مش مربوط بشركة" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as "create" | "delete" | "update_password";

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const name = String(body.name ?? "").trim() || email.split("@")[0];
      if (!email || !password) return j({ error: "الإيميل وكلمة المرور مطلوبين" }, 400);
      if (!EMAIL_RE.test(email)) return j({ error: "الإيميل غير صالح. اكتب إيميل حقيقي زي name@company.com" }, 400);
      const pwdErr = validatePassword(password);
      if (pwdErr) return j({ error: pwdErr }, 400);

      // Does an auth user with this email already exist?
      let existingId: string | null = null;
      try {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        existingId = (list?.users ?? []).find(
          (u: any) => String(u.email ?? "").toLowerCase() === email,
        )?.id ?? null;
      } catch { /* ignore */ }

      let newId: string;
      if (existingId) {
        // Reuse only if the account belongs to this tenant (or has no profile yet)
        const { data: prof } = await admin.from("profiles").select("tenant_id").eq("id", existingId).maybeSingle();
        if (prof?.tenant_id && prof.tenant_id !== tenantId) {
          return j({ error: "الإيميل ده مستخدم في شركة تانية." }, 400);
        }
        const { error: upErr } = await admin.auth.admin.updateUserById(existingId, { password, email_confirm: true });
        if (upErr) return j({ error: friendlyAuthError(upErr.message) }, 400);
        newId = existingId;
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { name, viewer_for_tenant: tenantId },
        });
        if (cErr || !created?.user) return j({ error: friendlyAuthError(cErr?.message ?? "") }, 400);
        newId = created.user.id;
      }

      // profile
      const { error: pErr } = await admin.from("profiles").upsert({
        id: newId, name, username: email, tenant_id: tenantId, is_active: true,
      } as any);
      if (pErr) {
        if (!existingId) await admin.auth.admin.deleteUser(newId);
        return j({ error: pErr.message }, 400);
      }

      // viewer role (idempotent)
      const { error: rErr } = await admin
        .from("user_roles")
        .upsert({ user_id: newId, role: "viewer", tenant_id: tenantId } as any, { onConflict: "user_id,role" });
      if (rErr) return j({ error: rErr.message }, 400);

      return j({ ok: true, user_id: newId, reused: !!existingId });
    }

    if (action === "delete") {
      const userId = String(body.user_id ?? "");
      if (!userId) return j({ error: "user_id مطلوب" }, 400);
      const { data: tProf } = await admin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
      if (!tProf || tProf.tenant_id !== tenantId) return j({ error: "الحساب ده مش في شركتك" }, 403);
      const { data: tRoles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const tRoleNames = (tRoles ?? []).map((r: any) => r.role);
      if (!tRoleNames.includes("viewer") || tRoleNames.includes("admin") || tRoleNames.includes("super_admin")) {
        return j({ error: "الحسابات اللي ممكن تتمسح من هنا هي حسابات المراقبة بس" }, 400);
      }
      const { error: dErr } = await admin.auth.admin.deleteUser(userId);
      if (dErr) return j({ error: friendlyAuthError(dErr.message) }, 400);
      return j({ ok: true });
    }

    if (action === "update_password") {
      const userId = String(body.user_id ?? "");
      const password = String(body.password ?? "");
      if (!userId) return j({ error: "user_id مطلوب" }, 400);
      const pwdErr = validatePassword(password);
      if (pwdErr) return j({ error: pwdErr }, 400);
      const { data: tProf } = await admin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
      if (!tProf || tProf.tenant_id !== tenantId) return j({ error: "الحساب ده مش في شركتك" }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return j({ error: friendlyAuthError(error.message) }, 400);
      return j({ ok: true });
    }

    return j({ error: "إجراء غير معروف" }, 400);
  } catch (e: any) {
    return j({ error: e?.message ?? String(e) }, 500);
  }
});

function j(o: any, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
