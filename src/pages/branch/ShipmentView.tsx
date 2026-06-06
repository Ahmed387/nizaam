import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { Loader2, Package, Phone, User, Calendar, ClipboardList, Truck, Receipt } from "lucide-react";

export default function ShipmentView() {
  const { id: branchId, shipmentId } = useParams<{ id: string; shipmentId: string }>();
  const [ship, setShip] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("shipments").select("*, suppliers(name, phone, address, tax_number)").eq("id", shipmentId!).maybeSingle();
      const { data: it } = await supabase
        .from("shipment_items")
        .select("*, products(name, sku, selling_price, quantity, image, low_stock_alert)")
        .eq("shipment_id", shipmentId!);
      setShip(s);
      setItems(it ?? []);
      setLoading(false);
    })();
  }, [shipmentId]);

  if (loading) return <BranchLayout><div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></BranchLayout>;
  if (!ship) return <BranchLayout><div className="text-center p-12 text-muted-foreground">شحنة غير موجودة</div></BranchLayout>;

  const goodsValue = ship.total_cost - ship.shipping_cost - ship.admin_cost;
  const itemsGross = items.reduce((s, it) => s + Number(it.quantity) * Number(it.cost_price), 0);
  const itemsDiscount = itemsGross - items.reduce((s, it) => s + Number(it.total ?? 0), 0);

  return (
    <BranchLayout>
      <PageHeader title={`شحنة #${ship.id.slice(0, 8)}`} subtitle={formatDate(ship.arrival_date)} />

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="card-elevated p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Truck className="w-4 h-4 text-primary" /></div>
            <h3 className="font-bold text-sm">بيانات المورد</h3>
          </div>
          <div className="text-sm space-y-2">
            <div className="flex items-center gap-2"><Package className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">الاسم:</span> <b>{ship.suppliers?.name ?? "—"}</b></div>
            <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">الهاتف:</span> {ship.suppliers?.phone ?? "—"}</div>
            {ship.suppliers?.address && <div className="flex items-center gap-2"><ClipboardList className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">العنوان:</span> {ship.suppliers.address}</div>}
            {ship.suppliers?.tax_number && <div className="flex items-center gap-2"><Receipt className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">الرقم الضريبي:</span> {ship.suppliers.tax_number}</div>}
          </div>
        </div>

        <div className="card-elevated p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><User className="w-4 h-4 text-primary" /></div>
            <h3 className="font-bold text-sm">بيانات الاستلام</h3>
          </div>
          <div className="text-sm space-y-2">
            <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">المستلم:</span> <b>{ship.received_by}</b></div>
            <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">تاريخ الوصول:</span> {formatDate(ship.arrival_date)}</div>
            <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">تاريخ الإنشاء:</span> {formatDate(ship.created_at)}</div>
            {ship.notes && <div className="flex items-start gap-2"><ClipboardList className="w-3.5 h-3.5 text-muted-foreground mt-0.5" /><span className="text-muted-foreground">ملاحظات:</span> <span className="text-xs">{ship.notes}</span></div>}
          </div>
        </div>

        <div className="card-elevated p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Receipt className="w-4 h-4 text-primary" /></div>
            <h3 className="font-bold text-sm">التكاليف</h3>
          </div>
          <div className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-muted-foreground">قيمة البضاعة (قبل الخصم)</span><b>{formatEGP(itemsGross)}</b></div>
            {itemsDiscount > 0 && (
              <div className="flex justify-between text-destructive"><span>إجمالي الخصومات</span><b>− {formatEGP(itemsDiscount)}</b></div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">صافي البضاعة</span><b>{formatEGP(goodsValue)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الشحن</span><b>{formatEGP(ship.shipping_cost)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">إدارية</span><b>{formatEGP(ship.admin_cost)}</b></div>
            <div className="border-t border-border pt-2 flex justify-between text-lg"><span>الإجمالي</span><b className="text-primary">{formatEGP(ship.total_cost)}</b></div>
          </div>
        </div>
      </div>

      <div className="card-elevated overflow-hidden">
        <div className="p-4 border-b border-border font-bold flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          المنتجات ({items.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="px-4 py-3 text-right">المنتج</th>
                <th className="px-4 py-3 text-right">الكود</th>
                <th className="px-4 py-3 text-right">الكمية المستلمة</th>
                <th className="px-4 py-3 text-right">سعر التكلفة</th>
                <th className="px-4 py-3 text-right">سعر البيع الحالي</th>
                <th className="px-4 py-3 text-right">المخزون الحالي</th>
                <th className="px-4 py-3 text-right">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-border hover:bg-surface-2/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {it.products?.image ? (
                        <img src={it.products.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-border" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground">صورة</div>
                      )}
                      <div>
                        <div className="font-medium">{it.product_name}</div>
                        {it.products?.name && it.products.name !== it.product_name && (
                          <div className="text-xs text-muted-foreground">{it.products.name}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{it.products?.sku ?? "—"}</td>
                  <td className="px-4 py-3">{it.quantity}</td>
                  <td className="px-4 py-3">{formatEGP(it.cost_price)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{it.products?.selling_price ? formatEGP(it.products.selling_price) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${(it.products?.quantity ?? 1) <= 0 ? 'bg-destructive/10 text-destructive' : (it.products?.quantity ?? 0) < (it.products?.low_stock_alert ?? 5) ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                      {it.products?.quantity ?? 1}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold">{formatEGP(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {items.length === 1 && (
          <div className="p-4 border-t border-border bg-surface-2/30">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-muted-foreground">المنتج:</span> <b>{items[0].product_name}</b></div>
              <div><span className="text-muted-foreground">الكود:</span> <b>{items[0].products?.sku ?? "—"}</b></div>
              <div><span className="text-muted-foreground">الكمية:</span> <b>{items[0].quantity}</b></div>
              <div><span className="text-muted-foreground">الإجمالي:</span> <b className="text-primary">{formatEGP(items[0].total)}</b></div>
            </div>
          </div>
        )}
      </div>
    </BranchLayout>
  );
}
