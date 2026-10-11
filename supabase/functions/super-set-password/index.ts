import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Platform owner only: set a new password for any login (owner, employee, partner) and make sure the
// account is usable — email confirmed, not banned, profile active. Logged in audit_log.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const { data: c, error: ce } = await anon.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (ce || !c?.claims) return json({ error: 'Unauthorized' }, 401);
    const callerId = c.claims.sub as string;
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', callerId);
    if (!(roles ?? []).some((r: any) => r.role === 'super_admin')) return json({ error: 'صاحب المنصة بس' }, 403);

    const { user_id, new_password } = await req.json().catch(() => ({}));
    const pwd = String(new_password ?? '');
    if (!user_id || !pwd) return json({ error: 'بيانات ناقصة' }, 400);
    if (pwd.length < 8 || !/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) {
      return json({ error: 'كلمة المرور لازم 8 حروف على الأقل وفيها حرف ورقم' }, 400);
    }

    const { error: uErr } = await admin.auth.admin.updateUserById(user_id, {
      password: pwd, email_confirm: true, ban_duration: 'none',
    });
    if (uErr) {
      const friendly = /weak|guess|pwned/i.test(String(uErr.message))
        ? 'كلمة المرور ضعيفة أو مستخدمة بكثرة. اختار كلمة أقوى.'
        : uErr.message;
      return json({ error: friendly }, 422);
    }
    await admin.from('profiles').update({ is_active: true }).eq('id', user_id);

    const { data: prof } = await admin.from('profiles').select('tenant_id, name').eq('id', user_id).maybeSingle();
    await admin.from('audit_log').insert({
      user_id: callerId, user_name: 'super_admin', tenant_id: prof?.tenant_id ?? null,
      action: 'UPDATE', entity: 'user_password', entity_id: user_id, details: { reset_by_platform_owner: true, name: prof?.name ?? null },
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
