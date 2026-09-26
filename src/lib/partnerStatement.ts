import { getCairoDayBounds } from "@/lib/cairoDate";
import { supabase } from "@/integrations/supabase/client";
import { withPartnerBalance } from "@/lib/partnerBalances";
import { generatePartnerStatementReport } from "@/utils/generatePDFReport";

export async function downloadPartnerStatementPdf(opts: {
  partnerId: string;
  from?: string;
  to?: string;
  branchName?: string;
  userName?: string;
}) {
  const { partnerId, from, to } = opts;

  // Partner
  const { data: partner, error: pErr } = await supabase
    .from("equity_partners" as any)
    .select("*")
    .eq("id", partnerId)
    .maybeSingle();
  if (pErr || !partner) throw new Error("تعذّر تحميل بيانات الشريك");
  const partnerWithBalance = await withPartnerBalance(partner as any);

  // Opening balance = sum of all txs strictly before "from" (drawings negative)
  let opening = 0;
  if (from) {
    const { data: prior } = await supabase
      .from("partner_transactions" as any)
      .select("transaction_type, amount")
      .eq("partner_id", partnerId)
      .lt("created_at", getCairoDayBounds(from).startIso!);
    (prior ?? []).forEach((t: any) => {
      const a = Number(t.amount) || 0;
      opening += t.transaction_type === "drawing" ? -a : a;
    });
  }

  // Transactions in range
  let q = supabase
    .from("partner_transactions" as any)
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: true });
  if (from) q = q.gte("created_at", getCairoDayBounds(from).startIso!);
  if (to) q = q.lte("created_at", getCairoDayBounds(undefined, to).endIso!);
  const { data: txs } = await q;

  // Last profit share globally (regardless of filter) to satisfy "آخر أرباح"
  const { data: lastProfitTx } = await supabase
    .from("partner_transactions" as any)
    .select("id, amount, created_at, month_year, description, related_voucher_id")
    .eq("partner_id", partnerId)
    .eq("transaction_type", "profit_share")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let lastProfit: {
    date: string; amount: number; monthsCount: number; periodLabel?: string | null;
  } | null = null;

  if (lastProfitTx) {
    let monthsCount = 1;
    let periodLabel: string | null = (lastProfitTx as any).month_year || null;

    // Try to enrich with profit_distributions / fiscal_periods
    const { data: line } = await supabase
      .from("profit_distribution_lines" as any)
      .select("distribution_id, profit_distributions(distribution_date, fiscal_period_id, notes, fiscal_periods(period_start, period_end, name))")
      .eq("partner_transaction_id", (lastProfitTx as any).id)
      .maybeSingle();

    const fp: any = (line as any)?.profit_distributions?.fiscal_periods;
    if (fp?.period_start && fp?.period_end) {
      const s = new Date(fp.period_start);
      const e = new Date(fp.period_end);
      monthsCount = Math.max(
        1,
        (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1
      );
      periodLabel = fp.name || `${fp.period_start} → ${fp.period_end}`;
    }

    lastProfit = {
      date: (lastProfitTx as any).created_at,
      amount: Number((lastProfitTx as any).amount) || 0,
      monthsCount,
      periodLabel,
    };
  }

  // Company name for the stamp block (tenant settings → tenants table fallback)
  let companyName: string | undefined;
  try {
    const { data: st } = await supabase.from("settings").select("value").eq("key", "company").maybeSingle();
    companyName = (st?.value as any)?.name || undefined;
    if (!companyName) {
      const { data: tn } = await supabase.from("tenants").select("name").limit(1).maybeSingle();
      companyName = (tn as any)?.name || undefined;
    }
  } catch { /* stamp falls back to branch name */ }

  await generatePartnerStatementReport({
    partner: partnerWithBalance as any,
    transactions: (txs ?? []) as any[],
    openingBalance: opening,
    filters: { from, to },
    branchName: opts.branchName || "-",
    userName: opts.userName || "-",
    lastProfit,
    companyName,
  });
}
