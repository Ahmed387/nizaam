/**
 * «متابعة» cards (migration 0147): the server's numbers → the cards, in the owner's order. A card that needs an action
 * (something waiting, a period not booked) is marked `attention`.
 */
import { formatEGP } from "@/lib/format";

export type FollowUps = {
  month_from: string; month_to: string;
  approvals_pending: number;
  money_transfers_pending: { count: number; amount: number };
  stock_transfers_pending: number;
  other_income_month: number;
  count_diff_month: number;
  internal_sales_month: { count: number; amount: number };
  partner_advances: { count: number; amount: number };
  period_shares_missing: { from: string; to: string } | null;
};

export type FollowUpKey = "approvals" | "money" | "stock" | "other_income" | "count_diff" | "internal" | "advances" | "shares";
export type FollowUpItem = {
  key: FollowUpKey; label: string; value: number; money: boolean; hint: string; to: string;
  attention: boolean; meaning: string; formula: string;
};

export function followUpItems(d: FollowUps): FollowUpItem[] {
  const n = (x: unknown) => Number(x ?? 0);
  const items: FollowUpItem[] = [
    { key: "approvals", label: "طلبات موافقة مستنية", value: n(d.approvals_pending), money: false, hint: "تعديل / استرجاع مستني ردك",
      to: "/admin/approvals-hub?tab=approvals", attention: n(d.approvals_pending) > 0,
      meaning: "طلبات تعديل أو استرجاع من الموظفين مستنية موافقتك", formula: "عدد الطلبات اللي حالتها «مستني»" },
    { key: "money", label: "تحويل فلوس مستني الاستلام", value: n(d.money_transfers_pending?.amount), money: true,
      hint: `${n(d.money_transfers_pending?.count)} تحويل`, to: "/admin/main-treasury", attention: n(d.money_transfers_pending?.count) > 0,
      meaning: "فلوس اتبعتت من فرع لفرع والفرع التاني لسه ماأكدش", formula: "مجموع التحويلات اللي لسه ماتأكدتش ولا اترفضت" },
    { key: "stock", label: "تحويل بضاعة مستني", value: n(d.stock_transfers_pending), money: false, hint: "لسه الفرع التاني ماستلمش",
      to: "/admin/dashboard#branches", attention: n(d.stock_transfers_pending) > 0,
      meaning: "بضاعة اتبعتت لفرع ولسه ماتأكدتش", formula: "عدد تحويلات البضاعة المستنية" },
    { key: "other_income", label: "إيرادات أخرى الشهر ده", value: n(d.other_income_month), money: true, hint: "زي عمولة التحويل على العميل",
      to: "/admin/accounting/income-statement", attention: false,
      meaning: "إيرادات مش من البيع، زي العمولة اللي العميل دفعها", formula: "سطر «إيرادات أخرى» في قائمة الدخل من أول الشهر" },
    { key: "count_diff", label: "فروقات الجرد الشهر ده", value: n(d.count_diff_month), money: true, hint: "زيادة − عجز",
      to: "/admin/accounting/income-statement", attention: Math.abs(n(d.count_diff_month)) > 0.005,
      meaning: "اللي الجرد لقاه زيادة أو ناقص عن الدفاتر", formula: "زيادة الجرد − عجز الجرد من أول الشهر" },
    { key: "internal", label: "مبيعات لفروعنا الشهر ده", value: n(d.internal_sales_month?.amount), money: true,
      hint: `${n(d.internal_sales_month?.count)} فاتورة لحساب فرع داخلي`, to: "/admin/reports-hub?tab=snapshot", attention: false,
      meaning: "فواتير بيع لحسابات معلّمة «فرع داخلي» — جوه المبيعات بس مش بيع لبره", formula: "مجموع الفواتير الشغالة من غير الضريبة من أول الشهر" },
    { key: "advances", label: "سلف الشركاء", value: n(d.partner_advances?.amount), money: true,
      hint: `${n(d.partner_advances?.count)} سلفة — بتتخصم من التوزيع الجاي`, to: "/admin/financial-position?tab=partners",
      attention: n(d.partner_advances?.amount) > 0,
      meaning: "اللي الشركاء سحبوه أكتر من ربحهم", formula: "مجموع الباقي من كل سلفة مفتوحة" },
  ];
  // a waiting stock transfer is handled inside its branch — the card shows only while there is one
  const out = items.filter((it) => it.key !== "stock" || it.value > 0);
  if (d.period_shares_missing) {
    out.push({ key: "shares", label: "حصص التشغيل لسه متسجلتش", value: 0, money: false,
      hint: `فترة ${d.period_shares_missing.from} → ${d.period_shares_missing.to}`, to: "/admin/financial-position?tab=partners", attention: true,
      meaning: "في شريك ليه حصة تشغيل أو مرتب نسبة، والشهر اللي فات لسه حصصه متسجلتش — التوزيع هيرفض لحد ما تتسجل",
      formula: "مفيش حصص تشغيل / مرتبات مسجلة للشهر اللي فات" });
  }
  return out;
}

/** One line for a notification / the top of the page: what needs the owner now. */
export function followUpSummary(d: FollowUps): string {
  const parts: string[] = [];
  if (Number(d.approvals_pending) > 0) parts.push(`${d.approvals_pending} طلب موافقة`);
  if (Number(d.money_transfers_pending?.count) > 0) parts.push(`${formatEGP(d.money_transfers_pending.amount)} تحويل مستني`);
  if (Number(d.partner_advances?.amount) > 0) parts.push(`سلف شركاء ${formatEGP(d.partner_advances.amount)}`);
  if (d.period_shares_missing) parts.push("حصص تشغيل الشهر اللي فات");
  return parts.join(" • ");
}
