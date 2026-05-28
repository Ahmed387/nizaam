import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PaymentMethod,
  PAYMENT_METHOD_OPTIONS,
  TransferFee,
  calculateFee,
  loadTransferFees,
  methodAccountLabel,
  methodRequiresReference,
} from "@/lib/paymentMethods";
import { formatEGP } from "@/lib/format";

export interface PaymentMethodValue {
  method: PaymentMethod;
  reference_number?: string;
  transfer_to_account?: string;
  received_by_name?: string;
  fee_amount: number;
  fee_type?: "percentage" | "fixed";
  total_with_fee: number;
}

interface Props {
  amount: number;
  value: PaymentMethodValue;
  onChange: (v: PaymentMethodValue) => void;
  /** Show "received by" field for incoming payments */
  showReceivedBy?: boolean;
  /** Allow toggling who pays the fee (customer vs company) */
  showFeeBearerToggle?: boolean;
  feeOnCustomer?: boolean;
  onFeeBearerChange?: (onCustomer: boolean) => void;
  /** label override */
  label?: string;
  disabled?: boolean;
}

export function PaymentMethodPicker({
  amount,
  value,
  onChange,
  showReceivedBy = false,
  showFeeBearerToggle = false,
  feeOnCustomer = false,
  onFeeBearerChange,
  label = "طريقة الدفع",
  disabled = false,
}: Props) {
  const [fees, setFees] = useState<TransferFee[]>([]);

  useEffect(() => {
    loadTransferFees().then(setFees);
  }, []);

  const enabledOptions = PAYMENT_METHOD_OPTIONS.filter((o) => {
    if (o.value === "cash") return true;
    const f = fees.find((x) => x.payment_method === (o.value as any));
    return f ? f.is_enabled !== false : true;
  });


  // Recompute fee whenever amount/method/fees change
  useEffect(() => {
    const fee = calculateFee(value.method, amount, fees);
    const feeRow = fees.find((f) => f.payment_method === (value.method as any));
    onChange({
      ...value,
      fee_amount: fee,
      fee_type: feeRow?.fee_type,
      total_with_fee: amount + (feeOnCustomer ? fee : 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.method, amount, fees, feeOnCustomer]);

  const requiresRef = methodRequiresReference(value.method);

  return (
    <div className="space-y-3 p-3 rounded-lg bg-muted/30 border">
      <div>
        <Label>{label}</Label>
        <Select
          value={value.method}
          disabled={disabled}
          onValueChange={(v) => onChange({ ...value, method: v as PaymentMethod })}
        >
          <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            {enabledOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>

        </Select>
      </div>

      {requiresRef && (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>رقم العملية *</Label>
              <Input
                disabled={disabled}
                value={value.reference_number ?? ""}
                onChange={(e) => onChange({ ...value, reference_number: e.target.value })}
                className="mt-1.5"
                placeholder="رقم التحويل المرجعي"
              />
            </div>
            <div>
              <Label>{methodAccountLabel(value.method)}</Label>
              <Input
                disabled={disabled}
                dir="ltr"
                className="text-right mt-1.5"
                value={value.transfer_to_account ?? ""}
                onChange={(e) => onChange({ ...value, transfer_to_account: e.target.value })}
              />
            </div>
          </div>

          {value.fee_amount > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-md p-2.5 text-sm space-y-1">
              <div className="flex justify-between">
                <span>عمولة التحويل:</span>
                <span className="font-bold">{formatEGP(value.fee_amount)}</span>
              </div>
              <div className="flex justify-between border-t border-warning/20 pt-1">
                <span className="font-bold">الإجمالي مع العمولة:</span>
                <span className="font-extrabold text-warning">{formatEGP(amount + value.fee_amount)}</span>
              </div>
              {showFeeBearerToggle && (
                <div className="pt-2 border-t border-warning/20">
                  <Label className="text-xs mb-1.5 block">من يتحمل العمولة؟</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onFeeBearerChange?.(true)}
                      className={`text-xs px-3 py-1.5 rounded border flex-1 ${feeOnCustomer ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                    >
                      العميل (يُضاف للمبلغ)
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onFeeBearerChange?.(false)}
                      className={`text-xs px-3 py-1.5 rounded border flex-1 ${!feeOnCustomer ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                    >
                      الشركة (مصروف)
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showReceivedBy && (
        <div>
          <Label>اسم المُستلِم</Label>
          <Input
            disabled={disabled}
            value={value.received_by_name ?? ""}
            onChange={(e) => onChange({ ...value, received_by_name: e.target.value })}
            className="mt-1.5"
            placeholder="اسم الموظف اللي استلم"
          />
        </div>
      )}
    </div>
  );
}

export function emptyPaymentValue(method: PaymentMethod = "cash"): PaymentMethodValue {
  return { method, fee_amount: 0, total_with_fee: 0 };
}
