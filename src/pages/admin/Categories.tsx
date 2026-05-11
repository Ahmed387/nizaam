import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, FolderTree, Folder, Trash2, Pencil } from "lucide-react";

export default function Categories() {
  const [cats, setCats] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", parent_id: "" });

  const load = async () => {
    const { data } = await supabase.from("categories").select("*").order("name");
    setCats(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    const { error } = await supabase.from("categories").insert({ name: form.name, parent_id: form.parent_id || null });
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setOpen(false); setForm({ name: "", parent_id: "" }); load();
  };

  const remove = async (id: string) => {
    const { count } = await supabase.from("products").select("id", { head: true, count: "exact" }).eq("category_id", id);
    if ((count ?? 0) > 0) return toast.error("لا يمكن الحذف، يوجد منتجات بهذا التصنيف");
    await supabase.from("categories").delete().eq("id", id);
    load();
  };

  const tree = cats.filter((c) => !c.parent_id);

  return (
    <AdminLayout>
      <PageHeader
        title="التصنيفات"
        subtitle={`${cats.length} تصنيف`}
        actions={<Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> إضافة تصنيف</Button>}
      />

      <div className="card-elevated p-5 space-y-2">
        {tree.length === 0 && <div className="text-muted-foreground text-center py-8">لا توجد تصنيفات بعد</div>}
        {tree.map((c) => (
          <div key={c.id}>
            <div className="flex items-center justify-between p-2 rounded hover:bg-surface-2 group">
              <div className="flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-primary" />
                <span className="font-semibold">{c.name}</span>
              </div>
              <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => remove(c.id)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            {cats.filter((x) => x.parent_id === c.id).map((child) => (
              <div key={child.id} className="flex items-center justify-between p-2 mr-8 rounded hover:bg-surface-2 group">
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-muted-foreground" />
                  <span>{child.name}</span>
                </div>
                <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => remove(child.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>إضافة تصنيف</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>اسم التصنيف *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
            <div>
              <Label>تصنيف رئيسي (اختياري)</Label>
              <Select value={form.parent_id || "none"} onValueChange={(v) => setForm({ ...form, parent_id: v === "none" ? "" : v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="بدون" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— تصنيف رئيسي —</SelectItem>
                  {cats.filter((c) => !c.parent_id).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
