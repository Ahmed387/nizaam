import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PaymentMethod,
  PAYMENT_METHOD_OPTIONS,
  TransferFee,
  loadTransferFees,
  loadAllPaymentMethods,
  choosable,
  feeChoosable,
  type PaymentMethodOption,
  methodAccountLabel,
  methodReceiverLabel,
  methodSenderLabel,
  methodRequiresReference,
} from "@/lib/paymentMethods";
import { formatEGP } from "@/lib/format";
import { feeOf, type FeeMode } from "@/lib/paymentFee";
import { FeeField } from "@/components/payments/FeeField";
import { PaymentProofInput } from "@/components/payments/PaymentProofInput";
import { VesselAccountSelect } from "@/components/payments/VesselAccountSelect";

export interface PaymentMethodValue {
  method: PaymentMethod;
  reference_number?: string;
  transfer_to_account?: string;
  transfer_from_account?: string;
  received_by_name?: string;
  fee_amount: number;
  fee_type?: "percentage" | "fixed";
  /** 0286: the fee is typed by whoever does the operation — none / fixed / percent of the amount (never on cash) */
  fee_mode?: FeeMode;
  fee_value?: string;
  total_with_fee: number;
  /** «إيصال التحويل» files, uploaded to the payment's voucher after the save (attachPaymentProofs) */
  proof_files?: File[];
}

interface Props {
  amount: number;
  value: PaymentMethodValue;
  onChange: (v: PaymentMethodValue) => void;
  /** Show "received by" field for incoming payments */
  showReceivedBy?: boolean;
  /** Show "transferred from account" field (source account number) */
  showTransferFrom?: boolean;
  /** Allow toggling who pays the fee (customer vs company) */
  showFeeBearerToggle?: boolean;
  feeOnCustomer?: boolean;
  onFeeBearerChange?: (onCustomer: boolean) => void;
  /** label override */
  label?: string;
  disabled?: boolean;
  /** 0244: which side is the company's account — "in" (money received → «المستلم») / "out" (paid → «المرسل»);
   *  "both" = both sides are company accounts (money between two branches, 0245); "none" = both free text. */
  direction?: "in" | "out" | "none" | "both";
}

export function PaymentMethodPicker({
  amount,
  value,
  onChange,
  showReceivedBy = false,
  showTransferFrom = false,
  showFeeBearerToggle = false,
  feeOnCustomer = false,
  onFeeBearerChange,
  label = "طريقة الدفع",
  disabled = false,
  direction = "in",
}: Props) {
  const [fees, setFees] = useState<TransferFee[]>([]);
  // 0139: every enabled vessel of the company (built-ins + PayMob, «خصومات / عروض الشركات», …), not only the four built-ins
  const [options, setOptions] = useState<PaymentMethodOption[] | null>(null);

  useEffect(() => {
    loadTransferFees().then(setFees);
    loadAllPaymentMethods().then((m) => setOptions(m.filter(choosable))).catch(() => setOptions(null));
  }, []);

  const enabledOptions: { value: string; label: string }[] = options ?? PAYMENT_METHOD_OPTIONS.filter((o) => {
    if (o.value === "cash") return true;
    return feeChoosable(fees.find((x) => x.payment_method === (o.value as any)));
  });


  const requiresRef = methodRequiresReference(value.method, fees);
  // 0286 (owner 2026-11-25): the fee comes from what the person types, not from the settings
  const mode: FeeMode = requiresRef ? (value.fee_mode ?? "none") : "none";
  useEffect(() => {
    const fee = feeOf(value.method, amount, mode, value.fee_value);
    if (fee === value.fee_amount && value.total_with_fee === amount + (feeOnCustomer ? fee : 0)) return;
    onChange({
      ...value,
      fee_amount: fee,
      fee_type: mode === "percent" ? "percentage" : mode === "fixed" ? "fixed" : undefined,
      total_with_fee: amount + (feeOnCustomer ? fee : 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.method, amount, mode, value.fee_value, feeOnCustomer]);
  const vesselName = enabledOptions.find((o) => o.value === value.method)?.label ?? value.method;

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
          <div>
            <Label>رقم العملية (اختياري)</Label>
            <Input
              disabled={disabled}
              value={value.reference_number ?? ""}
              onChange={(e) => onChange({ ...value, reference_number: e.target.value })}
              className="mt-1.5"
              placeholder="رقم التحويل المرجعي"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>{direction === "out" || direction === "both" ? "حسابنا اللي اتحول منه" : methodSenderLabel(value.method)} *</Label>
              {direction === "out" || direction === "both" ? (
                <VesselAccountSelect disabled={disabled} method={value.method} className="mt-1.5" sending
                                     value={value.transfer_from_account}
                                     onChange={(v) => onChange({ ...value, transfer_from_account: v })}
                                     placeholder="حسابنا اللي اتحول منه" />
              ) : (
              <Input
                disabled={disabled}
                dir="ltr"
                className="text-right mt-1.5"
                value={value.transfer_from_account ?? ""}
                onChange={(e) => onChange({ ...value, transfer_from_account: e.target.value })}
                placeholder="الحساب اللي اتحول منه"
              />
              )}
            </div>
            <div>
              <Label>{direction === "in" ? "حسابنا اللي الفلوس وصلت عليه" : direction === "both" ? "الحساب اللي هتوصل عليه (الفرع التاني)" : methodReceiverLabel(value.method)} *</Label>
              {direction === "in" || direction === "both" ? (
                <VesselAccountSelect disabled={disabled} method={value.method} className="mt-1.5"
                                     value={value.transfer_to_account}
                                     onChange={(v) => onChange({ ...value, transfer_to_account: v })}
                                     placeholder="الحساب اللي اتحول إليه" />
              ) : (
              <Input
                disabled={disabled}
                dir="ltr"
                className="text-right mt-1.5"
                value={value.transfer_to_account ?? ""}
                onChange={(e) => onChange({ ...value, transfer_to_account: e.target.value })}
                placeholder="الحساب اللي اتحول إليه"
              />
              )}
            </div>
          </div>

          <PaymentProofInput disabled={disabled} files={value.proof_files}
                             onChange={(f) => onChange({ ...value, proof_files: f })} />

          <FeeField method={value.method} amount={amount} mode={mode} value={value.fee_value} disabled={disabled}
            direction={direction} vesselLabel={vesselName}
            onChange={(m, v) => onChange({ ...value, fee_mode: m, fee_value: v })}
            {...(showFeeBearerToggle ? { onCustomer: feeOnCustomer, onCustomerChange: (v: boolean) => onFeeBearerChange?.(v) } : {})} />
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
