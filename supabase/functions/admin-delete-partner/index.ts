import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Hard-deletes a partner that has NO financial history.
 * Partners with transactions / advances / distributions can only be deactivated.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const callerId = claimsData.claims.sub as string;

    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', callerId);
    const rolesList = (roles ?? []).map((r: any) => r.role);
    if (!rolesList.some((r: string) => ['admin', 'owner', 'super_admin'].includes(r))) {
      return json({ error: 'Forbidden — owner/admin only' }, 403);
    }

    const { data: callerProfile } = await admin
      .from('profiles').select('tenant_id').eq('id', callerId).maybeSingle();
    const tenantId = callerProfile?.tenant_id as string | undefined;
    if (!tenantId) return json({ error: 'Caller has no tenant' }, 403);

    const { partner_id } = (await req.json()) ?? {};
    if (!partner_id) return json({ error: 'partner_id مطلوب' }, 400);

    const { data: partner } = await admin
      .from('equity_partners').select('id, tenant_id, name').eq('id', partner_id).maybeSingle();
    if (!partner || partner.tenant_id !== tenantId) return json({ error: 'الشريك غير موجود' }, 404);

    // Financial history blocks hard delete
    const counts = await Promise.all([
      admin.from('partner_transactions').select('id', { count: 'exact', head: true }).eq('partner_id', partner_id),
      admin.from('partner_advances').select('id', { count: 'exact', head: true }).eq('partner_id', partner_id),
      admin.from('profit_distribution_lines').select('id', { count: 'exact', head: true }).eq('partner_id', partner_id),
    ]);
    const total = counts.reduce((s, c: any) => s + (c.count ?? 0), 0);
    if (total > 0) {
      return json({
        error: 'الشريك ده عليه حركات مالية (رأس مال / سلف / توزيع أرباح) — مينفعش يتحذف، عطّله بس عشان السجل يفضل سليم.',
        has_history: true,
      }, 409);
    }

    const { data: links } = await admin
      .from('partner_users').select('user_id').eq('partner_id', partner_id);
    const userIds = (links ?? []).map((l: any) => l.user_id).filter((u: string) => u && u !== callerId);

    await admin.from('partner_share_history').delete().eq('partner_id', partner_id);
    await admin.from('partner_users').delete().eq('partner_id', partner_id);

    const { error: delErr } = await admin.from('equity_partners').delete().eq('id', partner_id);
    if (delErr) return json({ error: delErr.message }, 400);

    for (const uid of userIds) {
      // Keep accounts that are also employees — only drop the partner role
      const { data: emp } = await admin
        .from('employees').select('id').eq('user_id', uid).maybeSingle();
      if (emp) {
        await admin.from('user_roles').delete().eq('user_id', uid).eq('role', 'partner');
        continue;
      }
      await admin.from('branch_users').delete().eq('user_id', uid);
      await admin.from('user_roles').delete().eq('user_id', uid);
      await admin.from('user_permissions').delete().eq('user_id', uid);
      await admin.from('user_presence').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
