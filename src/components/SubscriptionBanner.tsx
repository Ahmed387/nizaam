/**
 * A thin bar for the company owner / admin when the subscription is ending, in its grace days or over (0239).
 * The text comes from `planBanner` (src/lib/planFeatures.ts). Hidden for everybody else and for the platform owner.
 */
import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { planBanner } from "@/lib/planFeatures";

export default function SubscriptionBanner() {
  const { planState, isAdmin, isSuperAdmin } = useAuth();
  const [closed, setClosed] = useState(false);
  const b = planBanner(planState);
  if (!b || !isAdmin || isSuperAdmin || (closed && b.tone === "warn")) return null;
  return (
    <div dir="rtl" role="status"
      className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold shadow-lg ${b.tone === "bad" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"}`}>
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{b.text}</span>
      {b.tone === "warn" && (
        <button type="button" aria-label="إخفاء" onClick={() => setClosed(true)} className="opacity-80 hover:opacity-100"><X className="w-4 h-4" /></button>
      )}
    </div>
  );
}
