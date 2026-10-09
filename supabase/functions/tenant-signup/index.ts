// Disabled (SEC-002): companies and their owners are created only from the Super Admin dashboard
// through the bootstrap-tenant function. Public self-registration is no longer allowed.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({ error: "التسجيل الذاتي متوقف — إنشاء الشركات يتم من إدارة النظام فقط" }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
