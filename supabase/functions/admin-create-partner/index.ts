import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { friendlyAuthError } from '../_shared/authErrors.ts';

/** Business errors return HTTP 200 with { error } so the client can read the Arabic message. */
const fail = (error: string) =>
  new Response(JSON.stringify({ error }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Finds an existing Auth user by email (paginated). */
async function findUserIdByEmail(admin: any, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users ?? [];
    const hit = users.find((u: any) => String(u.email ?? '').toLowerCase() === email);
    if (hit) return hit.id as string;
    if (users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = claimsData.claims.sub as string;

    // Verify caller is admin/super_admin
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', callerId);
    const rolesList = (roles ?? []).map((r: any) => r.role);
    const isAdmin = rolesList.includes('admin') || rolesList.includes('owner') || rolesList.includes('super_admin');
    const isSuperAdmin = rolesList.includes('super_admin');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden — admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve caller's tenant from profiles — never trust body tenant_id
    const { data: callerProfile, error: callerProfErr } = await admin
      .from('profiles').select('tenant_id').eq('id', callerId).maybeSingle();
    if (callerProfErr || !callerProfile?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Caller has no tenant' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerTenantId = callerProfile.tenant_id as string;

    const body = await req.json();
    const {
      tenant_id: bodyTenantId, partner_name, partner_type,
      capital_share = 0, operating_share = 0, initial_capital = 0,
      username, password, email, phone,
    } = body ?? {};

    // Only super_admin may target a tenant different from their own
    const tenant_id = (isSuperAdmin && bodyTenantId) ? bodyTenantId : callerTenantId;
    if (!isSuperAdmin && bodyTenantId && bodyTenantId !== callerTenantId) {
      return new Response(JSON.stringify({ error: 'Forbidden — cross-tenant operation not allowed' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    if (!partner_name || !partner_type || !username || !password) {
      return fail('املأ كل البيانات المطلوبة (الاسم، النوع، اسم المستخدم، كلمة المرور)');
    }
    if (!['capital', 'operating', 'both'].includes(partner_type)) {
      return fail('نوع الشريك غير صحيح');
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return fail('كلمة المرور لازم تكون 8 أحرف على الأقل وفيها حرف ورقم');
    }

    // Check share sum
    const capShare = Number(capital_share) || 0;
    const opShare = Number(operating_share) || 0;
    if (capShare < 0 || capShare > 1 || opShare < 0 || opShare > 1) {
      return fail('النسب لازم تكون بين 0% و100%');
    }
    const { data: existingPartners } = await admin
      .from('equity_partners')
      .select('capital_share')
      .eq('tenant_id', tenant_id)
      .eq('is_active', true);
    const currentSum = (existingPartners ?? []).reduce((s: number, p: any) => s + Number(p.capital_share || 0), 0);
    if (currentSum + capShare > 1.0001) {
      return fail(`مجموع نسب رأس المال هيتعدى 100% (الحالي: ${(currentSum * 100).toFixed(2)}%)`);
    }

    // Username unique per tenant
    const { data: existingUser } = await admin
      .from('profiles').select('id').eq('tenant_id', tenant_id).eq('username', username).maybeSingle();
    if (existingUser) {
      return fail('اسم المستخدم مستخدم بالفعل — اختار اسم تاني');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return fail('أدخل بريد إلكتروني صحيح للشريك');
    }

    // A real email is mandatory because the unified login screen authenticates by email.
    const authEmail = normalizedEmail;
    let userId: string | null = null;
    let createdNewAuthUser = false;

    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { name: partner_name, username, phone },
    });

    if (authErr || !authUser?.user) {
      // Email already exists in Auth → reuse it when it belongs to this tenant.
      const existingId = await findUserIdByEmail(admin, authEmail);
      if (!existingId) return fail(friendlyAuthError(authErr?.message));

      const { data: prof } = await admin
        .from('profiles').select('tenant_id').eq('id', existingId).maybeSingle();
      if (prof?.tenant_id && prof.tenant_id !== tenant_id) {
        return fail('الإيميل ده مستخدم في شركة تانية — استخدم إيميل مختلف');
      }
      const { data: alreadyPartner } = await admin
        .from('partner_users').select('id').eq('user_id', existingId).maybeSingle();
      if (alreadyPartner) return fail('الحساب ده مربوط بشريك موجود بالفعل');

      const { error: updErr } = await admin.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
        user_metadata: { name: partner_name, username, phone },
      });
      if (updErr) return fail(friendlyAuthError(updErr.message));
      userId = existingId;
    } else {
      userId = authUser.user.id as string;
      createdNewAuthUser = true;
    }

    try {
      // profile
      await admin.from('profiles').upsert({
        id: userId, name: partner_name, username, tenant_id, is_active: true,
      });
      // equity_partners — balances are derived from partner_transactions (v_partner_balances)
      const { data: partner, error: partErr } = await admin.from('equity_partners').insert({
        tenant_id, name: partner_name, partner_type,
        capital_share: capShare, operating_share: opShare,
        initial_capital: Number(initial_capital) || 0,
      }).select('*').single();
      if (partErr) throw partErr;

      // link partner_users
      await admin.from('partner_users').insert({
        tenant_id, user_id: userId, partner_id: partner.id, created_by: callerId,
      });
      // role (idempotent — the account may already carry other roles)
      await admin.from('user_roles').upsert(
        { user_id: userId, role: 'partner', tenant_id },
        { onConflict: 'user_id,role' },
      );
      // initial share history
      await admin.from('partner_share_history').insert({
        tenant_id, partner_id: partner.id,
        capital_share: capShare, operating_share: opShare,
        effective_from: new Date().toISOString().slice(0, 10),
        changed_by: callerId, change_reason: 'Initial share on partner creation',
      });
      // initial capital as contribution transaction — trigger will set balances correctly
      if (Number(initial_capital) > 0) {
        await admin.from('partner_transactions').insert({
          tenant_id, partner_id: partner.id, transaction_type: 'contribution',
          amount: Number(initial_capital),
          description: 'رأس المال المبدئي',
          created_by: callerId,
          month_year: new Date().toISOString().slice(0, 7),
        });
      }

      return new Response(JSON.stringify({
        ok: true, partner_id: partner.id, user_id: userId, email: authEmail,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
      // rollback only accounts we created in this call
      if (createdNewAuthUser && userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
      return fail(friendlyAuthError((e as Error).message));
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
