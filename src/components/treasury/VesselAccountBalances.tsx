import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadAllPaymentMethods } from "@/lib/paymentMethods";
import { formatEGP } from "@/lib/format";

type Row = { payment_method: string; vessel_account_id: string | null; holder_name: string | null; account_number: string | null;
             is_active: boolean; balance: number; movements: number };

/**
 * «رصيد كل حساب» (0244): the balance of every vessel account (رقم أحمد / رقم محمد …), for one branch or the whole
 * company. «من غير حساب» = movements before the accounts were added (or a screen that doesn't ask for one).
 * Shown only for vessels that have accounts.
 */
export function VesselAccountBalances({ branchId }: { branchId?: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let off = false;
    (supabase.rpc as any)("vessel_account_balances", { p_branch: branchId ?? null })
      .then(({ data }: any) => { if (!off) setRows((data ?? []) as Row[]); });
    loadAllPaymentMethods().then((m) => { if (!off) setLabels(Object.fromEntries(m.map((x) => [x.value, x.label]))); });
    return () => { off = true; };
  }, [branchId]);

  const withAcc = new Set((rows ?? []).filter((r) => r.holder_name).map((r) => r.payment_method));
  if (!withAcc.size) return null;
  const vessels = [...withAcc];

  return (
    <div className="card-elevated p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="font-extrabold">رصيد كل حساب في الأوعية</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {vessels.map((v) => {
          const list = (rows ?? []).filter((r) => r.payment_method === v);
          const total = list.reduce((s, r) => s + Number(r.balance || 0), 0);
          return (
            <div key={v} className="rounded-xl border border-border p-3 bg-surface-2/50">
              <div className="flex justify-between font-bold mb-2">
                <span>{labels[v] ?? v}</span>
                <span className="tabular-nums">{formatEGP(total)}</span>
              </div>
              <div className="space-y-1 text-sm">
                {list.map((r) => (
                  <div key={r.vessel_account_id ?? "none"} className={`flex justify-between gap-2 ${r.is_active ? "" : "opacity-60"}`}>
                    <span className="truncate">
                      {r.holder_name ?? "من غير حساب (حركات قبل الحسابات)"}
                      {r.account_number && <span className="text-xs text-muted-foreground" dir="ltr"> {r.account_number}</span>}
                    </span>
                    <span className={`tabular-nums font-semibold ${Number(r.balance) < 0 ? "text-destructive" : ""}`}>{formatEGP(Number(r.balance))}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
