/** نوع قبض الموظف (migration 0270): شهري = مرتب الشهر، يومي = أجر كل يوم في آخر اليوم. */
export type PayType = "monthly" | "daily";

export const PAY_TYPE_LABEL: Record<PayType, string> = { monthly: "شهري", daily: "يومي" };

export const payTypeOf = (e: { pay_type?: string | null } | null | undefined): PayType =>
  e?.pay_type === "daily" ? "daily" : "monthly";

/** النص اللي بيظهر جنب الموظف: «يومي — 200 ج.م في اليوم» / «شهري». */
export function payTypeText(e: { pay_type?: string | null; daily_wage?: number | string | null }, fmt: (n: number) => string): string {
  if (payTypeOf(e) === "daily") {
    const w = Number(e.daily_wage) || 0;
    return w > 0 ? `يومي — ${fmt(w)} في اليوم` : "يومي — أجر اليوم مش متسجل";
  }
  return "شهري";
}

/** يرجّع رسالة الخطأ أو null. */
export function payTypeProblem(payType: PayType, dailyWage: string | number | null | undefined): string | null {
  if (payType !== "daily") return null;
  const w = Number(dailyWage);
  if (!Number.isFinite(w) || w <= 0) return "اكتب أجر اليوم للموظف اليومي";
  return null;
}

/** الحقول اللي بتتحفظ على الموظف. */
export function payTypePatch(payType: PayType, dailyWage: string | number | null | undefined) {
  return payType === "daily"
    ? { pay_type: "daily", daily_wage: Math.round(Number(dailyWage) * 100) / 100 }
    : { pay_type: "monthly" };
}

export type DailyState = "no_attendance" | "payable";

/** حالة يوم مستني من `daily_wage_pending`. */
export const DAILY_STATE_LABEL: Record<DailyState, string> = {
  no_attendance: "الحضور مش متسجل",
  payable: "مستني الصرف",
};

/** فلتر قايمة الموظفين بنوع القبض («الكل» = null). */
export function filterByPayType<T extends { pay_type?: string | null }>(rows: T[], f: PayType | null): T[] {
  return f ? rows.filter((r) => payTypeOf(r) === f) : rows;
}
