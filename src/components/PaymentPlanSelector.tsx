import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PaymentMethodPicker, emptyPaymentValue, PaymentMethodValue } from "./PaymentMethodPicker";
import { InstallmentScheduler, InstallmentRow } from "./InstallmentScheduler";
import { formatEGP } from "@/lib/format";

export type PayMode = "full" | "partial" | "credit";
export type ScheduleType = "scheduled" | "open";

export interface PaymentPlanState {
  mode: PayMode;
  paidNow: number;
  method: PaymentMethodValue;
  feeOnCustomer: boolean;
  scheduleType: ScheduleType;
  installments: InstallmentRow[];
}

export const defaultPlan = (): PaymentPlanState => ({
  mode: "full", paidNow: 0, method: emptyPaymentValue(), feeOnCustomer: false,
  scheduleType: "open", installments: [],
});

interface Props {
  total: number;
  value: PaymentPlanState;
  onChange: (v: PaymentPlanState) => void;
  /** show "customer/company bears fee" toggle (sales side only) */
  showFeeBearerToggle?: boolean;
}

export function PaymentPlanSelector({ total, value, onChange, showFeeBearerToggle }: Props) {
  useEffect(() => {
    if (value.mode === "full") onChange({ ...value, paidNow: total });
    if (value.mode === "credit") onChange({ ...value, paidNow: 0 });
    // eslint-disable-next-line
  }, [value.mode, total]);

  const remaining = Math.max(0, total - Number(value.paidNow || 0));

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
          <PaymentMethodPicker
            amount={value.paidNow}
            value={value.method}
            onChange={(m) => onChange({ ...value, method: m })}
            showFeeBearerToggle={showFeeBearerToggle}
            feeOnCustomer={value.feeOnCustomer}
            onFeeBearerChange={(b) => onChange({ ...value, feeOnCustomer: b })}
          />
        </>
      )}

      {(value.mode === "partial" || value.mode === "credit") && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex justify-between text-sm">
            <span>المتبقي للأقساط:</span>
            <b className="text-warning text-base">{formatEGP(remaining)}</b>
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
              remaining={remaining}
              value={value.installments}
              onChange={(r) => onChange({ ...value, installments: r })}
            />
          )}
        </div>
      )}
    </div>
  );
}
