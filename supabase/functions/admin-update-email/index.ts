import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // 1) Require authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");

    const { userId, newEmail } = await req.json();
    if (!userId || !newEmail) {
      return new Response(JSON.stringify({ error: "userId and newEmail required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claims, error: cErr } = await userClient.auth.getClaims(token);
    if (cErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = claims.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 2) Caller must be admin (or super_admin) of the target user's tenant
    const { data: callerRoles } = await admin
      .from("user_roles")
      .select("tenant_id, role")
      .eq("user_id", callerId);

    const { data: targetRoles } = await admin
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", userId);

    const isSuper = (callerRoles ?? []).some((r: any) => r.role === "super_admin");
    const callerAdminTenants = new Set(
      (callerRoles ?? []).filter((r: any) => r.role === "admin").map((r: any) => r.tenant_id)
    );
    const targetTenants = new Set((targetRoles ?? []).map((r: any) => r.tenant_id));
    const sharesTenant = [...callerAdminTenants].some((t) => targetTenants.has(t));

    if (!isSuper && !sharesTenant) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await admin.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
    });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, user: data.user }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
