// A scheduled call is trusted when its x-cron-secret header matches either the CRON_SECRET
// function secret or the token stored for that job in public.system_cron_tokens (service-role only).
// pg_cron reads the same token from the table, so no secret ever has to be typed anywhere.
export async function isCronCall(req: Request, admin: any, jobName: string): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided.length < 16) return false;
  const env = Deno.env.get("CRON_SECRET");
  if (env && provided === env) return true;
  const { data } = await admin.from("system_cron_tokens").select("token").eq("name", jobName).maybeSingle();
  return !!data?.token && provided === data.token;
}
