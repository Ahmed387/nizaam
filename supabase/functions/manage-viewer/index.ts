import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return j({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SRK);

    // Identify caller
    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !userData.user) return j({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    // Verify caller is admin
    const [{ data: callerProfile }, { data: callerRoles }] = await Promise.all([
      admin.from("profiles").select("tenant_id, name").eq("id", callerId).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", callerId),
    ]);
    const roles = (callerRoles ?? []).map((r: any) => r.role);
    const isAdmin = roles.includes("admin") || roles.includes("super_admin");
    if (!isAdmin || !callerProfile?.tenant_id) return j({ error: "Forbidden" }, 403);
    const tenantId = callerProfile.tenant_id as string;

    const body = await req.json();
    const action = body.action as "create" | "delete" | "update_password";

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const name = String(body.name ?? "").trim() || email.split("@")[0];
      if (!email || !password) return j({ error: "email and password required" }, 400);
      if (password.length < 6) return j({ error: "كلمة المرور 6 أحرف على الأقل" }, 400);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { name, viewer_for_tenant: tenantId },
      });
      if (cErr || !created.user) return j({ error: cErr?.message ?? "create failed" }, 400);
      const newId = created.user.id;

      // profile
      const username = email;
      const { error: pErr } = await admin.from("profiles").upsert({
        id: newId, name, username, tenant_id: tenantId, is_active: true,
      } as any);
      if (pErr) {
        await admin.auth.admin.deleteUser(newId);
        return j({ error: pErr.message }, 400);
      }

      // viewer role
      await admin.from("user_roles").insert({ user_id: newId, role: "viewer" } as any);

      return j({ ok: true, user_id: newId });
    }

    if (action === "delete") {
      const userId = String(body.user_id ?? "");
      if (!userId) return j({ error: "user_id required" }, 400);
      // Ensure target belongs to same tenant & is viewer
      const { data: tProf } = await admin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
      if (!tProf || tProf.tenant_id !== tenantId) return j({ error: "Not in tenant" }, 403);
      const { data: tRoles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const tRoleNames = (tRoles ?? []).map((r: any) => r.role);
      if (!tRoleNames.includes("viewer") || tRoleNames.includes("admin") || tRoleNames.includes("super_admin")) {
        return j({ error: "Only viewer accounts can be deleted here" }, 400);
      }
      const { error: dErr } = await admin.auth.admin.deleteUser(userId);
      if (dErr) return j({ error: dErr.message }, 400);
      return j({ ok: true });
    }

    if (action === "update_password") {
      const userId = String(body.user_id ?? "");
      const password = String(body.password ?? "");
      if (!userId || password.length < 6) return j({ error: "كلمة المرور 6 أحرف على الأقل" }, 400);
      const { data: tProf } = await admin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
      if (!tProf || tProf.tenant_id !== tenantId) return j({ error: "Not in tenant" }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return j({ error: error.message }, 400);
      return j({ ok: true });
    }

    return j({ error: "Unknown action" }, 400);
  } catch (e: any) {
    return j({ error: e.message ?? String(e) }, 500);
  }
});

function j(o: any, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
