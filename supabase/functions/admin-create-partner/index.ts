import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

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
    const isAdmin = rolesList.includes('admin') || rolesList.includes('super_admin');
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

    if (!partner_name || !partner_type || !username || !password) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!['capital', 'operating', 'both'].includes(partner_type)) {
      return new Response(JSON.stringify({ error: 'Invalid partner_type' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return new Response(JSON.stringify({ error: 'Password must be 8+ chars with a letter and a number' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check share sum
    const capShare = Number(capital_share) || 0;
    const opShare = Number(operating_share) || 0;
    if (capShare < 0 || capShare > 1 || opShare < 0 || opShare > 1) {
      return new Response(JSON.stringify({ error: 'Shares must be between 0 and 1' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: existingPartners } = await admin
      .from('equity_partners')
      .select('capital_share')
      .eq('tenant_id', tenant_id)
      .eq('is_active', true);
    const currentSum = (existingPartners ?? []).reduce((s: number, p: any) => s + Number(p.capital_share || 0), 0);
    if (currentSum + capShare > 1.0001) {
      return new Response(JSON.stringify({ error: `Total capital shares would exceed 100% (current: ${(currentSum * 100).toFixed(2)}%)` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Username unique per tenant
    const { data: existingUser } = await admin
      .from('profiles').select('id').eq('tenant_id', tenant_id).eq('username', username).maybeSingle();
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Username already exists' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create auth user (email required by supabase; synthesize if not given)
    const authEmail = email || `${username}.partner.${tenant_id.slice(0, 8)}@partner.nizam.local`;
    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { name: partner_name, username, phone },
    });
    if (authErr || !authUser?.user) {
      return new Response(JSON.stringify({ error: authErr?.message ?? 'Failed to create user' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = authUser.user.id;

    try {
      // profile
      await admin.from('profiles').upsert({
        id: userId, name: partner_name, username, tenant_id, is_active: true,
      });
      // equity_partners — do NOT seed balance/totals; trigger on partner_transactions is the source of truth
      const { data: partner, error: partErr } = await admin.from('equity_partners').insert({
        tenant_id, name: partner_name, partner_type,
        capital_share: capShare, operating_share: opShare,
        initial_capital: Number(initial_capital) || 0,
        current_balance: 0,
        total_contributions: 0,
      }).select('*').single();
      if (partErr) throw partErr;

      // link partner_users
      await admin.from('partner_users').insert({
        tenant_id, user_id: userId, partner_id: partner.id, created_by: callerId,
      });
      // role
      await admin.from('user_roles').insert({ user_id: userId, role: 'partner' });
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
        ok: true, partner_id: partner.id, user_id: userId, username, temp_password: password,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
      // rollback auth user on failure
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      throw e;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
