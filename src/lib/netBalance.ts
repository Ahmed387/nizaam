import { formatEGP } from "@/lib/format";

/**
 * The account's ONE running balance — «الحساب الجاري» (owner 2026-11-12): دائن = موجب (علينا له)، مدين = سالب (لنا عنده).
 * The ledger keeps two sides (customer + = he owes us, supplier + = we owe him); the owner's number is supplier − customer.
 */
export const netOf = (customerBalance: unknown, supplierBalance: unknown) =>
  Math.round(((Number(supplierBalance) || 0) - (Number(customerBalance) || 0)) * 100) / 100;
export const netKind = (net: number): "credit" | "debit" | "zero" => (Math.abs(net) <= 0.005 ? "zero" : net > 0 ? "credit" : "debit");
export const netLabel = (net: number) => ({ credit: "دائن", debit: "مدين", zero: "مسدد" })[netKind(net)];
/** «2,000 ج.م مدين» (أخضر) / «4,400 ج.م دائن» (أحمر) / «مسدد» — no minus sign on screen (owner 2026-11-12 «شيل حوار السالب والموجب»);
 *  the sign stays internal only (sorting / filters). */
export const netText = (net: number) => (netKind(net) === "zero" ? "مسدد" : `${formatEGP(Math.abs(net))} ${netLabel(net)}`);
export const netTone = (net: number) => ({ credit: "text-destructive", debit: "text-success", zero: "text-muted-foreground" })[netKind(net)];

/** One account's net from its two sides (null-safe). */
export const netOfSides = (sb: { customer_balance?: unknown; supplier_balance?: unknown } | null | undefined) =>
  netOf(sb?.customer_balance, sb?.supplier_balance);

/**
 * The account statements (`contact_account_movements`, `contact_net_statement`) keep «+ = مدين»; the screen's net is
 * «+ = دائن». Every number read from a statement goes through this — never flip the sign by hand.
 */
export const netFromStatement = (statementBalance: unknown) => Math.round(-(Number(statementBalance) || 0) * 100) / 100;

/** What a document / voucher does to the account's net (owner PDF 2026-11-28 «الرصيد بعد السند»). */
export type BalanceMove = "receipt" | "payment" | "sale" | "purchase" | "sale_return" | "purchase_return";
const MOVE_SIGN: Record<BalanceMove, 1 | -1> = {
  receipt: 1,          // he paid us: he owes less / we owe him more
  payment: -1,         // we paid him
  sale: -1,            // he owes us more
  purchase: 1,         // we owe him more
  sale_return: 1,
  purchase_return: -1,
};
/** `amount` is the document's effect as typed (a voucher's amount; an invoice's total − what was paid on it, which may be < 0). */
export const moveDelta = (move: BalanceMove, amount: unknown) => MOVE_SIGN[move] * (Number(amount) || 0);
/** «الرصيد بعد السند»: the net once this move is saved. Example 316,269.95 مدين + receipt 100,000 → 216,269.95 مدين. */
export const netAfter = (net: number, move: BalanceMove, amount: unknown) => Math.round((net + moveDelta(move, amount)) * 100) / 100;
/** The net before a document that is already in the account (current − its effect). */
export const netBefore = (netNow: number, move: BalanceMove, amount: unknown) => Math.round((netNow - moveDelta(move, amount)) * 100) / 100;

/** Which balance a number is: a branch user sees his branch, an admin every branch — written next to the number. */
export const balanceScope = (allBranches: boolean) => (allBranches ? "كل الفروع" : "الفرع ده");
