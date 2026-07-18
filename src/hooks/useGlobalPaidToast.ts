import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import React from "react";

/**
 * Global realtime listener: whenever an invoice becomes fully paid (from anywhere
 * in the app — NewSale, InvoicePaymentsPanel, EditSaleInvoice, Contacts, etc.),
 * show a celebratory toast once per invoice/session.
 *
 * Listens on invoice_payments + payment_transactions changes, then recomputes
 * the affected invoice's paid total against its total.
 */
export function useGlobalPaidToast() {
  const { user } = useAuth();
  const announcedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;

    const check = async (invoiceId: string) => {
      if (!invoiceId || announcedRef.current.has(invoiceId)) return;
      // Mark early to avoid duplicate rapid-fire events
      announcedRef.current.add(invoiceId);
      try {
        const { data: inv } = await supabase
          .from("invoices")
          .select("id, invoice_number, total, status, branch_id")
          .eq("id", invoiceId)
          .maybeSingle();
        if (!inv || inv.status !== "active") return;
        const total = Number(inv.total || 0);
        if (total <= 0) return;

        const [paysRes, planRes] = await Promise.all([
          supabase
            .from("invoice_payments")
            .select("amount, voided_at, reverses_payment_id")
            .eq("invoice_id", invoiceId),
          supabase
            .from("payment_plans")
            .select("paid_amount")
            .eq("reference_type", "invoice")
            .eq("reference_id", invoiceId)
            .maybeSingle(),
        ]);
        const fromPays = (paysRes.data ?? []).reduce(
          (s: number, p: any) => (p.voided_at || p.reverses_payment_id ? s : s + Number(p.amount || 0)),
          0
        );
        const paid = Math.max(fromPays, Number(planRes.data?.paid_amount || 0));

        if (paid >= total - 0.01) {
          toast.success(`تم سداد الفاتورة بالكامل 🎉`, {
            description: `فاتورة رقم ${inv.invoice_number} — إجمالي ${total.toFixed(2)} ج.م`,
            duration: 6000,
            icon: React.createElement(CheckCircle2, { className: "w-5 h-5" }),
          });
        } else {
          // Not fully paid; allow future re-check
          announcedRef.current.delete(invoiceId);
        }
      } catch {
        announcedRef.current.delete(invoiceId);
      }
    };

    const channel = supabase
      .channel("global-paid-toast")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoice_payments" },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (row?.invoice_id) check(row.invoice_id);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_transactions" },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (row?.invoice_id) check(row.invoice_id);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_plans" },
        (payload: any) => {
          const row = payload.new;
          if (row?.reference_type === "invoice" && row?.reference_id) check(row.reference_id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);
}
