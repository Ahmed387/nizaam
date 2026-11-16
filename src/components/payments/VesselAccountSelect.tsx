import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accountKey, accountText, activeAccountsOf, loadVesselAccounts, vesselAccountsCache, type VesselAccount } from "@/lib/vesselAccounts";

/**
 * The company-side account of a transfer (0244). When the vessel has accounts → a required list «أحمد — 010…»
 * (the value is the account number); otherwise the old free-text field.
 */
export function VesselAccountSelect({ method, value, onChange, placeholder, className, disabled }: {
  method: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [list, setList] = useState<VesselAccount[] | null>(vesselAccountsCache());
  useEffect(() => { loadVesselAccounts().then(setList); }, []);
  const accounts = activeAccountsOf(method, list);

  if (!accounts.length) {
    return (
      <Input disabled={disabled} dir="ltr" className={`text-right ${className ?? ""}`} value={value ?? ""}
             onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    );
  }
  const k = accountKey(value);
  const current = accounts.find((a) => accountKey(a.account_number) === k);
  return (
    <Select disabled={disabled} value={current?.account_number ?? ""} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue placeholder="اختار الحساب" /></SelectTrigger>
      <SelectContent>
        {accounts.map((a) => <SelectItem key={a.id} value={a.account_number}>{accountText(a)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** True when the vessel has accounts (the field is a required list). */
export function useHasVesselAccounts(method: string): boolean {
  const [list, setList] = useState<VesselAccount[] | null>(vesselAccountsCache());
  useEffect(() => { loadVesselAccounts().then(setList); }, []);
  return activeAccountsOf(method, list).length > 0;
}
