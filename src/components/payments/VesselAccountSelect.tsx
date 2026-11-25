import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accountKey, accountText, activeAccountsOf, allowedNow, loadAccountUsage, loadVesselAccounts, vesselAccountsCache, type AccountUsage, type VesselAccount } from "@/lib/vesselAccounts";
import { formatEGP } from "@/lib/format";
import { accountLevel, loadMyVesselRules, myVesselRulesCache } from "@/lib/vesselAccess";

/**
 * The company-side account of a transfer (0244). When the vessel has accounts → a required list «أحمد — 010…»
 * (the value is the account number); otherwise the old free-text field.
 */
export function VesselAccountSelect({ method, value, onChange, placeholder, className, disabled, sending }: {
  method: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** 0246: money leaves this account → show what each account can still send (its limits) */
  sending?: boolean;
}) {
  const [list, setList] = useState<VesselAccount[] | null>(vesselAccountsCache());
  const [usage, setUsage] = useState<AccountUsage[]>([]);
  const [rules, setRules] = useState(myVesselRulesCache());
  useEffect(() => { loadVesselAccounts().then(setList); loadMyVesselRules().then(setRules).catch(() => {}); }, []);
  useEffect(() => { if (sending) loadAccountUsage().then(setUsage); }, [sending, method]);
  // 0281: only the numbers this person may receive / pay with
  const accounts = activeAccountsOf(method, list).filter((a) => accountLevel(rules, method, a.id) === "use");

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
        {accounts.map((a) => {
          const u = usage.find((x) => x.id === a.id);
          const left = u ? allowedNow(u) : null;
          return <SelectItem key={a.id} value={a.account_number}>{accountText(a)}{left != null ? ` — يقدر يبعت ${formatEGP(left)}` : ""}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}

/** True when the vessel has accounts (the field is a required list). */
export function useHasVesselAccounts(method: string): boolean {
  const [list, setList] = useState<VesselAccount[] | null>(vesselAccountsCache());
  const [rules, setRules] = useState(myVesselRulesCache());
  useEffect(() => { loadVesselAccounts().then(setList); loadMyVesselRules().then(setRules).catch(() => {}); }, []);
  return activeAccountsOf(method, list).filter((a) => accountLevel(rules, method, a.id) === "use").length > 0;
}
