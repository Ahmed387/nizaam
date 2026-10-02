import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Owner/admin-only: permanently removes a stray login (no employee/partner link) and its profile/roles. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const { data: c, error: ce } = await anon.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (ce || !c?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const callerId = c.claims.sub as string;
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', callerId);
    if (!(roles ?? []).some((r: any) => ['admin', 'owner', 'super_admin'].includes(r.role))) return json({ error: 'Forbidden' }, 403);

    const { user_id } = (await req.json()) ?? {};
    if (!user_id || user_id === callerId) return json({ error: 'user_id غير صالح' }, 400);

    const [{ data: emp }, { data: pu }] = await Promise.all([
      admin.from('employees').select('id').eq('user_id', user_id).limit(1),
      admin.from('partner_users').select('id').eq('user_id', user_id).limit(1),
    ]);
    if ((emp ?? []).length || (pu ?? []).length) return json({ error: 'الحساب مربوط بموظف أو شريك' }, 409);

    for (const t of ['branch_users', 'user_roles', 'user_permissions', 'user_presence']) {
      await admin.from(t).delete().eq('user_id', user_id);
    }
    await admin.from('profiles').delete().eq('id', user_id);
    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
