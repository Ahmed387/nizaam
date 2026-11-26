import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/DataTable";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatDate, formatEGP } from "@/lib/format";
import { rpcErrorText } from "@/lib/rpcError";
import { cn } from "@/lib/utils";
import {
  cancelVesselCount, countDifference, countProblem, decideVesselCount, differenceText, fetchVesselCountBoard, STATUS_LABEL,
  submitVesselCount, TREATMENT_LABEL, treatmentOptions, type Treatment, type VesselCountBoard, type VesselCountRow,
} from "@/lib/vesselCount";
import { Scale } from "lucide-react";
import { toast } from "sonner";

/**
 * «تسوية الوعاء» (migration 0294): count the money really in a vessel; the system is adjusted to it.
 * Owner: chooses how the difference is booked and it is booked now. Approval mode: staff send the count, the owner decides.
 */
export function useVesselCountBoard(branchId: string | undefined) {
  const [board, setBoard] = useState<VesselCountBoard | null>(null);
  const load = useCallback(() => {
    if (!branchId) return;
    fetchVesselCountBoard(branchId).then(setBoard).catch(() => setBoard(null));
  }, [branchId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["vessel_counts"], load);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("treasury:refresh", h);
    return () => window.removeEventListener("treasury:refresh", h);
  }, [load]);
  return { board, reload: load };
}

interface Emp { id: string; name: string; branch: string | null }
function useActiveEmployees(branchId: string, on: boolean) {
  const { branches } = useAuth();
  const [rows, setRows] = useState<Emp[]>([]);
  useEffect(() => {
    if (!on) return;
    supabase.from("employees").select("id, name, branch_id").eq("is_active", true).order("name").then(({ data }) => {
      const r = ((data ?? []) as any[]).map((e) => ({ id: e.id, name: e.name,
        branch: e.branch_id === branchId ? null : (branches.find((b) => b.id === e.branch_id)?.name ?? null) }));
      r.sort((a, b) => Number(!!a.branch) - Number(!!b.branch) || a.name.localeCompare(b.name, "ar"));
      setRows(r);
    });
  }, [on, branchId, branches]);
  return rows;
}

/** The owner's choice for a difference: cards (+ the employee when it is on one) and the reason. */
function TreatmentPicker({ diff, branchId, treatment, setTreatment, employeeId, setEmployeeId, reason, setReason }: {
  diff: number; branchId: string; treatment: Treatment | ""; setTreatment: (t: Treatment) => void;
  employeeId: string; setEmployeeId: (v: string) => void; reason: string; setReason: (v: string) => void;
}) {
  const opts = treatmentOptions(diff);
  const emps = useActiveEmployees(branchId, treatment === "employee");
  if (!opts.length) return null;
  return (
    <div className="space-y-2">
      <Label>{diff < 0 ? "العجز يتسجل إزاي؟ *" : "الزيادة تتسجل إزاي؟ *"}</Label>
      <div className="grid gap-2">
        {opts.map((o) => (
          <button key={o.value} type="button" data-testid={`treat-${o.value}`} onClick={() => setTreatment(o.value)}
            className={cn("rounded-lg border p-2.5 text-right transition-colors",
              treatment === o.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-background hover:bg-muted/50")}>
            <div className="font-semibold text-sm">{o.title}</div>
            <div className="text-xs text-muted-foreground">{o.effect}</div>
          </button>
        ))}
      </div>
      {treatment === "employee" && (
        <div>
          <Label>الموظف *</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="mt-1.5" data-testid="vc-employee"><SelectValue placeholder="اختار من الموظفين الشغالين" /></SelectTrigger>
            <SelectContent>
              {emps.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}{e.branch ? ` — ${e.branch}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div><Label>سبب الفرق *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" data-testid="vc-reason" /></div>
    </div>
  );
}

export function VesselCountButton({ branchId, board, onDone }: { branchId: string; board: VesselCountBoard | null; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("");
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(cairoTodayDay());
  const [treatment, setTreatment] = useState<Treatment | "">("");
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  if (!board?.can_count) return null;
  const isOwner = board.is_owner;
  const vessel = board.vessels.find((v) => v.method === method);
  const diff = vessel && actual.trim() !== "" && Number(actual) >= 0 ? countDifference(Number(vessel.balance), Number(actual)) : null;
  const pending = board.counts.some((c) => c.method === method && c.status === "pending");

  const reset = () => { setMethod(""); setActual(""); setNote(""); setTreatment(""); setEmployeeId(""); setReason(""); setDate(cairoTodayDay()); };
  const submit = async () => {
    const p = countProblem({ method, actual, isOwner, diff, treatment, employeeId, reason });
    if (p) return toast.error(p);
    setSaving(true);
    try {
      const r = await submitVesselCount({
        branchId, method, actual: Number(actual), note, date: isOwner && date !== cairoTodayDay() ? date : null,
        treatment: isOwner && treatment ? treatment : null, employeeId: treatment === "employee" ? employeeId : null, reason,
      });
      toast.success(r.status === "pending"
        ? `التسوية ${r.number} اتبعتت للمالك — الوعاء مش هيتغير غير لما يوافق`
        : Math.abs(r.difference) < 0.01 ? `${r.number}: الوعاء مطابق` : `${r.number}: الوعاء اتسوّى${r.voucher ? ` — السند ${r.voucher}` : ""}`);
      setOpen(false); reset(); onDone?.();
    } catch (e: any) {
      toast.error(rpcErrorText(e, "تسوية الوعاء"));
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="vessel-count-open"><Scale className="w-4 h-4 ml-1" /> تسوية الوعاء</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تسوية الوعاء — عدّ الفلوس اللي معاك</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <Label>الوعاء</Label>
              <Select value={method} onValueChange={(v) => { setMethod(v); setTreatment(""); }}>
                <SelectTrigger className="mt-1.5" data-testid="vc-method"><SelectValue placeholder="اختار الوعاء" /></SelectTrigger>
                <SelectContent>
                  {board.vessels.map((v) => (
                    <SelectItem key={v.method} value={v.method}>{v.label} — في السيستم {formatEGP(v.balance)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {vessel && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border bg-muted/40 p-2">
                  <div className="text-xs text-muted-foreground">في السيستم</div>
                  <div className="font-bold tabular-nums" data-testid="vc-system">{formatEGP(vessel.balance)}</div>
                </div>
                <div>
                  <Label>الفلوس الفعلية *</Label>
                  <Input type="number" min={0} step="0.01" value={actual} onChange={(e) => { setActual(e.target.value); setTreatment(""); }}
                    className="mt-1" data-testid="vc-actual" />
                </div>
              </div>
            )}
            {pending && <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">فيه تسوية للوعاء ده مستنية موافقة المالك — استنى ردّه الأول.</div>}
            {diff !== null && (
              <div data-testid="vc-diff" className={cn("rounded-md border p-2.5 font-semibold",
                Math.abs(diff) < 0.01 ? "border-success/40 bg-success/10 text-success"
                  : diff < 0 ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/40 bg-primary/10 text-primary")}>
                {differenceText(diff, formatEGP)}
              </div>
            )}
            {isOwner && diff !== null && (
              <TreatmentPicker diff={diff} branchId={branchId} treatment={treatment} setTreatment={setTreatment}
                employeeId={employeeId} setEmployeeId={setEmployeeId} reason={reason} setReason={setReason} />
            )}
            {!isOwner && diff !== null && Math.abs(diff) >= 0.01 && (
              <p className="text-xs text-muted-foreground">التسوية هتتبعت للمالك، وهو اللي يختار الفرق يتسجل إزاي. الوعاء مش هيتغير غير لما يوافق.</p>
            )}
            {isOwner && <div><Label>التاريخ</Label><Input type="date" value={date} max={cairoTodayDay()} min="2026-01-01" onChange={(e) => setDate(e.target.value)} className="mt-1.5" /></div>}
            <div><Label>ملاحظات</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>رجوع</Button>
            <Button onClick={submit} disabled={saving || pending} data-testid="vc-submit">
              {saving ? "..." : isOwner ? "سجّل التسوية" : "ابعت للمالك"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VesselCountsTable({ branchId, board, onDone }: { branchId: string; board: VesselCountBoard | null; onDone?: () => void }) {
  const [decide, setDecide] = useState<VesselCountRow | null>(null);
  const [cancel, setCancel] = useState<VesselCountRow | null>(null);
  const [treatment, setTreatment] = useState<Treatment | "">("");
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = board?.counts ?? [];
  const isOwner = !!board?.is_owner;
  const close = () => { setDecide(null); setCancel(null); setTreatment(""); setEmployeeId(""); setReason(""); };
  const pendingCount = useMemo(() => rows.filter((r) => r.status === "pending").length, [rows]);

  const run = async (fn: () => Promise<unknown>, ok: string, what: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); close(); onDone?.(); }
    catch (e: any) { toast.error(rpcErrorText(e, what)); }
    finally { setBusy(false); }
  };
  const approve = () => {
    if (!decide) return;
    const p = countProblem({ method: decide.method, actual: String(decide.actual), isOwner: true, diff: Number(decide.difference), treatment, employeeId, reason });
    if (p) return toast.error(p);
    run(() => decideVesselCount({ id: decide.id, approve: true, treatment: treatment || null, employeeId: treatment === "employee" ? employeeId : null, reason }),
      `${decide.number}: اتوافق والوعاء اتسوّى`, "الموافقة على التسوية");
  };
  const reject = () => {
    if (!decide) return;
    if (!reason.trim()) return toast.error("اكتب سبب الرفض");
    run(() => decideVesselCount({ id: decide.id, approve: false, reason }), `${decide.number}: اترفضت`, "رفض التسوية");
  };
  const doCancel = () => {
    if (!cancel) return;
    if (!reason.trim()) return toast.error("اكتب سبب الإلغاء");
    run(() => cancelVesselCount(cancel.id, reason), `${cancel.number}: اتلغت في يومها`, "إلغاء التسوية");
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        الطريقة دلوقتي: <b>{board?.mode === "approval" ? "الموظف يعدّ والمالك يوافق" : "المالك بس"}</b> (بتتغير من الإعدادات ← الفلوس والخزائن).
        {pendingCount > 0 && <span className="text-warning font-semibold"> — فيه {pendingCount} مستنية موافقة</span>}
      </div>
      <DataTable rows={rows} empty="مفيش تسويات أوعية لسه"
        columns={[
          { key: "number", header: "الرقم", render: (r: VesselCountRow) => <span className="font-mono text-primary">{r.number}</span> },
          { key: "date", header: "التاريخ", render: (r: VesselCountRow) => formatDate(r.date) },
          { key: "label", header: "الوعاء", render: (r: VesselCountRow) => r.label },
          { key: "system", header: "في السيستم", render: (r: VesselCountRow) => formatEGP(r.system) },
          { key: "actual", header: "الفعلي", render: (r: VesselCountRow) => formatEGP(r.actual) },
          { key: "difference", header: "الفرق", render: (r: VesselCountRow) => Math.abs(r.difference) < 0.01 ? <span className="text-success">مطابق</span>
              : <b className={r.difference < 0 ? "text-destructive" : "text-primary"}>{r.difference < 0 ? "عجز " : "زيادة "}{formatEGP(Math.abs(r.difference))}</b> },
          { key: "treatment", header: "اتسجل كـ", render: (r: VesselCountRow) => r.treatment
              ? <span>{TREATMENT_LABEL[r.treatment]}{r.employee ? ` — ${r.employee}` : ""}{r.voucher ? <span className="font-mono text-xs text-muted-foreground"> ({r.voucher})</span> : null}</span> : "—" },
          { key: "who", header: "عدّها", render: (r: VesselCountRow) => r.counted_by ?? "—" },
          { key: "status", header: "الحالة", render: (r: VesselCountRow) => (
              <span className={cn("text-xs", r.status === "pending" ? "text-warning font-semibold" : r.status === "applied" ? "text-success" : "text-destructive")}
                title={r.cancel_reason ?? r.reason ?? ""}>
                {STATUS_LABEL[r.status]}{r.status === "rejected" && r.reason ? ` — ${r.reason}` : ""}{r.status === "cancelled" && r.cancel_reason ? ` — ${r.cancel_reason}` : ""}
              </span>) },
          { key: "actions", header: "", render: (r: VesselCountRow) => !isOwner ? null : r.status === "pending"
              ? <Button size="sm" variant="outline" onClick={() => setDecide(r)} data-testid={`vc-decide-${r.number}`}>وافق / ارفض</Button>
              : r.status === "applied" && Math.abs(r.difference) >= 0.01
                ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancel(r)} data-testid={`vc-cancel-${r.number}`}>إلغاء</Button> : null },
        ]} />

      <Dialog open={!!decide} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تسوية {decide?.number} — {decide?.label}</DialogTitle></DialogHeader>
          {decide && (
            <div className="space-y-3 text-sm">
              <p className="leading-6">
                عدّها <b>{decide.counted_by ?? "—"}</b>: في السيستم <b>{formatEGP(decide.system)}</b> والفعلي <b>{formatEGP(decide.actual)}</b>.
                {decide.note ? <> ملاحظته: «{decide.note}»</> : null}
              </p>
              <div className={cn("rounded-md border p-2.5 font-semibold", decide.difference < 0 ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/40 bg-primary/10 text-primary")}>
                {differenceText(Number(decide.difference), formatEGP)}
              </div>
              {Math.abs(decide.difference) >= 0.01
                ? <TreatmentPicker diff={Number(decide.difference)} branchId={branchId} treatment={treatment} setTreatment={setTreatment}
                    employeeId={employeeId} setEmployeeId={setEmployeeId} reason={reason} setReason={setReason} />
                : <div><Label>ملاحظة / سبب الرفض</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" /></div>}
              <p className="text-xs text-muted-foreground">للرفض: اكتب السبب في خانة «سبب الفرق» واضغط «ارفض».</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={close}>رجوع</Button>
            <Button variant="destructive" onClick={reject} disabled={busy} data-testid="vc-reject">ارفض</Button>
            <Button onClick={approve} disabled={busy} data-testid="vc-approve">وافق وسجّل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancel} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>إلغاء التسوية {cancel?.number}</DialogTitle></DialogHeader>
          {cancel && <p className="text-sm text-muted-foreground leading-6">
            الوعاء «{cancel.label}» هيرجع زي ما كان قبل التسوية ({cancel.difference < 0 ? "يزيد" : "يقل"} {formatEGP(Math.abs(cancel.difference))}) في يوم التسوية نفسه
            {cancel.treatment === "employee" ? "، والسلفة اللي على الموظف هتتلغي (لو لسه متخصمتش)" : ""}.
          </p>}
          <div><Label>سبب الإلغاء *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" data-testid="vc-cancel-reason" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>رجوع</Button>
            <Button variant="destructive" onClick={doCancel} disabled={busy} data-testid="vc-cancel-go">إلغاء التسوية</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
