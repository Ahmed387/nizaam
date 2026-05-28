import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { fetchVoucherCategories, VoucherCategory, VoucherType, VOUCHER_TYPE_LABEL } from "@/lib/vouchers";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type DialogState =
  | { open: false }
  | { open: true; mode: "child"; parent: VoucherCategory; type: VoucherType }
  | { open: true; mode: "root"; parent: null; type: VoucherType };

export function VoucherCategoriesTab() {
  const { tenantId } = useAuth();
  const [cats, setCats] = useState<VoucherCategory[]>([]);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [name, setName] = useState("");

  const load = () => fetchVoucherCategories().then(setCats).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!dialog.open || !name.trim() || !tenantId) return;
    const { error } = await supabase.from("voucher_categories" as any).insert({
      tenant_id: tenantId,
      name: name.trim(),
      type: dialog.type,
      parent_id: dialog.mode === "child" ? dialog.parent.id : null,
      is_system: false,
      is_active: true,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("تم الحفظ");
    setDialog({ open: false });
    setName("");
    load();
  };

  const removeCat = async (c: VoucherCategory) => {
    if (c.is_system) return toast.error("لا يمكن حذف تصنيف نظامي");
    const { count } = await supabase.from("vouchers" as any).select("id", { count: "exact", head: true }).eq("category_id", c.id);
    if ((count ?? 0) > 0) return toast.error("التصنيف مرتبط بسندات — قم بتعطيله بدلاً من الحذف");
    if (!confirm(`حذف "${c.name}"؟`)) return;
    const { error } = await supabase.from("voucher_categories" as any).delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    load();
  };

  const toggleActive = async (c: VoucherCategory, next: boolean) => {
    const { error } = await supabase.from("voucher_categories" as any).update({ is_active: next } as any).eq("id", c.id);
    if (error) return toast.error(error.message);
    load();
  };

  const renderType = (type: VoucherType) => {
    const roots = cats.filter((c) => c.type === type && !c.parent_id);
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => { setName(""); setDialog({ open: true, mode: "root", parent: null, type }); }} className="gap-1">
            <Plus className="w-4 h-4" /> تصنيف رئيسي جديد
          </Button>
        </div>
        {roots.map((r) => {
          const children = cats.filter((c) => c.parent_id === r.id);
          return (
            <div key={r.id} className="card-elevated p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{r.name}</span>
                  {r.is_system && <Badge variant="outline" className="text-xs">نظام</Badge>}
                  {!r.is_active && <Badge variant="secondary" className="text-xs">معطّل</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">مفعّل</span>
                    <Switch checked={r.is_active} onCheckedChange={(v) => toggleActive(r, v)} />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setName(""); setDialog({ open: true, mode: "child", parent: r, type }); }} className="gap-1">
                    <Plus className="w-3.5 h-3.5" /> فرعي
                  </Button>
                  {!r.is_system && (
                    <Button size="icon" variant="ghost" onClick={() => removeCat(r)} className="h-8 w-8 text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              {children.length > 0 && (
                <div className="mt-2 ps-4 border-s-2 border-muted space-y-1">
                  {children.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm py-1 gap-2">
                      <div className="flex items-center gap-2">
                        <span>— {c.name}</span>
                        {!c.is_active && <Badge variant="secondary" className="text-xs">معطّل</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={c.is_active} onCheckedChange={(v) => toggleActive(c, v)} />
                        {!c.is_system && (
                          <Button size="icon" variant="ghost" onClick={() => removeCat(c)} className="h-7 w-7 text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
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

  const dialogTitle = !dialog.open
    ? ""
    : dialog.mode === "child"
      ? `تصنيف فرعي تحت "${dialog.parent.name}" (${VOUCHER_TYPE_LABEL[dialog.type]})`
      : `تصنيف رئيسي جديد (${VOUCHER_TYPE_LABEL[dialog.type]})`;

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

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label>اسم التصنيف</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog({ open: false })}>إلغاء</Button>
            <Button onClick={save}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
