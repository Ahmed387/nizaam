import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { Loader2 } from "lucide-react";

export default function ShipmentView() {
  const { id: branchId, shipmentId } = useParams<{ id: string; shipmentId: string }>();
  const [ship, setShip] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("shipments").select("*, suppliers(company_name, phone)").eq("id", shipmentId!).maybeSingle();
      const { data: it } = await supabase.from("shipment_items").select("*").eq("shipment_id", shipmentId!);
      setShip(s);
      setItems(it ?? []);
      setLoading(false);
    })();
  }, [shipmentId]);

  if (loading) return <BranchLayout><div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></BranchLayout>;
  if (!ship) return <BranchLayout><div className="text-center p-12 text-muted-foreground">شحنة غير موجودة</div></BranchLayout>;

  return (
    <BranchLayout>
      <PageHeader title={`شحنة #${ship.id.slice(0, 8)}`} subtitle={formatDate(ship.arrival_date)} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3">بيانات المورد</h3>
          <div className="text-sm space-y-1">
            <div><span className="text-muted-foreground">الاسم:</span> <b>{ship.suppliers?.company_name ?? "—"}</b></div>
            <div><span className="text-muted-foreground">الهاتف:</span> {ship.suppliers?.phone ?? "—"}</div>
            <div><span className="text-muted-foreground">المستلم:</span> {ship.received_by}</div>
            {ship.notes && <div><span className="text-muted-foreground">ملاحظات:</span> {ship.notes}</div>}
          </div>
        </div>
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3">التكاليف</h3>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">قيمة البضاعة</span><b>{formatEGP(ship.total_cost - ship.shipping_cost - ship.admin_cost)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الشحن</span><b>{formatEGP(ship.shipping_cost)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">إدارية</span><b>{formatEGP(ship.admin_cost)}</b></div>
            <div className="border-t border-border pt-2 flex justify-between text-lg"><span>الإجمالي</span><b className="text-primary">{formatEGP(ship.total_cost)}</b></div>
          </div>
        </div>
      </div>

      <div className="card-elevated overflow-hidden">
        <div className="p-4 border-b border-border font-bold">المنتجات ({items.length})</div>
        <table className="w-full text-sm">
          <thead><tr className="bg-surface-2 border-b border-border">
            <th className="px-4 py-2 text-right">المنتج</th>
            <th className="px-4 py-2 text-right">الكمية</th>
            <th className="px-4 py-2 text-right">سعر التكلفة</th>
            <th className="px-4 py-2 text-right">الإجمالي</th>
          </tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-border">
                <td className="px-4 py-2">{it.product_name}</td>
                <td className="px-4 py-2">{it.quantity}</td>
                <td className="px-4 py-2">{formatEGP(it.cost_price)}</td>
                <td className="px-4 py-2 font-bold">{formatEGP(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BranchLayout>
  );
}
