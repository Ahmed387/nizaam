import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, PartyPopper, Sparkles, X } from "lucide-react";

/**
 * Fullscreen celebratory overlay that appears in real-time whenever ANY invoice
 * in the tenant becomes fully paid — from NewSale, EditSaleInvoice, payments
 * panel, contact statement, etc.
 *
 * Listens to invoice_payments / payment_transactions / payment_plans and shows
 * a confetti + scale-in card. Auto-dismisses after 4.5s.
 */

type Celebration = { invoiceNumber: string; total: number } | null;

export function PaidCelebration() {
  const { user } = useAuth();
  const announcedRef = useRef<Set<string>>(new Set());
  const [current, setCurrent] = useState<Celebration>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!current) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4200);
    const t2 = setTimeout(() => setCurrent(null), 4700);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [current]);

  useEffect(() => {
    if (!user) return;

    const check = async (invoiceId: string) => {
      if (!invoiceId || announcedRef.current.has(invoiceId)) return;
      announcedRef.current.add(invoiceId);
      try {
        const { data: inv } = await supabase
          .from("invoices")
          .select("id, invoice_number, total, status")
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
          (s: number, p: any) =>
            p.voided_at || p.reverses_payment_id ? s : s + Number(p.amount || 0),
          0
        );
        const paid = Math.max(fromPays, Number(planRes.data?.paid_amount || 0));

        if (paid >= total - 0.01) {
          setCurrent({ invoiceNumber: inv.invoice_number, total });
        } else {
          announcedRef.current.delete(invoiceId);
        }
      } catch {
        announcedRef.current.delete(invoiceId);
      }
    };

    const channel = supabase
      .channel("paid-celebration")
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
        async (payload: any) => {
          const row = payload.new ?? payload.old;
          const planId = row?.payment_plan_id;
          if (!planId) return;
          const { data: plan } = await supabase
            .from("payment_plans")
            .select("reference_type, reference_id")
            .eq("id", planId)
            .maybeSingle();
          if (plan?.reference_type === "invoice" && plan?.reference_id)
            check(plan.reference_id);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_plans" },
        (payload: any) => {
          const row = payload.new;
          if (row?.reference_type === "invoice" && row?.reference_id)
            check(row.reference_id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  if (!current) return null;

  return (
    <div
      dir="rtl"
      onClick={() => setVisible(false)}
      className={`fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-500 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      style={{
        background:
          "radial-gradient(circle at center, hsl(var(--success) / 0.25), hsl(var(--background) / 0.85) 70%)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Confetti */}
      <Confetti active={visible} />

      {/* Sparkle rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="w-[380px] h-[380px] max-w-[90vw] max-h-[90vw] rounded-full border-4 border-success/40"
          style={{ animation: visible ? "paid-ring 1.6s ease-out infinite" : "none" }}
        />
        <div
          className="absolute w-[380px] h-[380px] max-w-[90vw] max-h-[90vw] rounded-full border-4 border-success/30"
          style={{ animation: visible ? "paid-ring 1.6s ease-out 0.4s infinite" : "none" }}
        />
      </div>

      {/* Main card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-card border-2 border-success/50 rounded-3xl shadow-2xl px-10 py-12 max-w-md mx-4 text-center animate-scale-in"
        style={{
          boxShadow:
            "0 25px 60px -12px hsl(var(--success) / 0.5), 0 0 80px hsl(var(--success) / 0.2)",
        }}
      >
        <button
          onClick={() => setVisible(false)}
          className="absolute top-3 left-3 p-1.5 rounded-full hover:bg-muted transition-colors"
          aria-label="إغلاق"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>

        {/* Floating emojis */}
        <div className="absolute -top-4 -right-4 text-4xl" style={{ animation: "paid-bounce 1.2s ease-in-out infinite" }}>
          🎉
        </div>
        <div
          className="absolute -top-2 -left-2 text-3xl"
          style={{ animation: "paid-bounce 1.2s ease-in-out 0.3s infinite" }}
        >
          ✨
        </div>
        <div
          className="absolute -bottom-3 -left-4 text-3xl"
          style={{ animation: "paid-bounce 1.2s ease-in-out 0.6s infinite" }}
        >
          💰
        </div>

        {/* Big check icon */}
        <div className="mx-auto mb-6 relative w-28 h-28">
          <div
            className="absolute inset-0 rounded-full bg-success/20"
            style={{ animation: "paid-pulse 1.4s ease-out infinite" }}
          />
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-success to-success/70 flex items-center justify-center shadow-lg animate-scale-in">
            <CheckCircle2 className="w-16 h-16 text-white" strokeWidth={2.5} />
          </div>
          <Sparkles
            className="absolute -top-1 -right-1 w-6 h-6 text-warning"
            style={{ animation: "paid-spin 2s linear infinite" }}
          />
        </div>

        <div className="flex items-center justify-center gap-2 mb-2">
          <PartyPopper className="w-6 h-6 text-warning" />
          <h2 className="text-3xl font-black text-success">تم السداد بالكامل!</h2>
          <PartyPopper className="w-6 h-6 text-warning scale-x-[-1]" />
        </div>

        <p className="text-lg text-muted-foreground mt-3">
          فاتورة رقم{" "}
          <span className="font-mono font-bold text-foreground">
            {current.invoiceNumber}
          </span>
        </p>
        <div className="mt-4 inline-flex items-baseline gap-2 bg-success/10 px-6 py-3 rounded-2xl">
          <span className="text-sm text-muted-foreground">الإجمالي</span>
          <span className="text-3xl font-black text-success tabular-nums">
            {current.total.toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-base text-success/80 font-bold">ج.م</span>
        </div>
      </div>
    </div>
  );
}

/** Falling confetti dots — pure CSS, no deps. */
function Confetti({ active }: { active: boolean }) {
  const pieces = Array.from({ length: 60 });
  const colors = [
    "hsl(var(--success))",
    "hsl(var(--warning))",
    "hsl(var(--primary))",
    "hsl(var(--destructive))",
    "#f59e0b",
    "#ec4899",
    "#8b5cf6",
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 1.2;
        const duration = 2.5 + Math.random() * 2;
        const size = 6 + Math.random() * 8;
        const color = colors[i % colors.length];
        const rotate = Math.random() * 360;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              top: "-20px",
              left: `${left}%`,
              width: size,
              height: size * 0.4,
              background: color,
              borderRadius: 2,
              transform: `rotate(${rotate}deg)`,
              animation: active
                ? `paid-fall ${duration}s cubic-bezier(.2,.6,.4,1) ${delay}s infinite`
                : "none",
              opacity: 0.9,
            }}
          />
        );
      })}
    </div>
  );
}
