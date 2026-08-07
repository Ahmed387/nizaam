import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
/** Roles a tenant admin/owner may ever assign from the employees screen. */
const ALLOWED_EMPLOYEE_ROLES = [
  'admin', 'owner', 'branch_manager', 'accountant', 'cashier',
  'warehouse', 'supervisor', 'worker', 'driver', 'viewer', 'partner',
];


const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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

    const body = await req.json();
    const {
      employee_id, // present => edit mode
      name, job_title, phone, national_id, base_salary, hire_date,
      branch_id, allowed_branch_ids = [], role, is_active = true,
      email, password,
      work_start = null, work_end = null, work_days = [0, 1, 2, 3, 4, 5], late_grace_minutes = 15,
      has_system_access = true,
    } = body ?? {};

    if (!name || !job_title || !branch_id || !role) return json({ error: 'بيانات ناقصة' }, 400);

    // Hard allow-list: this endpoint may NEVER assign platform-level roles.
    if (!ALLOWED_EMPLOYEE_ROLES.includes(String(role))) {
      return json(
        { error: 'الدور غير مسموح من هذه الشاشة — لا يمكن منح صلاحيات على مستوى النظام' },
        403,
      );
    }

    // Branches must belong to caller tenant
    const branchIds: string[] = Array.from(new Set([
      ...(Array.isArray(allowed_branch_ids) ? allowed_branch_ids : []),
      branch_id,
    ].filter(Boolean)));
    const { data: okBranches } = await admin
      .from('branches').select('id').eq('tenant_id', tenantId).in('id', branchIds);
    const okIds = new Set((okBranches ?? []).map((b: any) => b.id));
    if (!okIds.has(branch_id)) return json({ error: 'الفرع غير صالح' }, 400);
    const finalBranchIds = branchIds.filter((b) => okIds.has(b));

    const payload: Record<string, unknown> = {
      name: String(name).trim(),
      job_title,
      phone: phone ? String(phone).trim() : null,
      national_id: national_id ? String(national_id).trim() : null,
      base_salary: Number(base_salary) || 0,
      hire_date: hire_date ?? new Date().toISOString().slice(0, 10),
      branch_id,
      role,
      is_active,
      has_system_access,
      work_start, work_end, work_days, late_grace_minutes,
      email: has_system_access && email ? String(email).trim().toLowerCase() : null,
    };

    // ---------- EDIT ----------
    if (employee_id) {
      const { data: existing } = await admin
        .from('employees').select('id, user_id, tenant_id').eq('id', employee_id).maybeSingle();
      if (!existing || existing.tenant_id !== tenantId) return json({ error: 'الموظف غير موجود' }, 404);

      if (password) {
        if (String(password).length < 6) return json({ error: 'كلمة المرور 6 أحرف على الأقل' }, 400);
        payload.login_password = password;
        if (existing.user_id) {
          await admin.auth.admin.updateUserById(existing.user_id as string, { password });
        }
      }

      const { error: upErr } = await admin.from('employees').update(payload).eq('id', employee_id);
      if (upErr) return json({ error: upErr.message }, 400);

      let userId = existing.user_id as string | null;

      // Create the login account now if it is still missing
      if (!userId && has_system_access && email && password) {
        const created = await createAccount(admin, {
          email: String(email).trim().toLowerCase(),
          password,
          name: payload.name as string,
          tenantId,
          role,
        });
        if ('error' in created) return json({ error: created.error }, 400);
        userId = created.userId;
        await admin.from('employees').update({ user_id: userId }).eq('id', employee_id);
      }

      if (userId) {
        await setRole(admin, userId as string, tenantId, role);
        await syncBranches(admin, userId, tenantId, has_system_access ? finalBranchIds : []);
      }
      return json({ ok: true, employee_id, user_id: userId });
    }

    // ---------- CREATE ----------
    let userId: string | null = null;
    let newlyCreatedUser = false;
    if (has_system_access) {
      if (!email) return json({ error: 'الإيميل مطلوب' }, 400);
      if (!password || String(password).length < 6) return json({ error: 'كلمة المرور 6 أحرف على الأقل' }, 400);
      const emailLower = String(email).trim().toLowerCase();
      const { data: dup } = await admin
        .from('employees').select('id').eq('tenant_id', tenantId).ilike('email', emailLower).maybeSingle();
      if (dup) return json({ error: 'يوجد موظف بنفس الإيميل بالفعل' }, 409);

      const created = await createAccount(admin, {
        email: emailLower, password, name: payload.name as string, tenantId, role,
      });
      if ('error' in created) return json({ error: created.error }, 400);
      userId = created.userId;
      newlyCreatedUser = created.created;
      payload.login_password = password;
    }

    const { data: emp, error: insErr } = await admin
      .from('employees')
      .insert({ ...payload, tenant_id: tenantId, user_id: userId })
      .select('id').single();

    if (insErr || !emp) {
      if (userId && newlyCreatedUser) await admin.auth.admin.deleteUser(userId).catch(() => {});
      return json({ error: insErr?.message ?? 'فشل إضافة الموظف' }, 400);
    }

    if (userId) await syncBranches(admin, userId, tenantId, finalBranchIds);

    return json({ ok: true, employee_id: emp.id, user_id: userId });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function findUserIdByEmail(email: string): Promise<string | null> {
  try {
    const url = `${Deno.env.get('SUPABASE_URL')}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const body = await res.json();
    const found = (body?.users ?? []).find(
      (u: any) => String(u.email ?? '').toLowerCase() === email.toLowerCase(),
    );
    return found?.id ?? null;
  } catch {
    return null;
  }
}

async function createAccount(
  admin: any,
  opts: { email: string; password: string; name: string; tenantId: string; role: string },
): Promise<{ userId: string; created: boolean } | { error: string }> {
  let userId: string | null = null;
  let createdNew = true;
  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
    user_metadata: { name: opts.name, username: opts.email.split('@')[0], tenant_id: opts.tenantId },
  });

  if (authErr || !authUser?.user) {
    // Account already exists in auth (e.g. created earlier / left over) → reuse it
    const existingId = await findUserIdByEmail(opts.email);
    if (!existingId) return { error: authErr?.message ?? 'فشل إنشاء حساب الدخول' };

    // Make sure the existing account belongs to this tenant before reusing it
    const { data: prof } = await admin
      .from('profiles').select('tenant_id').eq('id', existingId).maybeSingle();
    if (prof?.tenant_id && prof.tenant_id !== opts.tenantId) {
      return { error: 'الإيميل ده مستخدم بالفعل في شركة تانية — استخدم إيميل مختلف' };
    }

    await admin.auth.admin.updateUserById(existingId, {
      password: opts.password,
      email_confirm: true,
      user_metadata: { name: opts.name, username: opts.email.split('@')[0], tenant_id: opts.tenantId },
    });
    userId = existingId;
    createdNew = false;
  } else {
    userId = authUser.user.id as string;
  }

  await admin.from('profiles').upsert({
    id: userId, name: opts.name, username: opts.email.split('@')[0], tenant_id: opts.tenantId, is_active: true,
  });
  await setRole(admin, userId!, opts.tenantId, opts.role);
  return { userId: userId!, created: createdNew };
}

/** Employee has exactly ONE role: insert the new one and drop any other stale roles. */
async function setRole(admin: any, userId: string, tenantId: string, role: string) {
  await admin.from('user_roles').upsert(
    { user_id: userId, role, tenant_id: tenantId },
    { onConflict: 'user_id,role' },
  );
  const { data: existing } = await admin.from('user_roles').select('role').eq('user_id', userId);
  const stale = (existing ?? [])
    .map((r: any) => r.role)
    .filter((r: string) => r !== role && r !== 'super_admin' && r !== 'owner');
  if (stale.length) {
    await admin.from('user_roles').delete().eq('user_id', userId).in('role', stale);
  }
}

async function syncBranches(admin: any, userId: string, tenantId: string, branchIds: string[]) {
  const { data: current } = await admin.from('branch_users').select('branch_id').eq('user_id', userId);
  const cur = new Set((current ?? []).map((r: any) => r.branch_id));
  const next = new Set(branchIds);
  const toAdd = [...next].filter((b) => !cur.has(b));
  const toRemove = [...cur].filter((b) => !next.has(b));
  if (toRemove.length) {
    await admin.from('branch_users').delete().eq('user_id', userId).in('branch_id', toRemove);
  }
  if (toAdd.length) {
    await admin.from('branch_users').insert(
      toAdd.map((bid) => ({ user_id: userId, branch_id: bid, tenant_id: tenantId })),
    );
  }
}
