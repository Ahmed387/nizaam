/**
 * حساب ساعات العمل من الحضور والانصراف.
 * بيشتغل صح مع الشيفتات اللي بتعدي منتصف الليل لأن الوقتين متخزنين timestamptz،
 * فالفرق بينهم بيتحسب على الزمن الحقيقي مش على اليوم.
 */
export function workedMinutes(checkIn?: string | null, checkOut?: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (!isFinite(a) || !isFinite(b)) return null;
  const diff = Math.round((b - a) / 60000);
  return diff > 0 ? diff : 0;
}

export function formatHours(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function sumWorkedMinutes(rows: { check_in?: string | null; check_out?: string | null }[]): number {
  return rows.reduce((s, r) => s + (workedMinutes(r.check_in, r.check_out) ?? 0), 0);
}
