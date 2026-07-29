import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatEGP } from "@/lib/format";
import { MultiMethodPaymentDialog } from "./MultiMethodPaymentDialog";
import { EditPaymentDialog } from "./EditPaymentDialog";
import { toast } from "sonner";
import { AlertCircle, Calendar, CreditCard, Pencil } from "lucide-react";

interface Props {
  entityType: "customer" | "supplier" | "employee";
  entityId: string;
  /** "in" = we collect from this entity (customer). "out" = we pay this entity (supplier/employee). */
  direction: "in" | "out";
}

export function PaymentPlansPanel({ entityType, entityId, direction }: Props) {
  const [plans, setPlans] = useState<any[]>([]);
  const [installments, setInstallments] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<{ planId: string; installmentId?: string; amount: number } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: pp } = await supabase
      .from("payment_plans")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    setPlans(pp ?? []);
    if (pp?.length) {
      const { data: pi } = await supabase
        .from("payment_installments")
        .select("*")
        .in("payment_plan_id", pp.map(p => p.id))
        .order("installment_number");
      const grouped: Record<string, any[]> = {};
      (pi ?? []).forEach(r => { (grouped[r.payment_plan_id] ||= []).push(r); });
      setInstallments(grouped);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [entityType, entityId]);

  if (loading) return <div className="text-muted-foreground text-sm p-4">جاري التحميل…</div>;
  if (!plans.length) return <div className="text-muted-foreground text-sm p-4 text-center">لا توجد خطط دفع</div>;

  const totalRemaining = plans.reduce((s, p) => s + Number(p.remaining_amount || 0), 0);

  return (
    <div className="space-y-3">
      <div className="card-elevated p-3 flex justify-between items-center">
        <span className="text-sm text-muted-foreground">
          {direction === "in" ? "إجمالي المديونية" : "إجمالي المستحق"}
        </span>
        <b className="text-xl text-warning">{formatEGP(totalRemaining)}</b>
      </div>

      {plans.map((p) => {
        const ins = installments[p.id] ?? [];
        const overdue = ins.filter(i => i.status === "overdue");
        return (
          <div key={p.id} className="card-elevated overflow-hidden">
            <div className="p-3 border-b flex flex-wrap justify-between items-center gap-2">
              <div>
                <div className="text-xs text-muted-foreground">{p.reference_type ?? "خطة"} #{p.id.slice(0, 8)}</div>
                <div className="text-sm">
                  إجمالي <b>{formatEGP(p.total_amount)}</b> — مدفوع <span className="text-success">{formatEGP(p.paid_amount)}</span> — متبقي <span className="text-warning font-bold">{formatEGP(p.remaining_amount)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {overdue.length > 0 && (
                  <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" />{overdue.length} متأخر</Badge>
                )}
                <Badge variant={p.status === "completed" ? "secondary" : "default"}>{p.status}</Badge>
                {p.status !== "completed" && p.plan_type === "open" && (
                  <Button size="sm" onClick={() => setPaying({ planId: p.id, amount: p.remaining_amount })}>
                    <CreditCard className="w-3 h-3 ml-1" />
                    {direction === "in" ? "استلم دفعة" : "ادفع"}
                  </Button>
                )}
              </div>
            </div>
            {ins.length > 0 && (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="px-3 py-2 text-right">#</th>
                    <th className="px-3 py-2 text-right">الاستحقاق</th>
                    <th className="px-3 py-2 text-right">المبلغ</th>
                    <th className="px-3 py-2 text-right">مدفوع</th>
                    <th className="px-3 py-2 text-right">الحالة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ins.map((i) => {
                    const remaining = Math.max(0, Number(i.amount) - Number(i.paid_amount || 0));
                    return (
                      <tr key={i.id} className={`border-t ${i.status === "overdue" ? "bg-destructive/10" : ""}`}>
                        <td className="px-3 py-2">{i.installment_number}</td>
                        <td className="px-3 py-2"><Calendar className="w-3 h-3 inline ml-1" />{i.due_date}</td>
                        <td className="px-3 py-2">{formatEGP(i.amount)}</td>
                        <td className="px-3 py-2 text-success">{formatEGP(i.paid_amount)}</td>
                        <td className="px-3 py-2">
                          {i.status === "paid" && <Badge variant="secondary">مدفوع</Badge>}
                          {i.status === "overdue" && <Badge variant="destructive">متأخر</Badge>}
                          {i.status === "pending" && <Badge>قادم</Badge>}
                        </td>
                        <td className="px-3 py-2 text-left">
                          {i.status !== "paid" && (
                            <Button size="sm" variant="outline" onClick={() => setPaying({ planId: p.id, installmentId: i.id, amount: remaining })}>
                              {direction === "in" ? "استلام" : "دفع"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}

          </div>
        );
      })}

      {paying && (
        <MultiMethodPaymentDialog
          open={true}
          onOpenChange={(o) => !o && setPaying(null)}
          mode={{ kind: "plan", planId: paying.planId, installmentId: paying.installmentId }}
          defaultAmount={paying.amount}
          direction={direction}
          lockTotal={!!paying.installmentId}
          onSuccess={load}
        />
      )}
    </div>
  );
}
