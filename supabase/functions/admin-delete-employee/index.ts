import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Hard-deletes an employee: employee row + login account (profile, roles,
 * branch links, auth user) so the same name/email can be created again later.
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

    const { employee_id } = (await req.json()) ?? {};
    if (!employee_id) return json({ error: 'employee_id مطلوب' }, 400);

    const { data: emp } = await admin
      .from('employees').select('id, user_id, tenant_id, name').eq('id', employee_id).maybeSingle();
    if (!emp || emp.tenant_id !== tenantId) return json({ error: 'الموظف غير موجود' }, 404);
    if (emp.user_id === callerId) return json({ error: 'مينفعش تحذف حسابك أنت' }, 400);

    const userId = emp.user_id as string | null;

    // Block deleting a user that is also a linked partner — partners are removed
    // from the partners screen.
    if (userId) {
      const { data: pu } = await admin
        .from('partner_users').select('id').eq('user_id', userId).maybeSingle();
      if (pu) return json({ error: 'الحساب ده مرتبط بشريك — احذفه من شاشة الشركاء الأول' }, 409);
    }

    const { error: delErr } = await admin.from('employees').delete().eq('id', employee_id);
    if (delErr) return json({ error: delErr.message }, 400);

    if (userId) {
      await admin.from('branch_users').delete().eq('user_id', userId);
      await admin.from('user_roles').delete().eq('user_id', userId);
      await admin.from('user_permissions').delete().eq('user_id', userId);
      await admin.from('user_presence').delete().eq('user_id', userId);
      await admin.from('profiles').delete().eq('id', userId);
      const { error: authDelErr } = await admin.auth.admin.deleteUser(userId);
      if (authDelErr) {
        return json({
          ok: true,
          warning: `اتحذف الموظف بس حساب الدخول لسه موجود: ${authDelErr.message}`,
        });
      }
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
