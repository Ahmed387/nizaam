import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermTable } from "@/components/PermTable";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { cancelPeriodShares, pct, postPeriodShares, previewPeriodShares, type SharesPreview } from "@/lib/partners";
import { ReasonDialog } from "./ReasonDialog";

function lastMonth(): { from: string; to: string } {
  const [y, m] = cairoTodayDay().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  const from = d.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * «حصص التشغيل والمرتبات من الربح» of a period (0137): taken FIRST from the period's net profit and booked as salary
 * expense, so the distribution splits only what is left. Example: October net 277,902.92, operating share 10% → 27,790.29.
 * A loss period has no automatic amount — the owner types each one (0 is allowed).
 */
export function PeriodSharesDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const init = lastMonth();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SharesPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const overrides = () => Object.fromEntries(Object.entries(typed).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
  const load = async () => {
    try { setPreview(await previewPeriodShares(from, to, overrides())); } catch (e: any) { toast.error(e.message); setPreview(null); }
  };
  useEffect(() => { if (from && to) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const post = async () => {
    setBusy(true);
    try {
      const r = await postPeriodShares(from, to, overrides());
      toast.success(`اتسجل ${r.posted} — اتخصموا من ربح الفترة كمرتبات`);
      onDone?.(); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const [asking, setAsking] = useState(false);
  const cancel = async (reason: string) => {
    try { await cancelPeriodShares(from, to, reason); toast.success("اتلغت حصص الفترة"); setAsking(false); await load(); onDone?.(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>حصص التشغيل والمرتبات من الربح</DialogTitle>
          <DialogDescription>بتتاخد الأول من صافي ربح الفترة وتتسجل مرتبات — وبعدها توزّع الباقي على رأس المال.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {preview && (
          <div className="space-y-3">
            <div className={`rounded-lg p-3 text-sm ${preview.net_before > 0 ? "bg-success/10" : "bg-destructive/10"}`}>
              صافي ربح الفترة قبل الحصص: <b>{formatEGP(preview.net_before)}</b>
              {preview.net_before <= 0 && " — الفترة خسرانة: اكتب مرتب / حصة كل واحد بنفسك (ولو مفيش اكتب 0)"}
            </div>
            {preview.rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">مفيش شريك ليه حصة تشغيل أو مرتب نسبة.</div>
            ) : (
              <PermTable className="w-full text-sm">
                <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشريك</th><th className="p-2">النوع</th><th className="p-2">النسبة</th><th className="p-2">من</th><th className="p-2">المبلغ</th></tr></thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.key} className="border-t">
                      <td className="p-2">{r.name}</td>
                      <td className="p-2">{r.kind === "operating_share" ? "حصة تشغيل" : "مرتب من الربح"}</td>
                      <td className="p-2">{pct(r.percent)}</td>
                      <td className="p-2">{formatEGP(r.base)}</td>
                      <td className="p-2 w-40">
                        {preview.already ? formatEGP(r.amount) : (
                          <Input type="number" min={0} value={typed[r.key] ?? (r.needs_owner ? "" : String(r.amount))}
                            className={r.needs_owner && typed[r.key] == null ? "border-destructive" : ""}
                            onChange={(e) => setTyped({ ...typed, [r.key]: e.target.value })} onBlur={load} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </PermTable>
            )}
            <div className="text-sm">الإجمالي: <b>{formatEGP(preview.total)}</b>{preview.already && " — اتسجلت للفترة دي"}</div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-start">
          {preview && !preview.already && preview.rows.length > 0 && <Button onClick={post} disabled={busy}>سجّلها مرتبات</Button>}
          {preview?.already && <Button variant="destructive" onClick={() => setAsking(true)} disabled={busy}>الغي حصص الفترة</Button>}
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
      {asking && <ReasonDialog title="إلغاء حصص الفترة" description="المرتبات اللي اتسجلت للفترة دي هتتعكس في نفس يومها." onConfirm={cancel} onClose={() => setAsking(false)} />}
    </Dialog>
  );
}
