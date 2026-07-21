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
    const userId = c.claims.sub as string;
    const userEmail = c.claims.email as string | undefined;

    const { current_password, new_password } = await req.json();
    if (!current_password || !new_password) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (new_password.length < 8 || !/[A-Za-z]/.test(new_password) || !/[0-9]/.test(new_password)) {
      return new Response(JSON.stringify({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل وتحتوي حرف ورقم' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!userEmail) return new Response(JSON.stringify({ error: 'No email on account' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // verify current password by signing in on a throwaway client
    const verifier = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
    const { error: vErr } = await verifier.auth.signInWithPassword({ email: userEmail, password: current_password });
    if (vErr) return new Response(JSON.stringify({ error: 'كلمة المرور الحالية غير صحيحة' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { error: uErr } = await admin.auth.admin.updateUserById(userId, { password: new_password });
    if (uErr) return new Response(JSON.stringify({ error: uErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    await admin.from('audit_log').insert({
      user_id: userId, user_name: 'partner', action: 'UPDATE', entity: 'own_password', details: {},
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
