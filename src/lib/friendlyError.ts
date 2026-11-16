// Server / browser errors in English → an Arabic sentence that says what to do (owner 2026-11-16).
// Used by rpcErrorText and by the global toast.error wrapper (installFriendlyToasts in main.tsx), so every
// `toast.error(error.message)` across the app shows Arabic without touching each screen.
// Messages already written in Arabic (our own RAISE EXCEPTION texts) pass through unchanged.

type Rule = { test: RegExp; codes?: string[]; text: string };

const RULES: Rule[] = [
  { test: /statement timeout|canceling statement|upstream request timeout|gateway time-?out|\b504\b/i, codes: ["57014"],
    text: "العملية أخدت وقت أطول من المسموح لأن السيرفر مشغول. استنى دقيقة وجرّب تاني، ولو تقرير كبير صغّر الفترة أو اختار فرع واحد." },
  { test: /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected|err_network/i,
    text: "مفيش اتصال بالسيرفر. اتأكد إن النت شغال وجرّب تاني — اللي كتبته لسه موجود." },
  { test: /jwt expired|invalid jwt|jwt.*(malformed|invalid)|refresh.?token|session.*(expired|missing|not found)|auth session missing/i, codes: ["PGRST301", "PGRST303"],
    text: "الجلسة انتهت. حدّث الصفحة، ولو الرسالة اتكررت اعمل خروج ودخول تاني." },
  { test: /permission denied|row-level security|not authori[sz]ed|forbidden|insufficient.?privilege/i, codes: ["42501"],
    text: "معندكش صلاحية للعملية دي. اطلب من المالك أو الأدمن يديك الصلاحية." },
  { test: /duplicate key value|already exists|unique constraint/i, codes: ["23505"],
    text: "البيان ده متسجل قبل كده (مكرر). غيّر الرقم أو الاسم وجرّب تاني." },
  { test: /foreign key constraint|still referenced/i, codes: ["23503"],
    text: "مينفعش تمسح أو تغيّر ده لأنه مستخدم في حاجات تانية (فواتير أو حركات). أرشفه أو اقفله بدل المسح." },
  { test: /not-null constraint|null value in column/i, codes: ["23502"],
    text: "فيه خانة مطلوبة فاضية. كمّل البيانات وجرّب تاني." },
  { test: /check constraint/i, codes: ["23514"],
    text: "فيه قيمة مش مقبولة (زي رقم سالب أو صفر). راجع الأرقام وجرّب تاني." },
  { test: /deadlock detected|could not serialize|lock timeout|could not obtain lock/i, codes: ["40P01", "40001", "55P03"],
    text: "فيه عملية تانية بتعدّل نفس البيانات في نفس اللحظة. جرّب تاني بعد ثواني." },
  { test: /invalid input syntax|invalid input value|out of range|numeric field overflow/i, codes: ["22P02", "22003", "22007", "22008"],
    text: "فيه قيمة مكتوبة بشكل غلط (رقم أو تاريخ). راجعها وجرّب تاني." },
  { test: /value too long/i, codes: ["22001"], text: "فيه نص أطول من المسموح. قصّره وجرّب تاني." },
  { test: /multiple \(or no\) rows|contains 0 rows|no rows returned/i, codes: ["PGRST116"],
    text: "البيان ده مش موجود أو اتمسح. حدّث الصفحة وجرّب تاني." },
  { test: /too many requests|rate limit|\b429\b/i, text: "طلبات كتير في وقت قصير. استنى دقيقة وجرّب تاني." },
  { test: /invalid login credentials/i, text: "الإيميل أو كلمة السر غلط." },
  { test: /email not confirmed/i, text: "الإيميل لسه متأكدش. افتح رسالة التأكيد اللي وصلتك الأول." },
  { test: /edge function returned a non-2xx|functionshttperror|functionsfetcherror/i,
    text: "الخدمة رجّعت خطأ. جرّب تاني بعد شوية، ولو اتكرر بلّغ الأدمن." },
  { test: /payload too large|request entity too large|\b413\b/i, text: "الملف أو البيانات أكبر من المسموح. صغّرها وجرّب تاني." },
  { test: /internal server error|\b50[023]\b|service unavailable|bad gateway/i,
    text: "السيرفر مش بيرد دلوقتي. استنى دقيقة وجرّب تاني." },
];

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

/** Arabic text for an error message (and optional Postgres / PostgREST code). Arabic messages pass through. */
export function friendlyError(message: string | null | undefined, code?: string | null): string {
  const msg = (message ?? "").trim();
  if (!msg && !code) return "حصل خطأ غير متوقع. جرّب تاني.";
  const rule = RULES.find((r) => (code && r.codes?.includes(code)) || r.test.test(msg));
  const firstLatin = msg.search(LATIN);
  // «فشل الحفظ: canceling statement …» → keep our Arabic lead-in, translate the server part
  const lead = firstLatin > 0 && ARABIC.test(msg.slice(0, firstLatin)) ? msg.slice(0, firstLatin).trimEnd() : "";
  if (rule) return lead ? `${lead.replace(/[:：-]\s*$/, "")}: ${rule.text}` : rule.text;
  if (!LATIN.test(msg) || (ARABIC.test(msg) && !lead)) return msg; // our own Arabic message
  if (lead) return msg;                                                // Arabic lead-in + unknown detail: keep as is
  return `حصل خطأ غير متوقع. جرّب تاني، ولو اتكرر صوّر الرسالة دي وابعتها للأدمن: ${msg}`;
}

/** toast.error everywhere shows friendlyError() text. Call once at start-up. */
export function installFriendlyToasts(toast: { error: (...a: any[]) => any }) {
  const orig = toast.error;
  if ((orig as any).__friendly) return;
  const wrapped = (msg: unknown, opts?: any) => {
    const m = typeof msg === "string" ? friendlyError(msg) : msg;
    const o = opts && typeof opts.description === "string" && LATIN.test(opts.description) && !ARABIC.test(opts.description)
      ? { ...opts, description: friendlyError(opts.description) } : opts;
    return orig(m, o);
  };
  (wrapped as any).__friendly = true;
  toast.error = wrapped;
}
