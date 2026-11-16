import { supabase } from "@/integrations/supabase/client";
import { printHtml } from "@/lib/export";
import { formatEGP } from "@/lib/format";
import { allowedNow, type AccountUsage } from "@/lib/vesselAccounts";

export type StatementRow = {
  id: string; transaction_date: string; created_at: string; branch_name: string | null; type: "income" | "expense";
  category: string | null; amount: number; is_fee: boolean; description: string | null; reference_number: string | null;
  other_account: string | null;
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const lim = (n: number | null) => (n == null ? "مفتوح" : formatEGP(n));

/** One account's section of the PDF (exported for tests). */
export function accountSectionHtml(u: AccountUsage, vesselLabel: string, rows: StatementRow[], from: string, to: string): string {
  const inn = rows.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.amount), 0);
  const out = rows.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);
  const left = allowedNow(u);
  const dLeft = u.daily_limit == null ? null : Math.max(0, Number(u.daily_limit) - Number(u.sent_today));
  const mLeft = u.monthly_limit == null ? null : Math.max(0, Number(u.monthly_limit) - Number(u.sent_month));
  const body = rows.length
    ? rows.map((r) => `<tr>
        <td>${esc(r.transaction_date)}</td><td>${esc(r.branch_name ?? "")}</td>
        <td>${esc(r.description ?? "")}${r.is_fee ? " (عمولة)" : ""}</td>
        <td dir="ltr">${esc(r.other_account ?? "")}</td><td dir="ltr">${esc(r.reference_number ?? "")}</td>
        <td class="num">${r.type === "income" ? formatEGP(r.amount) : ""}</td>
        <td class="num">${r.type === "expense" ? formatEGP(r.amount) : ""}</td></tr>`).join("")
    : `<tr><td colspan="7" style="text-align:center">مفيش حركات في الفترة</td></tr>`;
  return `<section style="page-break-inside:avoid;margin-bottom:18px">
    <h2 style="margin:0 0 4px">${esc(u.holder_name)} — <span dir="ltr">${esc(u.account_number)}</span></h2>
    <div style="color:#555;margin-bottom:6px">${esc(vesselLabel)}${u.is_active ? "" : " (موقوف)"} — الرصيد الحالي: <b>${formatEGP(u.balance)}</b></div>
    <table><thead><tr><th></th><th>الليميت</th><th>اتبعت</th><th>المتبقي</th></tr></thead><tbody>
      <tr><td>النهارده</td><td class="num">${lim(u.daily_limit)}</td><td class="num">${formatEGP(u.sent_today)}</td><td class="num">${dLeft == null ? "—" : formatEGP(dLeft)}</td></tr>
      <tr><td>الشهر ده</td><td class="num">${lim(u.monthly_limit)}</td><td class="num">${formatEGP(u.sent_month)}</td><td class="num">${mLeft == null ? "—" : formatEGP(mLeft)}</td></tr>
    </tbody></table>
    <div style="margin:4px 0 8px">المسموح يتبعت دلوقتي: <b>${left == null ? "مفتوح" : formatEGP(left)}</b></div>
    <h3 style="margin:6px 0">كشف الحركات من ${esc(from)} إلى ${esc(to)}</h3>
    <table><thead><tr><th>التاريخ</th><th>الفرع</th><th>البيان</th><th>الطرف التاني</th><th>رقم العملية</th><th>وارد</th><th>صادر</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><th colspan="5">الإجمالي</th><th class="num">${formatEGP(inn)}</th><th class="num">${formatEGP(out)}</th></tr></tfoot></table>
  </section>`;
}

/** «PDF» of one / several / all vessel accounts: limits, sent and left today / this month, balance, statement of a period. */
export async function printVesselAccounts(accounts: AccountUsage[], labels: Record<string, string>, from: string, to: string) {
  const parts: string[] = [];
  for (const u of accounts) {
    const { data, error } = await (supabase.rpc as any)("vessel_account_statement", { p_account: u.id, p_from: from, p_to: to });
    if (error) throw error;
    parts.push(accountSectionHtml(u, labels[u.payment_method] ?? u.payment_method, (data ?? []) as StatementRow[], from, to));
  }
  printHtml("حسابات الأوعية", `<h1 style="margin:0 0 10px">حسابات الأوعية — ليميت الإرسال والرصيد والحركات</h1>${parts.join("")}`);
}
