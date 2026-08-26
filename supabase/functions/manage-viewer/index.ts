import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

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

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    email: z.string().trim().email().max(320),
    password: z.string().max(256),
    name: z.string().trim().max(120).optional(),
  }),
  z.object({ action: z.literal("delete"), user_id: z.string().uuid() }),
  z.object({
    action: z.literal("update_password"),
    user_id: z.string().uuid(),
    password: z.string().max(256),
  }),
]);

// Expected validation/business errors deliberately use HTTP 200 so old published
// clients can read `data.error` instead of replacing it with the SDK's generic
// "Edge Function returned a non-2xx status code" message.
function businessError(message: string) {
  return j({ error: message });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return j({ error: "لازم تكون مسجل دخول" }, 401);
    const jwt = authHeader.slice(7);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !ANON_KEY || !SRK) return j({ error: "إعدادات خدمة الحسابات غير متاحة" }, 500);
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(SUPABASE_URL, SRK, { auth: { persistSession: false } });

    // Validate the caller token using the same claims-based path as the other
    // account-management functions. Ownership always comes from the JWT subject.
    const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(jwt);
    const callerId = claimsData?.claims?.sub;
    if (claimsErr || typeof callerId !== "string") {
      return j({ error: "الجلسة منتهية، سجّل دخول تاني" }, 401);
    }

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

    const parsedBody = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsedBody.success) return businessError("البيانات المدخلة غير صحيحة أو ناقصة");
    const body = parsedBody.data;
    const action = body.action;

    if (action === "create") {
      const email = body.email.trim().toLowerCase();
      const password = body.password;
      const name = body.name?.trim() || email.split("@")[0];
      if (!EMAIL_RE.test(email)) return businessError("الإيميل غير صالح. اكتب إيميل حقيقي زي name@company.com");
      const pwdErr = validatePassword(password);
      if (pwdErr) return businessError(pwdErr);

      // Profiles.username is globally unique. Check it before creating an Auth
      // user so a conflicting profile cannot cause create -> rollback loops.
      const { data: usernameProfile, error: usernameErr } = await admin
        .from("profiles")
        .select("id, tenant_id")
        .ilike("username", email)
        .maybeSingle();
      if (usernameErr) return j({ error: "تعذر فحص البريد قبل إنشاء الحساب" }, 500);

      if (usernameProfile?.tenant_id && usernameProfile.tenant_id !== tenantId) {
        return businessError("الإيميل ده مستخدم بالفعل في شركة تانية. استخدم إيميل مختلف.");
      }

      if (usernameProfile?.id) {
        const { data: existingRoles, error: rolesErr } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", usernameProfile.id);
        if (rolesErr) return j({ error: "تعذر فحص صلاحيات الحساب الموجود" }, 500);
        const roleNames = (existingRoles ?? []).map((row: { role: string }) => row.role);

        const protectedRoles = roleNames.filter((role) =>
          ["admin", "owner", "super_admin"].includes(role)
        );
        const incompatibleRoles = roleNames.filter((role) =>
          !["viewer", "partner"].includes(role)
        );
        if (protectedRoles.length > 0 || incompatibleRoles.length > 0) {
          return businessError("الإيميل ده مرتبط بحساب إداري أو موظف. استخدم إيميل مختلف لحساب المراقبة.");
        }

        const { error: updateErr } = await admin.auth.admin.updateUserById(usernameProfile.id, {
          email,
          password,
          email_confirm: true,
          user_metadata: { viewer_for_tenant: tenantId },
        });
        if (updateErr) return businessError(friendlyAuthError(updateErr.message));

        const { error: profileUpdateErr } = await admin
          .from("profiles")
          .update({ is_active: true })
          .eq("id", usernameProfile.id);
        if (profileUpdateErr) return businessError(profileUpdateErr.message);

        const { error: viewerRoleErr } = await admin
          .from("user_roles")
          .upsert(
            { user_id: usernameProfile.id, role: "viewer", tenant_id: tenantId } as any,
            { onConflict: "user_id,role" },
          );
        if (viewerRoleErr) return businessError(viewerRoleErr.message);
        return j({ ok: true, user_id: usernameProfile.id, reused: true });
      }

      // Does an auth user with this email already exist?
      let existingId: string | null = null;
      try {
        for (let page = 1; page <= 20 && !existingId; page += 1) {
          const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (listErr) throw listErr;
          const users = list?.users ?? [];
          existingId = users.find((u) => String(u.email ?? "").toLowerCase() === email)?.id ?? null;
          if (users.length < 1000) break;
        }
      } catch { /* ignore */ }

      let newId: string;
      if (existingId) {
        // Reuse only a clean viewer account from this tenant. An Auth account
        // without a profile may still carry stale cross-tenant roles.
        const { data: prof } = await admin.from("profiles").select("tenant_id").eq("id", existingId).maybeSingle();
        if (prof?.tenant_id && prof.tenant_id !== tenantId) {
          return businessError("الإيميل ده مستخدم في شركة تانية.");
        }
        const { data: authRoles, error: authRolesErr } = await admin
          .from("user_roles")
          .select("role, tenant_id")
          .eq("user_id", existingId);
        if (authRolesErr) return j({ error: "تعذر فحص صلاحيات الحساب الموجود" }, 500);
        const hasForeignTenantRole = (authRoles ?? []).some((row: { tenant_id: string | null }) =>
          Boolean(row.tenant_id && row.tenant_id !== tenantId)
        );
        const hasIncompatibleRole = (authRoles ?? []).some((row: { role: string }) =>
          !["viewer", "partner"].includes(row.role)
        );
        if (hasForeignTenantRole || hasIncompatibleRole) {
          return businessError("الإيميل ده مرتبط بالفعل بحساب أو صلاحيات أخرى. استخدم إيميل مختلف لحساب المراقبة.");
        }
        const { error: upErr } = await admin.auth.admin.updateUserById(existingId, { password, email_confirm: true });
        if (upErr) return businessError(friendlyAuthError(upErr.message));
        newId = existingId;
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { name, viewer_for_tenant: tenantId },
        });
        if (cErr || !created?.user) return businessError(friendlyAuthError(cErr?.message ?? ""));
        newId = created.user.id;
      }

      // profile
      const { error: pErr } = await admin.from("profiles").upsert({
        id: newId, name, username: email, tenant_id: tenantId, is_active: true,
      } as any);
      if (pErr) {
        if (!existingId) await admin.auth.admin.deleteUser(newId);
        return businessError(pErr.message);
      }

      // viewer role (idempotent)
      const { error: rErr } = await admin
        .from("user_roles")
        .upsert({ user_id: newId, role: "viewer", tenant_id: tenantId } as any, { onConflict: "user_id,role" });
      if (rErr) {
        if (!existingId) await admin.auth.admin.deleteUser(newId);
        return businessError(rErr.message);
      }

      return j({ ok: true, user_id: newId, reused: !!existingId });
    }

    if (action === "delete") {
      const userId = body.user_id;
      const { data: tProf } = await admin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
      if (!tProf || tProf.tenant_id !== tenantId) return j({ error: "الحساب ده مش في شركتك" }, 403);
      const { data: tRoles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const tRoleNames = (tRoles ?? []).map((r: any) => r.role);
      if (!tRoleNames.includes("viewer") || tRoleNames.includes("admin") || tRoleNames.includes("owner") || tRoleNames.includes("super_admin")) {
        return businessError("الحسابات اللي ممكن تتمسح من هنا هي حسابات المراقبة بس");
      }
      const otherRoles = tRoleNames.filter((role) => role !== "viewer");
      if (otherRoles.length > 0) {
        const { error: roleDeleteErr } = await admin
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", "viewer");
        if (roleDeleteErr) return businessError(roleDeleteErr.message);
        return j({ ok: true, viewer_role_removed: true });
      }
      const { error: dErr } = await admin.auth.admin.deleteUser(userId);
      if (dErr) return businessError(friendlyAuthError(dErr.message));
      return j({ ok: true });
    }

    if (action === "update_password") {
      const userId = body.user_id;
      const password = body.password;
      const pwdErr = validatePassword(password);
      if (pwdErr) return businessError(pwdErr);
      const { data: tProf } = await admin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
      if (!tProf || tProf.tenant_id !== tenantId) return j({ error: "الحساب ده مش في شركتك" }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return businessError(friendlyAuthError(error.message));
      return j({ ok: true });
    }

    return businessError("إجراء غير معروف");
  } catch (e: any) {
    return j({ error: e?.message ?? String(e) }, 500);
  }
});

function j(o: any, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
