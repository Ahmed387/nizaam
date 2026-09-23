import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ContactBranchRow {
  branch_id: string;
  branch_name: string;
  total_sales: number;
  total_supplies: number;
  paid_at_branch: number;
  branch_balance: number;
}

export interface ContactOpenInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  branch_id: string;
  branch_name: string;
  total: number;
  paid: number;
  remaining: number;
}

export interface ContactBranchBreakdown {
  totals: {
    total_sales: number;
    total_supplies: number;
    total_paid: number;
    net_balance: number;
    credit_balance: number;
  };
  branches: ContactBranchRow[];
  openInvoices: ContactOpenInvoice[];
}

export const contactBranchBreakdownKey = (contactId: string, tenantId: string) =>
  ["contact-branch-breakdown", contactId, tenantId] as const;

/**
 * Cross-branch financial profile for a single contact.
 * Lazy: only runs while the contact's accordion row is expanded.
 * Remaining-per-invoice mirrors public.invoice_outstanding_debt exactly
 * (total − live payments − credit-settled returns).
 */
export function useContactBranchBreakdown(
  contactId: string | null | undefined,
  tenantId: string | null | undefined,
  enabled: boolean,
) {
  const active = Boolean(enabled && contactId && tenantId);

  return useQuery({
    queryKey: contactBranchBreakdownKey(contactId ?? "", tenantId ?? ""),
    enabled: active,
    staleTime: 3 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ContactBranchBreakdown> => {
      const cid = contactId!;
      const tid = tenantId!;

      const [balRes, invRes, shipRes, branchRes] = await Promise.all([
        supabase
          .from("v_contact_balances" as any)
          .select("total_balance, credit_balance, total_paid")
          .eq("contact_id", cid)
          .maybeSingle(),
        supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date, branch_id, total")
          .eq("contact_id", cid)
          .eq("tenant_id", tid)
          .eq("status", "active")
          .order("invoice_date", { ascending: true }),
        supabase
          .from("shipments")
          .select("branch_id, total_cost")
          .eq("contact_id", cid)
          .eq("tenant_id", tid),
        supabase.from("branches").select("id, name").eq("tenant_id", tid),
      ]);

      if (invRes.error) throw invRes.error;

      const invoices = (invRes.data ?? []) as any[];
      const invoiceIds = invoices.map((i) => i.id);
      const branchName = new Map<string, string>(
        ((branchRes.data ?? []) as any[]).map((b) => [b.id, b.name as string]),
      );

      let payments: any[] = [];
      let returns: any[] = [];
      if (invoiceIds.length) {
        const [payRes, retRes] = await Promise.all([
          supabase
            .from("invoice_payments")
            .select("invoice_id, branch_id, amount, payment_method")
            .in("invoice_id", invoiceIds)
            .is("voided_at", null)
            .is("reverses_payment_id", null),
          supabase
            .from("returns")
            .select("invoice_id, total_refund, refund_cash_amount, refund_transfer_amount, status")
            .in("invoice_id", invoiceIds),
        ]);
        payments = (payRes.data ?? []) as any[];
        returns = ((retRes.data ?? []) as any[]).filter(
          (r) => !["draft", "cancelled"].includes(String(r.status ?? "active")),
        );
      }

      const paidByInvoice = new Map<string, number>();
      const paidByBranch = new Map<string, number>();
      for (const p of payments) {
        const amt = Number(p.amount ?? 0);
        paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + amt);
        paidByBranch.set(p.branch_id, (paidByBranch.get(p.branch_id) ?? 0) + amt);
      }

      const creditReturnByInvoice = new Map<string, number>();
      for (const r of returns) {
        const credited = Math.max(
          Number(r.total_refund ?? 0) -
            Number(r.refund_cash_amount ?? 0) -
            Number(r.refund_transfer_amount ?? 0),
          0,
        );
        creditReturnByInvoice.set(
          r.invoice_id,
          (creditReturnByInvoice.get(r.invoice_id) ?? 0) + credited,
        );
      }

      const salesByBranch = new Map<string, number>();
      const openInvoices: ContactOpenInvoice[] = [];
      let totalSales = 0;

      for (const inv of invoices) {
        const total = Number(inv.total ?? 0);
        totalSales += total;
        salesByBranch.set(inv.branch_id, (salesByBranch.get(inv.branch_id) ?? 0) + total);

        const paid = paidByInvoice.get(inv.id) ?? 0;
        const remaining = Math.max(total - paid - (creditReturnByInvoice.get(inv.id) ?? 0), 0);
        if (remaining > 0.01) {
          openInvoices.push({
            id: inv.id,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            branch_id: inv.branch_id,
            branch_name: branchName.get(inv.branch_id) ?? "—",
            total,
            paid,
            remaining,
          });
        }
      }

      const suppliesByBranch = new Map<string, number>();
      let totalSupplies = 0;
      for (const s of (shipRes.data ?? []) as any[]) {
        const cost = Number(s.total_cost ?? 0);
        totalSupplies += cost;
        suppliesByBranch.set(s.branch_id, (suppliesByBranch.get(s.branch_id) ?? 0) + cost);
      }

      const branchIds = Array.from(
        new Set([...salesByBranch.keys(), ...suppliesByBranch.keys(), ...paidByBranch.keys()]),
      );
      const branches: ContactBranchRow[] = branchIds.map((bid) => {
        const sales = salesByBranch.get(bid) ?? 0;
        const supplies = suppliesByBranch.get(bid) ?? 0;
        const paid = paidByBranch.get(bid) ?? 0;
        return {
          branch_id: bid,
          branch_name: branchName.get(bid) ?? "—",
          total_sales: sales,
          total_supplies: supplies,
          paid_at_branch: paid,
          branch_balance: sales - paid - supplies,
        };
      });
      branches.sort((a, b) => b.total_sales - a.total_sales);

      const bal = (balRes.data ?? null) as any;
      const totalPaid = Number(bal?.total_paid ?? 0) || Array.from(paidByBranch.values()).reduce((s, v) => s + v, 0);

      return {
        totals: {
          total_sales: totalSales,
          total_supplies: totalSupplies,
          total_paid: totalPaid,
          net_balance: Number(bal?.total_balance ?? totalSales - totalPaid - totalSupplies),
          credit_balance: Number(bal?.credit_balance ?? 0),
        },
        branches,
        openInvoices,
      };
    },
  });
}
