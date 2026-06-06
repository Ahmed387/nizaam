import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { InstallmentScheduler, InstallmentRow } from "./InstallmentScheduler";
import { formatEGP } from "@/lib/format";
import {
  PaymentMethod,
  PAYMENT_METHOD_OPTIONS,
  TransferFee,
  loadTransferFees,
  calculateFee,
  methodRequiresReference,
  methodReceiverLabel,
  methodSenderLabel,
} from "@/lib/paymentMethods";

export type PayMode = "full" | "partial" | "credit";
export type ScheduleType = "scheduled" | "open";

export interface PaymentSplit {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference_number?: string;
  transfer_to_account?: string;
  transfer_from_account?: string;
  received_by_name?: string;
  fee_amount: number;
  fee_type?: "percentage" | "fixed";
}

export interface PaymentPlanState {
  mode: PayMode;
  paidNow: number;
  splits: PaymentSplit[];
  feeOnCustomer: boolean;
  scheduleType: ScheduleType;
  installments: InstallmentRow[];
  /** legacy — kept for back-compat readers; equals first split */
  method?: any;
}

const newSplit = (amount = 0): PaymentSplit => ({
  id: crypto.randomUUID(),
  method: "cash",
  amount,
  fee_amount: 0,
});

export const defaultPlan = (): PaymentPlanState => ({
  mode: "full",
  paidNow: 0,
  splits: [newSplit(0)],
  feeOnCustomer: false,
  scheduleType: "open",
  installments: [],
});

interface Props {
  total: number;
  value: PaymentPlanState;
  onChange: (v: PaymentPlanState) => void;
  showFeeBearerToggle?: boolean;
}

export function PaymentPlanSelector({ total, value, onChange, showFeeBearerToggle }: Props) {
  const [fees, setFees] = useState<TransferFee[]>([]);
  useEffect(() => { loadTransferFees().then(setFees); }, []);

  // Sync paidNow based on mode
  useEffect(() => {
    if (value.mode === "full") {
      const splits = value.splits.length === 1
        ? [{ ...value.splits[0], amount: total }]
        : value.splits;
      onChange({ ...value, paidNow: total, splits: recalcFees(splits, fees) });
    } else if (value.mode === "credit") {
      onChange({ ...value, paidNow: 0, splits: [newSplit(0)] });
    }
    // eslint-disable-next-line
  }, [value.mode, total]);

  // Recompute fees when fees list loads
  useEffect(() => {
    if (!fees.length) return;
    onChange({ ...value, splits: recalcFees(value.splits, fees) });
    // eslint-disable-next-line
  }, [fees]);

  const splitsSum = useMemo(
    () => value.splits.reduce((s, l) => s + Number(l.amount || 0), 0),
    [value.splits]
  );
  const targetPaid = value.mode === "credit" ? 0 : Number(value.paidNow || 0);
  const remainingToSplit = Math.round((targetPaid - splitsSum) * 100) / 100;
  const remainingForInstallments = Math.max(0, total - targetPaid);

  const updateSplit = (id: string, patch: Partial<PaymentSplit>) => {
    const splits = value.splits.map((s) => {
      if (s.id !== id) return s;
      const merged = { ...s, ...patch };
      const fee = calculateFee(merged.method, merged.amount, fees);
      const fr = fees.find((f) => f.payment_method === merged.method);
      return { ...merged, fee_amount: fee, fee_type: fr?.fee_type };
    });
    onChange({ ...value, splits });
  };

  const addSplit = () => {
    const rem = Math.max(0, targetPaid - splitsSum);
    onChange({ ...value, splits: [...value.splits, newSplit(rem)] });
  };

  const removeSplit = (id: string) => {
    if (value.splits.length <= 1) return;
    onChange({ ...value, splits: value.splits.filter((s) => s.id !== id) });
  };

  const enabledOpts = PAYMENT_METHOD_OPTIONS.filter((o) => {
    if (o.value === "cash") return true;
    const f = fees.find((x) => x.payment_method === (o.value as any));
    return f ? f.is_enabled !== false : true;
  });

  return (
    <div className="space-y-3 p-4 rounded-lg border bg-muted/10">
      <div>
        <Label className="text-base font-bold">طريقة التسديد</Label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {([
            { v: "full", l: "دفع كامل الآن" },
            { v: "partial", l: "جزئي + آجل" },
            { v: "credit", l: "آجل بالكامل" },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => onChange({ ...value, mode: opt.v })}
              className={`px-3 py-2 rounded border text-sm ${value.mode === opt.v ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      {(value.mode === "full" || value.mode === "partial") && (
        <>
          {value.mode === "partial" && (
            <div>
              <Label>المبلغ المدفوع الآن</Label>
              <Input
                type="number" min={0} max={total} step="0.01"
                value={value.paidNow}
                onChange={(e) => onChange({ ...value, paidNow: Number(e.target.value) })}
                className="mt-1.5"
              />
            </div>
          )}

          {/* Splits */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold">طرق الدفع ({value.splits.length})</Label>
              <div className={`text-xs font-bold ${Math.abs(remainingToSplit) < 0.01 ? "text-success" : "text-warning"}`}>
                {Math.abs(remainingToSplit) < 0.01
                  ? "✓ مطابق"
                  : remainingToSplit > 0
                    ? `متبقي: ${formatEGP(remainingToSplit)}`
                    : `زيادة: ${formatEGP(-remainingToSplit)}`}
              </div>
            </div>

            {value.splits.map((sp, idx) => {
              const requiresRef = methodRequiresReference(sp.method);
              return (
                <div key={sp.id} className="card-elevated p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">#{idx + 1}</div>
                    {value.splits.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => removeSplit(sp.id)} className="text-destructive h-7 w-7 p-0">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">المبلغ</Label>
                      <Input
                        type="number" min={0} step="0.01" value={sp.amount}
                        onChange={(e) => updateSplit(sp.id, { amount: Number(e.target.value) })}
                        className="mt-1 h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">الطريقة</Label>
                      <Select value={sp.method} onValueChange={(v) => updateSplit(sp.id, { method: v as PaymentMethod })}>
                        <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {enabledOpts.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {requiresRef && (
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs">رقم العملية *</Label>
                        <Input
                          value={sp.reference_number ?? ""}
                          onChange={(e) => updateSplit(sp.id, { reference_number: e.target.value })}
                          className="mt-1 h-9" placeholder="مرجع التحويل"
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">{methodSenderLabel(sp.method)}</Label>
                          <Input
                            dir="ltr" className="text-right mt-1 h-9"
                            value={sp.transfer_from_account ?? ""}
                            onChange={(e) => updateSplit(sp.id, { transfer_from_account: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">{methodReceiverLabel(sp.method)}</Label>
                          <Input
                            dir="ltr" className="text-right mt-1 h-9"
                            value={sp.transfer_to_account ?? ""}
                            onChange={(e) => updateSplit(sp.id, { transfer_to_account: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {sp.fee_amount > 0 && (
                    <div className="bg-warning/10 border border-warning/30 rounded p-2 text-xs flex justify-between">
                      <span>عمولة: {formatEGP(sp.fee_amount)}</span>
                      <span className="font-bold">إجمالي: {formatEGP(sp.amount + (value.feeOnCustomer ? sp.fee_amount : 0))}</span>
                    </div>
                  )}
                </div>
              );
            })}

            <Button variant="outline" size="sm" onClick={addSplit} className="w-full">
              <Plus className="w-4 h-4 ml-1" /> إضافة طريقة دفع أخرى
            </Button>
          </div>

          {showFeeBearerToggle && value.splits.some((s) => s.fee_amount > 0) && (
            <div className="flex items-center justify-between p-2 border rounded">
              <Label className="text-sm">العمولة على العميل؟</Label>
              <Switch checked={value.feeOnCustomer} onCheckedChange={(b) => onChange({ ...value, feeOnCustomer: b })} />
            </div>
          )}
        </>
      )}

      {(value.mode === "partial" || value.mode === "credit") && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex justify-between text-sm">
            <span>المتبقي للأقساط:</span>
            <b className="text-warning text-base">{formatEGP(remainingForInstallments)}</b>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: "scheduled", l: "أقساط بمواعيد محددة" },
              { v: "open", l: "مفتوح (بدون جدول)" },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => onChange({ ...value, scheduleType: opt.v })}
                className={`px-3 py-2 rounded border text-sm ${value.scheduleType === opt.v ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
              >
                {opt.l}
              </button>
            ))}
          </div>
          {value.scheduleType === "scheduled" && (
            <InstallmentScheduler
              remaining={remainingForInstallments}
              value={value.installments}
              onChange={(r) => onChange({ ...value, installments: r })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function recalcFees(splits: PaymentSplit[], fees: TransferFee[]): PaymentSplit[] {
  return splits.map((s) => {
    const fee = calculateFee(s.method, s.amount, fees);
    const fr = fees.find((f) => f.payment_method === s.method);
    return { ...s, fee_amount: fee, fee_type: fr?.fee_type };
  });
}
