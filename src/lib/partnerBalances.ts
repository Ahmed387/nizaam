import { supabase } from "@/integrations/supabase/client";

/**
 * أرصدة الشركاء الحقيقية بتتحسب في الـ view `v_partner_balances`
 * (رأس المال + الأرباح − المسحوبات) — جدول equity_partners مفهوش عمود رصيد.
 */
export type PartnerBalance = {
  partner_id: string;
  total_contributions: number;
  total_drawings: number;
  total_profit_share: number;
  current_balance: number;
};

export async function fetchPartnerBalances(tenantId: string): Promise<Map<string, PartnerBalance>> {
  const { data } = await supabase
    .from("v_partner_balances" as any)
    .select("partner_id,total_contributions,total_drawings,total_profit_share,current_balance")
    .eq("tenant_id", tenantId);
  const map = new Map<string, PartnerBalance>();
  ((data as any[]) ?? []).forEach((r: any) => {
    map.set(r.partner_id, {
      partner_id: r.partner_id,
      total_contributions: Number(r.total_contributions || 0),
      total_drawings: Number(r.total_drawings || 0),
      total_profit_share: Number(r.total_profit_share || 0),
      current_balance: Number(r.current_balance || 0),
    });
  });
  return map;
}

export async function fetchPartnerBalance(partnerId: string): Promise<PartnerBalance> {
  const { data } = await supabase
    .from("v_partner_balances" as any)
    .select("partner_id,total_contributions,total_drawings,total_profit_share,current_balance")
    .eq("partner_id", partnerId)
    .maybeSingle();
  const r = (data as any) ?? {};
  return {
    partner_id: partnerId,
    total_contributions: Number(r.total_contributions || 0),
    total_drawings: Number(r.total_drawings || 0),
    total_profit_share: Number(r.total_profit_share || 0),
    current_balance: Number(r.current_balance || 0),
  };
}

/** بيرجّع نسخة من الشريك مضاف لها الرصيد الحقيقي */
export async function withPartnerBalance<T extends { id: string }>(partner: T | null) {
  if (!partner) return partner as any;
  const b = await fetchPartnerBalance(partner.id);
  return { ...partner, ...b } as T & PartnerBalance;
}
