// Unified, branch-aware contact ledger (read-only). Mirrors v_contact_balances exactly:
// balance = opening + Sales − SaleReturns(credit part) − InvoicePayments
//          − (Purchases − PurchaseReturns(credit part) − SupplierPayments)
//          − ReceiptVouchers + PaymentVouchers (+ credit_balance, contact-level only)
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";

export type LedgerKind =
  | "opening" | "sale" | "sale_payment" | "sale_return"
  | "purchase" | "supplier_payment" | "purchase_return"
  | "receipt_voucher" | "payment_voucher" | "credit_deposit";

export type LedgerRow = {
  date: string;
  type: string;
  kind: LedgerKind;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  branch_id: string | null;
  financial_scope?: "branch" | "management";
  balance?: number;
  link?: string;
};

export type ContactLedger = {
  contact: any;
  totalBalance: number;   // v_contact_balances.total_balance (company-wide)
  creditBalance: number;
  rows: LedgerRow[];      // chronological (oldest first), no running balance
  vouchers: any[];        // active vouchers (full rows)
};

export async function fetchContactLedger(contactId: string): Promise<ContactLedger> {
  const [{ data: c }, { data: bal }] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", contactId).maybeSingle(),
    supabase.from("v_contact_balances" as any).select("*").eq("contact_id", contactId).maybeSingle(),
  ]);
  const bRow: any = bal ?? null;
  const list: LedgerRow[] = [];
  const opening = Number(bRow?.opening_balance ?? 0);
  if (Math.abs(opening) > 0.001) {
    list.push({
      date: (c as any)?.created_at ?? new Date(0).toISOString(),
      type: "رصيد افتتاحي", kind: "opening", reference: "—", description: "—",
      debit: opening > 0 ? opening : 0, credit: opening < 0 ? Math.abs(opening) : 0, branch_id: null,
    });
  }
  const cType = (c as any)?.type as string;
  const isCustomer = cType === "customer" || cType === "both";
  const isSupplier = cType === "supplier" || cType === "both";

  if (isCustomer) {
    const [{ data: invs }, { data: rets }] = await Promise.all([
      fetchAllRows<any>(() => supabase.from("invoices")
        .select("id, invoice_number, total, created_at, invoice_date, status, is_migrated, branch_id")
        .eq("contact_id", contactId).eq("status", "active").order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("returns")
        .select("id, return_number, total_refund, refund_cash_amount, refund_transfer_amount, refund_method, status, created_at, invoice_date, invoice_id, branch_id, invoices!inner(contact_id, invoice_number, branch_id)")
        .eq("invoices.contact_id", contactId).order("id")).then((data) => ({ data })),
    ]);
    const invIds = (invs ?? []).map((r: any) => r.id);
    const invById = new Map<string, any>((invs ?? []).map((r: any) => [r.id, r]));
    let pays: any[] = [];
    if (invIds.length) {
      const data: any[] = [];
      for (let i = 0; i < invIds.length; i += 200) {
        const chunk = invIds.slice(i, i + 200);
        data.push(...await fetchAllRows<any>(() => supabase.from("invoice_payments")
          .select("id, amount, payment_method, created_at, invoice_id, voided_at, reverses_payment_id")
          .in("invoice_id", chunk).order("id")));
      }
      pays = data.filter((p: any) => !p.voided_at && !p.reverses_payment_id);
    }
    (invs ?? []).forEach((r: any) => list.push({
      date: r.invoice_date ?? r.created_at, type: "فاتورة بيع", kind: "sale", reference: r.invoice_number,
      description: r.is_migrated ? "فاتورة قديمة مرحّلة" : "—",
      debit: Number(r.total ?? 0), credit: 0, branch_id: r.branch_id ?? null,
      link: r.branch_id ? `/branch/${r.branch_id}/sales/${r.id}` : undefined,
    }));
    pays.forEach((p: any) => {
      const amt = Number(p.amount ?? 0);
      const isPrepaid = p.payment_method === "credit_balance" || p.payment_method === "credit_applied";
      const inv = invById.get(p.invoice_id);
      list.push({
        date: p.created_at, kind: "sale_payment",
        type: isPrepaid ? "خصم من الرصيد المسبق" : "تحصيل من عميل",
        reference: inv?.invoice_number ?? "—",
        description: isPrepaid ? "سداد من دفعة مقدمة (بدون حركة خزينة)" : (p.payment_method ?? "—"),
        debit: 0, credit: amt, branch_id: inv?.branch_id ?? null,
      });
    });
    (rets ?? []).forEach((r: any) => {
      if (["draft", "cancelled"].includes(String(r.status ?? "active"))) return;
      const creditNote = Math.max(0, Number(r.total_refund ?? 0) - Number(r.refund_cash_amount ?? 0) - Number(r.refund_transfer_amount ?? 0));
      list.push({
        date: r.invoice_date ?? r.created_at, type: "مرتجع بيع", kind: "sale_return",
        reference: r.return_number ?? r.invoices?.invoice_number ?? "—",
        description: r.refund_method ?? "—", debit: 0, credit: creditNote,
        branch_id: r.branch_id ?? r.invoices?.branch_id ?? null,
      });
    });
  }

  if (isSupplier) {
    const [{ data: ships }, { data: sp }, { data: prets }] = await Promise.all([
      fetchAllRows<any>(() => supabase.from("shipments")
        .select("id, shipment_number, total_cost, arrival_date, invoice_date, created_at, is_migrated, branch_id")
        .eq("contact_id", contactId).order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("supplier_payments" as any).select("id, amount, paid_at, notes, branch_id").eq("contact_id", contactId).order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("purchase_returns")
        .select("id, return_number, total_amount, refund_cash_amount, refund_transfer_amount, status, created_at, invoice_date, refund_method, branch_id")
        .eq("contact_id", contactId).eq("status", "active").order("id")).then((data) => ({ data })),
    ]);
    (ships ?? []).forEach((s: any) => list.push({
      date: s.invoice_date ?? s.arrival_date ?? s.created_at, type: "فاتورة شراء", kind: "purchase",
      reference: s.shipment_number ?? "—", description: s.is_migrated ? "فاتورة قديمة مرحّلة" : "—",
      debit: 0, credit: Number(s.total_cost ?? 0), branch_id: s.branch_id ?? null,
      link: s.branch_id ? `/branch/${s.branch_id}/shipments/${s.id}` : undefined,
    }));
    ((sp as any[]) ?? []).forEach((p: any) => list.push({
      date: p.paid_at, type: "دفع لمورد", kind: "supplier_payment", reference: "—",
      description: p.notes ?? "—", debit: Number(p.amount ?? 0), credit: 0, branch_id: p.branch_id ?? null,
    }));
    (prets ?? []).forEach((r: any) => list.push({
      date: r.invoice_date ?? r.created_at, type: "مرتجع شراء", kind: "purchase_return",
      reference: r.return_number ?? "—", description: r.refund_method ?? "—",
      debit: Math.max(0, Number(r.total_amount ?? 0) - Number(r.refund_cash_amount ?? 0) - Number(r.refund_transfer_amount ?? 0)),
      credit: 0, branch_id: r.branch_id ?? null,
    }));
  }

  const vchs = await fetchAllRows<any>(() => supabase.from("vouchers" as any)
    .select("*, branches(name)")
    .eq("party_id", contactId)
    .in("party_type", ["customer", "supplier"])
    .eq("status", "active")
    .order("voucher_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id"));
  const vouchers = (vchs as any[]) ?? [];
  vouchers.forEach((v: any) => {
    const amt = Number(v.amount ?? 0);
    list.push({
      date: v.voucher_date, kind: v.type === "receipt" ? "receipt_voucher" : "payment_voucher",
      type: v.type === "receipt" ? "سند قبض" : "سند صرف",
      reference: v.voucher_number ?? "—", description: v.description ?? "—",
      debit: v.type === "payment" ? amt : 0, credit: v.type === "receipt" ? amt : 0,
      branch_id: v.branch_id ?? null,
    });
  });

  // «إيداع رصيد تحت الحساب» (central management account). Balance effect lives in credit_balance,
  // which total_balance already includes — this row makes that credit visible in the statement.
  const deposits = await fetchAllRows<any>(() => supabase.from("vouchers" as any)
    .select("id, voucher_number, amount, voucher_date, description, branch_id")
    .eq("party_id", contactId).eq("source_type", "credit_deposit").eq("status", "active")
    .order("id"));
  (deposits ?? []).forEach((v: any) => list.push({
    date: v.voucher_date, kind: "credit_deposit", type: "إيداع رصيد تحت الحساب — حساب الإدارة",
    reference: v.voucher_number ?? "—", description: v.description ?? "—",
    debit: 0, credit: Number(v.amount ?? 0), branch_id: v.branch_id ?? null, financial_scope: "management",
  }));

  list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return {
    contact: c,
    totalBalance: Number(bRow?.total_balance ?? 0),
    creditBalance: Number(bRow?.credit_balance ?? 0),
    rows: list,
    vouchers,
  };
}

/** Filters rows by branch set. Empty set = all branches (includes contact-level opening row). */
export function filterLedgerByBranches(rows: LedgerRow[], branchIds: string[]): LedgerRow[] {
  if (!branchIds.length) return rows;
  const set = new Set(branchIds);
  return rows.filter((r) => r.kind !== "opening" && r.branch_id != null && set.has(r.branch_id));
}

/** Adds running balance to a chronological copy. */
export function withRunningBalance(rows: LedgerRow[]): LedgerRow[] {
  let run = 0;
  return rows.map((r) => { run += r.debit - r.credit; return { ...r, balance: run }; });
}

export function ledgerSum(rows: LedgerRow[]): number {
  return rows.reduce((s, r) => s + r.debit - r.credit, 0);
}

/** Balance for selection: all branches → official view total; specific → formula over filtered rows. */
export function balanceForSelection(l: ContactLedger | null, branchIds: string[]): number {
  if (!l) return 0;
  if (!branchIds.length) return l.totalBalance;
  return ledgerSum(filterLedgerByBranches(l.rows, branchIds));
}
