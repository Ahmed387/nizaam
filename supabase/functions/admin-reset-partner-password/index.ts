import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const { data: c, error: ce } = await anon.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (ce || !c?.claims) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const callerId = c.claims.sub as string;

    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', callerId);
    const isSuperAdmin = (roles ?? []).some((r: any) => r.role === 'super_admin');
    const isAdmin = isSuperAdmin || (roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'owner');
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: callerProfile } = await admin.from('profiles').select('tenant_id').eq('id', callerId).maybeSingle();
    const callerTenantId = callerProfile?.tenant_id ?? null;

    const { partner_id, new_password } = await req.json();
    if (!partner_id || !new_password) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (new_password.length < 8 || !/[A-Za-z]/.test(new_password) || !/[0-9]/.test(new_password)) {
      return new Response(JSON.stringify({ error: 'Password must be 8+ chars with a letter and a number' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: link } = await admin.from('partner_users').select('user_id, tenant_id').eq('partner_id', partner_id).maybeSingle();
    if (!link?.user_id) return new Response(JSON.stringify({ error: 'Partner user not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Tenant isolation: only a super_admin may act outside their own company
    if (!isSuperAdmin && (!callerTenantId || link.tenant_id !== callerTenantId)) {
      return new Response(JSON.stringify({ error: 'Forbidden: partner belongs to another tenant' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { error: uErr } = await admin.auth.admin.updateUserById(link.user_id, { password: new_password });
    if (uErr) {
      const friendly = /weak|guess|pwned/i.test(String(uErr.message))
        ? 'كلمة المرور ضعيفة أو مستخدمة بكثرة. اختار كلمة أقوى فيها حروف كبيرة وصغيرة وأرقام ورمز.'
        : uErr.message;
      return new Response(JSON.stringify({ error: friendly }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await admin.from('audit_log').insert({
      user_id: callerId, user_name: 'admin', tenant_id: link.tenant_id,
      action: 'UPDATE', entity: 'partner_password', entity_id: partner_id,
      details: { reset: true },
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
