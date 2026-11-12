import { formatEGP } from "@/lib/format";

/**
 * The account's ONE running balance — «الحساب الجاري» (owner 2026-11-12): دائن = موجب (علينا له)، مدين = سالب (لنا عنده).
 * The ledger keeps two sides (customer + = he owes us, supplier + = we owe him); the owner's number is supplier − customer.
 */
export const netOf = (customerBalance: unknown, supplierBalance: unknown) =>
  Math.round(((Number(supplierBalance) || 0) - (Number(customerBalance) || 0)) * 100) / 100;
export const netKind = (net: number): "credit" | "debit" | "zero" => (Math.abs(net) <= 0.005 ? "zero" : net > 0 ? "credit" : "debit");
export const netLabel = (net: number) => ({ credit: "دائن", debit: "مدين", zero: "مسدد" })[netKind(net)];
/** «‎-2,000 ج.م مدين» / «4,400 ج.م دائن» / «مسدد». */
export const netText = (net: number) => (netKind(net) === "zero" ? "مسدد" : `${net < 0 ? "-" : ""}${formatEGP(Math.abs(net))} ${netLabel(net)}`);
export const netTone = (net: number) => ({ credit: "text-destructive", debit: "text-success", zero: "text-muted-foreground" })[netKind(net)];
