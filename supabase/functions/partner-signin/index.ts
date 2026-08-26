import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { email: rawEmail, password: rawPassword } = await req.json().catch(() => ({}));
    const email = String(rawEmail ?? '').trim().toLowerCase();
    const password = String(rawPassword ?? '');
    if (!email || !password) return json({ error: 'بيانات الدخول غير صحيحة' }, 400);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Legacy partners stored the visible email as the profile username while Auth used
    // an internal generated address. Resolve only an active, linked partner account.
    const { data: profiles, error: profileErr } = await admin
      .from('profiles')
      .select('id, is_active')
      .ilike('username', email)
      .eq('is_active', true)
      .limit(5);
    if (profileErr) throw profileErr;

    for (const profile of profiles ?? []) {
      const { data: link } = await admin
        .from('partner_users')
        .select('partner_id, equity_partners!inner(is_active)')
        .eq('user_id', profile.id)
        .maybeSingle();
      if (!link || (link.equity_partners as any)?.is_active !== true) continue;

      const { data: authRecord, error: authLookupErr } = await admin.auth.admin.getUserById(profile.id);
      if (authLookupErr || !authRecord.user?.email) continue;

      const authEmail = authRecord.user.email.toLowerCase();
      const verifier = createClient(url, anonKey, { auth: { persistSession: false } });
      const { error: signInErr } = await verifier.auth.signInWithPassword({ email: authEmail, password });
      if (!signInErr) return json({ ok: true, email: authEmail, password });
    }

    return json({ error: 'بيانات الدخول غير صحيحة' }, 403);
  } catch (error) {
    console.error('partner-signin error:', error);
    return json({ error: 'تعذّر تسجيل الدخول حالياً' }, 500);
  }
});