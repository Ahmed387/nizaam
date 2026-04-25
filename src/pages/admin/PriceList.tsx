import { useEffect, useState, useRef } from "react";
import * as XLSX from "xlsx";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";

export default function PriceList() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ product_name: "", market_price: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("price_list").select("*").order("uploaded_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.product_name || !form.market_price) return toast.error("أدخل البيانات");
    await supabase.from("price_list").insert({
      product_name: form.product_name,
      market_price: Number(form.market_price),
      uploaded_by: user!.id,
    });
    toast.success("تمت الإضافة");
    setOpen(false); setForm({ product_name: "", market_price: "" }); load();
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<any>(sheet);
    const records = json
      .map((r) => ({
        product_name: r["اسم المنتج"] ?? r["product_name"] ?? r["name"],
        market_price: Number(r["سعر السوق"] ?? r["market_price"] ?? r["price"]),
        uploaded_by: user!.id,
      }))
      .filter((r) => r.product_name && !isNaN(r.market_price));
    if (!records.length) return toast.error("لم يتم العثور على بيانات صحيحة");
    const { error } = await supabase.from("price_list").insert(records);
    if (error) toast.error(error.message);
    else toast.success(`تم رفع ${records.length} منتج`);
    if (fileRef.current) fileRef.current.value = "";
    load();
  };

  return (
    <AdminLayout>
      <PageHeader
        title="قائمة أسعار السوق"
        subtitle="مرجع للكاشير عند البيع"
        actions={
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={upload} className="hidden" />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 ml-1" /> رفع Excel</Button>
            <Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> إضافة منتج</Button>
          </div>
        }
      />
      <DataTable
        loading={loading} rows={rows}
        columns={[
          { key: "product_name", header: "اسم المنتج", render: (r: any) => <span className="font-semibold">{r.product_name}</span> },
          { key: "market_price", header: "سعر السوق", render: (r: any) => <span className="text-primary font-bold">{formatEGP(r.market_price)}</span> },
          { key: "uploaded_at", header: "آخر تحديث", render: (r: any) => formatDateTime(r.uploaded_at) },
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>إضافة منتج للقائمة</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>اسم المنتج</Label><Input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>سعر السوق</Label><Input type="number" value={form.market_price} onChange={(e) => setForm({ ...form, market_price: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={add}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
