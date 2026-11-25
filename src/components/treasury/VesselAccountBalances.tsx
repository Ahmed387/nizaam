import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileDown, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadAllPaymentMethods } from "@/lib/paymentMethods";
import { formatEGP } from "@/lib/format";
import { allowedNow, loadAccountUsage, usedPct, type AccountUsage } from "@/lib/vesselAccounts";
import { printVesselAccounts } from "@/lib/vesselAccountPdf";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cairoTodayDay } from "@/lib/cairoDate";
import { rpcErrorText } from "@/lib/rpcError";

type Row = { payment_method: string; vessel_account_id: string | null; holder_name: string | null; account_number: string | null;
             is_active: boolean; balance: number; movements: number };

function Bar({ label, sent, limit }: { label: string; sent: number; limit: number | null }) {
  const pct = usedPct(sent, limit);
  if (pct == null) return <div className="text-[11px] text-muted-foreground">{label}: اتبعت {formatEGP(sent)} — من غير ليميت</div>;
  const color = pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-success";
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span>{label}: {formatEGP(sent)} من {formatEGP(Number(limit))}</span>
        <span className="tabular-nums">فاضل {formatEGP(Math.max(0, Number(limit) - sent))}</span>
      </div>
      <div className="h-2 rounded bg-muted overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/**
 * «حسابات الأوعية» (0244 / 0246): the balance of every vessel account (for one branch or the company) and, for each
 * account, the sending limits as progress bars (today / this calendar month — company-wide, an account belongs to the
 * company) + «PDF» of all / one / several accounts with the statement of a period.
 */
export function VesselAccountBalances({ branchId, onPickAccount }: {
  branchId?: string | null;
  /** 0287: a click on a number opens its movements in «حركات الخزنة» */
  onPickAccount?: (a: { method: string; methodLabel: string; accountId: string | null; accountName: string }) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  // 0287 (owner 2026-11-26): every vessel closed until opened; open ones stay open until the page reloads
  const [openVessels, setOpenVessels] = useState<Set<string>>(new Set());
  const toggleVessel = (v: string) => setOpenVessels((p) => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const [usage, setUsage] = useState<AccountUsage[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [pdfOpen, setPdfOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(cairoTodayDay().slice(0, 8) + "01");
  const [to, setTo] = useState(cairoTodayDay());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    (supabase.rpc as any)("vessel_account_balances", { p_branch: branchId ?? null })
      .then(({ data }: any) => { if (!off) setRows((data ?? []) as Row[]); });
    loadAccountUsage().then((u) => { if (!off) setUsage(u); });
    loadAllPaymentMethods().then((m) => { if (!off) setLabels(Object.fromEntries(m.map((x) => [x.value, x.label]))); });
    return () => { off = true; };
  }, [branchId]);

  const byId = useMemo(() => new Map(usage.map((u) => [u.id, u])), [usage]);
  const withAcc = [...new Set((rows ?? []).filter((r) => r.holder_name).map((r) => r.payment_method))];
  if (!withAcc.length) return null;

  const print = async () => {
    const list = usage.filter((u) => picked.has(u.id));
    if (!list.length) return toast.error("اختار حساب واحد على الأقل");
    if (!from || !to || from > to) return toast.error("الفترة غلط");
    setBusy(true);
    try { await printVesselAccounts(list, labels, from, to); setPdfOpen(false); }
    catch (e: any) { toast.error(rpcErrorText(e, "كشف الحساب")); }
    finally { setBusy(false); }
  };

  return (
    <div className="card-elevated p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="font-extrabold">حسابات الأوعية — الرصيد وليميت الإرسال</h3>
        <Button size="sm" variant="outline" className="ms-auto" onClick={() => { setPicked(new Set(usage.map((u) => u.id))); setPdfOpen(true); }}>
          <FileDown className="w-4 h-4 ml-1" /> PDF
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 items-start">
        {withAcc.map((v) => {
          const list = (rows ?? []).filter((r) => r.payment_method === v);
          const total = list.reduce((s, r) => s + Number(r.balance || 0), 0);
          const isOpen = openVessels.has(v);
          return (
            <div key={v} className="rounded-xl border border-border p-3 bg-surface-2/50" data-testid={`vessel-acc-${v}`}>
              <button type="button" aria-expanded={isOpen} data-testid={`vessel-toggle-${v}`} onClick={() => toggleVessel(v)}
                title={isOpen ? "اقفل الحسابات" : "افتح وشوف الأرقام اللي جوّا الوعاء ده"}
                className="flex w-full items-center justify-between gap-2 font-bold text-start">
                <span className="flex items-center gap-1.5">
                  <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "" : "rotate-90"}`} />
                  {labels[v] ?? v}
                  <span className="text-xs font-normal text-muted-foreground">({list.length} حساب)</span>
                </span>
                <span className="tabular-nums">{formatEGP(total)}</span>
              </button>
              {isOpen && <div className="space-y-2.5 text-sm mt-2">
                {list.map((r) => {
                  const u = r.vessel_account_id ? byId.get(r.vessel_account_id) : undefined;
                  const left = u ? allowedNow(u) : null;
                  const name = `${r.holder_name ?? "من غير حساب"}${r.account_number ? ` ${r.account_number}` : ""}`;
                  const pickRow = onPickAccount ? () => onPickAccount({ method: v, methodLabel: labels[v] ?? v, accountId: r.vessel_account_id, accountName: name }) : undefined;
                  return (
                    <div key={r.vessel_account_id ?? "none"} className={r.is_active ? "" : "opacity-60"}>
                      <div className={`flex justify-between gap-2 ${pickRow ? "cursor-pointer rounded hover:bg-primary/5" : ""}`}
                        role={pickRow ? "button" : undefined} tabIndex={pickRow ? 0 : undefined} onClick={pickRow}
                        onKeyDown={pickRow ? (e) => { if (e.key === "Enter") pickRow(); } : undefined}
                        data-testid={`vessel-row-${r.vessel_account_id ?? `${v}-none`}`}
                        title={pickRow ? "اضغط تشوف حركات الرقم ده" : undefined}>
                        <span className="truncate">
                          {r.holder_name ?? "من غير حساب (حركات قبل الحسابات)"}
                          {r.account_number && <span className="text-xs text-muted-foreground" dir="ltr"> {r.account_number}</span>}
                        </span>
                        <span className={`tabular-nums font-semibold ${Number(r.balance) < 0 ? "text-destructive" : ""}`}>{formatEGP(Number(r.balance))}</span>
                      </div>
                      {u && (u.daily_limit != null || u.monthly_limit != null) && (
                        <div className="mt-1 space-y-1">
                          <Bar label="النهارده" sent={Number(u.sent_today)} limit={u.daily_limit} />
                          <Bar label="الشهر ده" sent={Number(u.sent_month)} limit={u.monthly_limit} />
                          <div className="text-[11px] text-muted-foreground">المسموح يتبعت دلوقتي: <b>{left == null ? "مفتوح" : formatEGP(left)}</b></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>}
            </div>
          );
        })}
      </div>
      {branchId && <p className="mt-2 text-[11px] text-muted-foreground">الرصيد هنا للفرع ده بس، والليميت على مستوى الشركة كلها لأن الحساب واحد.</p>}

      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>PDF لحسابات الأوعية</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-primary underline" onClick={() => setPicked(new Set(usage.map((u) => u.id)))}>اختار الكل</button>
              <button type="button" className="text-primary underline" onClick={() => setPicked(new Set())}>شيل الكل</button>
            </div>
            <div className="max-h-64 overflow-auto space-y-1.5 rounded border p-2">
              {usage.map((u) => (
                <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={picked.has(u.id)} onCheckedChange={(c) => {
                    const n = new Set(picked); if (c) n.add(u.id); else n.delete(u.id); setPicked(n);
                  }} />
                  <span>{u.holder_name} <span className="text-xs text-muted-foreground" dir="ltr">{u.account_number}</span>
                    <span className="text-xs text-muted-foreground"> — {labels[u.payment_method] ?? u.payment_method}</span></span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPdfOpen(false)}>رجوع</Button>
            <Button onClick={print} disabled={busy}>{busy ? "..." : `طلّع PDF (${picked.size})`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
