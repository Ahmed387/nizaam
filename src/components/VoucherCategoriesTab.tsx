import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fetchVoucherCategories, VoucherCategory, VoucherType, VOUCHER_TYPE_LABEL } from "@/lib/vouchers";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function VoucherCategoriesTab() {
  const { tenantId } = useAuth();
  const [cats, setCats] = useState<VoucherCategory[]>([]);
  const [dialog, setDialog] = useState<{ open: boolean; parent: VoucherCategory | null }>({ open: false, parent: null });
  const [name, setName] = useState("");

  const load = () => fetchVoucherCategories().then(setCats).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const addChild = async () => {
    if (!dialog.parent || !name.trim() || !tenantId) return;
    const { error } = await supabase.from("voucher_categories" as any).insert({
      tenant_id: tenantId,
      name: name.trim(),
      type: dialog.parent.type,
      parent_id: dialog.parent.id,
      is_system: false,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("تم إضافة التصنيف الفرعي");
    setDialog({ open: false, parent: null });
    setName("");
    load();
  };

  const removeCat = async (c: VoucherCategory) => {
    if (c.is_system) return toast.error("لا يمكن حذف تصنيف نظامي");
    const { count } = await supabase.from("vouchers" as any).select("id", { count: "exact", head: true }).eq("category_id", c.id);
    if ((count ?? 0) > 0) return toast.error("التصنيف مرتبط بسندات");
    if (!confirm(`حذف "${c.name}"؟`)) return;
    const { error } = await supabase.from("voucher_categories" as any).delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    load();
  };

  const renderType = (type: VoucherType) => {
    const roots = cats.filter((c) => c.type === type && !c.parent_id);
    return (
      <div className="space-y-3">
        {roots.map((r) => {
          const children = cats.filter((c) => c.parent_id === r.id);
          return (
            <div key={r.id} className="card-elevated p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{r.name}</span>
                  {r.is_system && <Badge variant="outline" className="text-xs">نظام</Badge>}
                </div>
                <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, parent: r })} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> فرعي
                </Button>
              </div>
              {children.length > 0 && (
                <div className="mt-2 ps-4 border-s-2 border-muted space-y-1">
                  {children.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm py-1">
                      <span>— {c.name}</span>
                      <Button size="icon" variant="ghost" onClick={() => removeCat(c)} className="h-7 w-7 text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <Tabs defaultValue="payment">
        <TabsList>
          <TabsTrigger value="payment">تصنيفات الصرف</TabsTrigger>
          <TabsTrigger value="receipt">تصنيفات القبض</TabsTrigger>
        </TabsList>
        <TabsContent value="payment" className="mt-4">{renderType("payment")}</TabsContent>
        <TabsContent value="receipt" className="mt-4">{renderType("receipt")}</TabsContent>
      </Tabs>

      <Dialog open={dialog.open} onOpenChange={(o) => setDialog({ open: o, parent: o ? dialog.parent : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تصنيف فرعي تحت "{dialog.parent?.name}" ({dialog.parent && VOUCHER_TYPE_LABEL[dialog.parent.type]})</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label>اسم التصنيف الفرعي</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog({ open: false, parent: null })}>إلغاء</Button>
            <Button onClick={addChild}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
