/** Maps Supabase Auth error messages to clear Arabic messages shown to users. */
export function friendlyAuthError(raw?: string | null): string {
  const m = (raw ?? "").toLowerCase();
  if (!m) return "حصل خطأ غير متوقع، حاول تاني";
  if (m.includes("weak") || m.includes("easy to guess") || m.includes("pwned") || m.includes("known to be"))
    return "كلمة المرور ضعيفة أو مستخدمة بكثرة. اختار كلمة أقوى فيها حروف كبيرة وصغيرة وأرقام ورمز.";
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("duplicate"))
    return "الإيميل ده مستخدم بالفعل. استخدم إيميل مختلف.";
  if (m.includes("invalid email") || m.includes("email address") && m.includes("invalid"))
    return "الإيميل غير صالح. اكتب إيميل حقيقي زي name@company.com";
  if (m.includes("password should be at least") || m.includes("at least 6"))
    return "كلمة المرور قصيرة. لازم 8 حروف على الأقل وفيها حرف ورقم.";
  if (m.includes("invalid login credentials"))
    return "الإيميل أو كلمة المرور غير صحيحة.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "محاولات كتير في وقت قصير. استنى شوية وحاول تاني.";
  return raw ?? "حصل خطأ غير متوقع، حاول تاني";
}
