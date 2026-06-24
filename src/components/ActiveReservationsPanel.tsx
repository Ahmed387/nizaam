import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, X } from "lucide-react";
import { releaseReservation } from "@/lib/reservations";

interface Row {
  id: string;
  product_id: string;
  product_name?: string;
  reserved_quantity: number;
  cashier_name: string | null;
  created_at: string;
  expires_at: string;
}

const arabicDuration = (ms: number) => {
  if (ms < 0) return "انتهى";
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "<دقيقة";
  if (totalMin < 60) return `${totalMin} دقيقة`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}س ${m}د`;
};

export function ActiveReservationsPanel({ branchId }: { branchId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const { data: res } = await supabase
      .from("inventory_reservations" as any)
      .select("id, product_id, reserved_quantity, cashier_name, created_at, expires_at")
      .eq("branch_id", branchId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    const list = (res ?? []) as any as Row[];
    const ids = Array.from(new Set(list.map((r) => r.product_id)));
    if (ids.length) {
      const { data: prods } = await supabase.from("products").select("id, name").in("id", ids);
      const map = new Map((prods ?? []).map((p: any) => [p.id, p.name]));
      list.forEach((r) => { r.product_name = map.get(r.product_id) ?? "—"; });
    }
    setRows(list);
  }, [branchId]);

  useEffect(() => {
    load();
    const tick = setInterval(() => setNow(Date.now()), 30 * 1000);
    const ch = supabase.channel(`active-res-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_reservations", filter: `branch_id=eq.${branchId}` }, () => load())
      .subscribe();
    return () => { clearInterval(tick); supabase.removeChannel(ch); };
  }, [branchId, load]);

  const handleRelease = async (id: string) => {
    await releaseReservation(id, "cancelled");
    toast.success("تم تحرير الحجز");
    load();
  };

  return (
    <div className="card-elevated p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-extrabold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> الحجوزات النشطة الآن</h3>
        <span className="text-sm font-bold text-primary bg-primary/10 px-3 py-1 rounded-full">{rows.length} حجز حالياً</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-center text-base font-semibold text-muted-foreground py-6">لا توجد حجوزات نشطة حالياً</div>

      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-3 py-2 text-right">المنتج</th>
                <th className="px-3 py-2 text-right">الكمية</th>
                <th className="px-3 py-2 text-right">الكاشير</th>
                <th className="px-3 py-2 text-right">منذ</th>
                <th className="px-3 py-2 text-right">ينتهي خلال</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ageMs = now - new Date(r.created_at).getTime();
                const leftMs = new Date(r.expires_at).getTime() - now;
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">{r.product_name}</td>
                    <td className="px-3 py-2 font-bold">{r.reserved_quantity}</td>
                    <td className="px-3 py-2">{r.cashier_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{arabicDuration(ageMs)}</td>
                    <td className={`px-3 py-2 ${leftMs < 5 * 60_000 ? "text-warning font-bold" : ""}`}>{arabicDuration(leftMs)}</td>
                    <td className="px-3 py-2 text-left">
                      <Button size="sm" variant="ghost" className="text-destructive gap-1" onClick={() => handleRelease(r.id)}>
                        <X className="w-3.5 h-3.5" /> تحرير الحجز
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
