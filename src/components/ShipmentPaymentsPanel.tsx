import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Wallet, Pencil, Loader2, RefreshCw, Plus } from "lucide-react";
import { formatEGP, formatDate } from "@/lib/format";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/paymentMethods";
import { EditPaymentDialog } from "./EditPaymentDialog";
import { MultiMethodPaymentDialog } from "./MultiMethodPaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  shipmentId: string;
  canEdit: boolean;
  onChanged?: () => void;
}

const methodLabel = (m: string) =>
  PAYMENT_METHOD_OPTIONS.find((o) => o.value === m)?.label ?? m ?? "—";

/** تعديل طريقة الدفع من جوه صفحة الشحنة نفسها */
export function ShipmentPaymentsPanel({ shipmentId, canEdit, onChanged }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [txs, setTxs] = useState<any[]>([]);
  const [editRow, setEditRow] = useState<any>(null);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: p } = await supabase
        .from("payment_plans")
        .select("*")
        .eq("reference_type", "shipment")
        .eq("reference_id", shipmentId)
        .maybeSingle();
      setPlan(p ?? null);
      if (p?.id) {
        const { data: t } = await supabase
          .from("payment_transactions")
          .select("*")
          .eq("payment_plan_id", p.id)
          .order("created_at");
        setTxs(t ?? []);
      } else {
        setTxs([]);
      }
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const createPlan = async () => {
    setCreating(true);
    try {
      const { data: sh, error: se } = await supabase
        .from("shipments")
        .select("id, branch_id, contact_id, total_cost, contacts(name)")
        .eq("id", shipmentId)
        .single();
      if (se) throw se;
      const total = Number((sh as any).total_cost || 0);
      const { error } = await supabase.from("payment_plans").insert({
        branch_id: (sh as any).branch_id,
        entity_type: "supplier",
        entity_id: (sh as any).contact_id,
        entity_name: (sh as any).contacts?.name ?? "مورد",
        total_amount: total,
        paid_amount: 0,
        remaining_amount: total,
        plan_type: "open",
        reference_type: "shipment",
        reference_id: shipmentId,
        status: "active",
        created_by: user!.id,
      } as any);
      if (error) throw error;
      toast.success("تم إنشاء خطة الدفع ✅", { description: "دلوقتي تقدر تسجّل المدفوع وتعدّل طريقة الدفع" });
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message ?? "فشل إنشاء خطة الدفع");
    } finally {
      setCreating(false);
    }
  };

  const active = txs.filter((t) => !t.voided_at);


  return (
    <div className="card-elevated overflow-hidden mb-6 animate-fade-in">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="font-bold flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" />
          طرق الدفع على الشحنة
        </div>
        <div className="flex items-center gap-2">
          {canEdit && plan && Number(plan.remaining_amount ?? 0) > 0 && (
            <Button size="sm" onClick={() => setPayOpen(true)} className="gap-1">
              <Wallet className="w-3.5 h-3.5" /> تسجيل مبلغ مدفوع
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={load} className="gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> تحديث
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-6 flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> بنحمّل الدفعات...
        </div>
      ) : !plan ? (
        <div className="p-6 text-sm text-muted-foreground">مفيش خطة دفع مرتبطة بالشحنة دي.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 p-4 text-sm">
            <div className="bg-surface-2 rounded-lg p-3 border border-border">
              <div className="text-xs text-muted-foreground">الإجمالي</div>
              <div className="font-bold">{formatEGP(plan.total_amount)}</div>
            </div>
            <div className="bg-surface-2 rounded-lg p-3 border border-border">
              <div className="text-xs text-muted-foreground">المدفوع</div>
              <div className="font-bold text-success">{formatEGP(plan.paid_amount)}</div>
            </div>
            <div className="bg-surface-2 rounded-lg p-3 border border-border">
              <div className="text-xs text-muted-foreground">المتبقي</div>
              <div className="font-bold text-destructive">{formatEGP(plan.remaining_amount)}</div>
            </div>
          </div>

          {active.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-muted-foreground">
              الشحنة دي آجل ومفيش دفعات متسجلة لحد دلوقتي.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 border-b border-border">
                    <th className="px-4 py-3 text-right">التاريخ</th>
                    <th className="px-4 py-3 text-right">طريقة الدفع</th>
                    <th className="px-4 py-3 text-right">المبلغ</th>
                    <th className="px-4 py-3 text-right">الرسوم</th>
                    <th className="px-4 py-3 text-right">رقم مرجعي</th>
                    {canEdit && <th className="px-4 py-3 text-right">تعديل</th>}
                  </tr>
                </thead>
                <tbody>
                  {active.map((t) => (
                    <tr key={t.id} className="border-b border-border hover:bg-surface-2/50 transition-colors">
                      <td className="px-4 py-3">{formatDate(t.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded-md bg-primary/10 text-primary font-bold text-xs">
                          {methodLabel(t.payment_method)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold tabular-nums">{formatEGP(t.amount)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatEGP(t.fee_amount ?? 0)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{t.reference_number || "—"}</td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditRow(t)}>
                            <Pencil className="w-3.5 h-3.5" /> تعديل
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <EditPaymentDialog
        open={!!editRow}
        onOpenChange={(o) => !o && setEditRow(null)}
        target={editRow ? { kind: "tx", row: editRow } : null}
        invoiceTotal={Number(plan?.total_amount ?? 0)}
        onSuccess={() => {
          setEditRow(null);
          load();
          onChanged?.();
        }}
      />
      {payOpen && plan && (
        <MultiMethodPaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          mode={{ kind: "plan", planId: plan.id }}
          defaultAmount={Number(plan.remaining_amount ?? 0)}
          direction="out"
          title="تسجيل مبلغ مدفوع للشحنة"
          onSuccess={() => {
            setPayOpen(false);
            load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
