import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** كلمة سر عشوائية سهلة القراءة (من غير حروف بتتلخبط زي O/0 و l/1) */
function randomPassword(len = 8) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const num = '23456789';
  const all = abc + abc.toLowerCase() + num;
  let out = abc[Math.floor(Math.random() * abc.length)] + num[Math.floor(Math.random() * num.length)];
  for (let i = out.length; i < len; i++) out += all[Math.floor(Math.random() * all.length)];
  return out;
}

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
      return json({ error: 'الصلاحية دي للأونر / المدير بس' }, 403);
    }

    const { data: callerProfile } = await admin
      .from('profiles').select('tenant_id').eq('id', callerId).maybeSingle();
    const tenantId = callerProfile?.tenant_id as string | undefined;
    if (!tenantId) return json({ error: 'Caller has no tenant' }, 403);

    const body = await req.json();
    const {
      employee_ids = [],
      branch_id = null,
      mode = 'random',                 // random | fixed
      fixed_password = '',
      force_change = true,
      dry_run = false,
    } = body ?? {};

    if (mode === 'fixed' && String(fixed_password).length < 6) {
      return json({ error: 'كلمة المرور الافتراضية لازم 6 حروف على الأقل' }, 400);
    }

    let q = admin.from('employees')
      .select('id, name, email, role, branch_id, user_id, has_system_access, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    if (Array.isArray(employee_ids) && employee_ids.length) q = q.in('id', employee_ids);
    else if (branch_id) q = q.eq('branch_id', branch_id);

    const { data: emps, error: empErr } = await q;
    if (empErr) return json({ error: empErr.message }, 400);

    const results: any[] = [];

    for (const e of emps ?? []) {
      const name = e.name as string;
      const email = String(e.email ?? '').trim().toLowerCase();

      if (e.has_system_access === false) {
        results.push({ id: e.id, name, email, status: 'skipped', reason: 'الموظف ده مش بيدخل النظام' });
        continue;
      }
      if (!email) {
        results.push({ id: e.id, name, email: '', status: 'skipped', reason: 'مفيش إيميل — ضيفه الأول' });
        continue;
      }
      if (e.user_id) {
        results.push({ id: e.id, name, email, status: 'skipped', reason: 'عنده حساب دخول بالفعل' });
        continue;
      }

      const password = mode === 'fixed' ? String(fixed_password) : randomPassword();

      if (dry_run) {
        results.push({ id: e.id, name, email, status: 'ready', password: '••••••' });
        continue;
      }

      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name,
          username: email.split('@')[0],
          tenant_id: tenantId,
          must_change_password: !!force_change,
        },
      });

      let userId: string | null = created.data?.user?.id ?? null;

      if (!userId) {
        // الحساب موجود في الأوث من قبل → نعيد استخدامه لو من نفس الشركة
        const url = `${Deno.env.get('SUPABASE_URL')}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`;
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        const found = res.ok
          ? (await res.json())?.users?.find((u: any) => String(u.email ?? '').toLowerCase() === email)
          : null;
        if (!found) {
          results.push({ id: e.id, name, email, status: 'failed', reason: created.error?.message ?? 'فشل إنشاء الحساب' });
          continue;
        }
        const { data: prof } = await admin.from('profiles').select('tenant_id').eq('id', found.id).maybeSingle();
        if (prof?.tenant_id && prof.tenant_id !== tenantId) {
          results.push({ id: e.id, name, email, status: 'failed', reason: 'الإيميل ده مستخدم في شركة تانية' });
          continue;
        }
        await admin.auth.admin.updateUserById(found.id, {
          password,
          email_confirm: true,
          user_metadata: {
            name, username: email.split('@')[0], tenant_id: tenantId,
            must_change_password: !!force_change,
          },
        });
        userId = found.id;
      }

      await admin.from('profiles').upsert({
        id: userId, name, username: email.split('@')[0], tenant_id: tenantId, is_active: true,
      });

      const ALLOWED = ['admin', 'owner', 'branch_manager', 'accountant', 'cashier',
        'warehouse', 'supervisor', 'worker', 'driver', 'viewer', 'partner'];
      const role = ALLOWED.includes(String(e.role)) ? e.role : 'cashier';
      await admin.from('user_roles').upsert(
        { user_id: userId, role, tenant_id: tenantId },
        { onConflict: 'user_id,role' },
      );

      if (e.branch_id) {
        const { data: bu } = await admin.from('branch_users')
          .select('branch_id').eq('user_id', userId).eq('branch_id', e.branch_id).maybeSingle();
        if (!bu) {
          await admin.from('branch_users')
            .insert({ user_id: userId, branch_id: e.branch_id, tenant_id: tenantId });
        }
      }

      await admin.from('employees')
        .update({ user_id: userId, login_password: password }).eq('id', e.id);

      results.push({ id: e.id, name, email, status: 'created', password });
    }

    return json({
      ok: true,
      total: results.length,
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
