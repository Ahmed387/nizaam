import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Banknote, Boxes, Users, Save, Scale, Search, ShieldAlert } from "lucide-react";

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Branch = { id: string; name: string; code: string };
type Contact = { id: string; name: string; type: string; phone: string | null };
type Product = { id: string; name: string; sku: string; branch_id: string; cost_price: number; quantity: number };

export default function OpeningBalances() {
  const { tenantId, isOwner, isAdmin } = useAuth() as any;
  const allowed = Boolean(isOwner || isAdmin);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [openingDate, setOpeningDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [cash, setCash] = useState<Record<string, string>>({});
  const [contactBal, setContactBal] = useState<Record<string, string>>({});
  const [inv, setInv] = useState<Record<string, { quantity: string; cost_price: string }>>({});
  const [postedAt, setPostedAt] = useState<string | null>(null);

  const [contactSearch, setContactSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [b, c, p, snap] = await Promise.all([
      supabase.from("branches" as any).select("id,name,code").eq("tenant_id", tenantId).order("code"),
      supabase.from("contacts" as any).select("id,name,type,phone").eq("tenant_id", tenantId).order("name"),
      supabase.from("products" as any).select("id,name,sku,branch_id,cost_price,quantity")
        .eq("tenant_id", tenantId).is("archived_at", null).order("name"),
      supabase.rpc("get_opening_balances" as any),
    ]);
    setBranches((b.data as any) ?? []);
    setContacts((c.data as any) ?? []);
    setProducts((p.data as any) ?? []);

    const s: any = snap.data ?? {};
    setPostedAt(s.posted_at ?? null);
    if (s.opening_date) setOpeningDate(String(s.opening_date).slice(0, 10));
    const cashMap: Record<string, string> = {};
    (s.cash ?? []).forEach((r: any) => { if (r.branch_id) cashMap[r.branch_id] = String(r.amount ?? ""); });
    setCash(cashMap);
    const cMap: Record<string, string> = {};
    (s.contacts ?? []).forEach((r: any) => { cMap[r.contact_id] = String(r.amount ?? ""); });
    setContactBal(cMap);
    const iMap: Record<string, { quantity: string; cost_price: string }> = {};
    (s.inventory ?? []).forEach((r: any) => {
      iMap[r.product_id] = { quantity: String(r.quantity ?? ""), cost_price: String(r.cost_price ?? "") };
    });
    setInv(iMap);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  const cashTotal = useMemo(
    () => Object.values(cash).reduce((s, v) => s + (Number(v) || 0), 0), [cash]);
  const arTotal = useMemo(
    () => Object.values(contactBal).reduce((s, v) => (Number(v) || 0) > 0 ? s + Number(v) : s, 0), [contactBal]);
  const apTotal = useMemo(
    () => Object.values(contactBal).reduce((s, v) => (Number(v) || 0) < 0 ? s - Number(v) : s, 0), [contactBal]);
  const invTotal = useMemo(
    () => Object.values(inv).reduce((s, v) => s + (Number(v.quantity) || 0) * (Number(v.cost_price) || 0), 0), [inv]);

  const equityTotal = cashTotal + arTotal + invTotal - apTotal;

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q));
  }, [contacts, contactSearch]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, productSearch]);

  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? "—";

  const submit = async () => {
    setSaving(true);
    try {
      const payloadCash = Object.entries(cash)
        .filter(([, v]) => Number(v) !== 0 && v !== "")
        .map(([branch_id, v]) => ({ branch_id, amount: Number(v) }));
      const payloadContacts = Object.entries(contactBal)
        .filter(([, v]) => Number(v) !== 0 && v !== "")
        .map(([contact_id, v]) => ({ contact_id, amount: Number(v) }));
      const payloadInv = Object.entries(inv)
        .filter(([, v]) => Number(v.quantity) > 0)
        .map(([product_id, v]) => ({
          product_id,
          quantity: Number(v.quantity),
          cost_price: Number(v.cost_price) || 0,
        }));

      const { data, error } = await supabase.rpc("post_opening_balances" as any, {
        p_date: openingDate,
        p_cash: payloadCash,
        p_contacts: payloadContacts,
        p_inventory: payloadInv,
      });
      if (error) throw error;
      const r: any = data ?? {};
      toast.success(`تم ترحيل الأرصدة الافتتاحية — ${r.entries ?? 0} قيد`, {
        description: `نقدية ${fmt(r.cash_total)} • عملاء ${fmt(r.receivables_total)} • موردين ${fmt(r.payables_total)} • مخزون ${fmt(r.inventory_total)}`,
      });
      setConfirmOpen(false);
      await load();
    } catch (e: any) {
      toast.error("فشل الترحيل", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) {
    return (
      <AdminLayout>
        <PageHeader title="الأرصدة الافتتاحية" />
        <Card className="border-destructive/40">
          <CardContent className="p-8 text-center space-y-2">
            <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
            <p className="font-semibold">هذه الشاشة متاحة للمالك أو المدير فقط.</p>
          </CardContent>
        </Card>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <PageHeader
        title="الأرصدة الافتتاحية"
        subtitle="إدخال أرصدة بداية التشغيل: نقدية الخزن، أرصدة العملاء والموردين، وكميات وتكلفة المخزون — وترحيلها تلقائيًا لقيود اليومية."
      />

      <div className="grid gap-4 md:grid-cols-5 mb-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">النقدية</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{fmt(cashTotal)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">مديونية العملاء</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{fmt(arTotal)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">مستحقات الموردين</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{fmt(apTotal)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">قيمة المخزون</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{fmt(invTotal)}</CardContent>
        </Card>
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Scale className="h-4 w-4" /> صافي حقوق الملكية
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-primary">{fmt(equityTotal)}</CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>تاريخ بداية التشغيل</Label>
            <Input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="w-48" />
          </div>
          {postedAt && (
            <Badge variant="secondary" className="mb-2">
              آخر ترحيل: {new Date(postedAt).toLocaleString("ar-EG")}
            </Badge>
          )}
          <div className="ms-auto">
            <Button onClick={() => setConfirmOpen(true)} disabled={saving || loading} size="lg">
              <Save className="h-4 w-4 me-2" /> ترحيل الأرصدة الافتتاحية
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="cash">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="cash" className="gap-2"><Banknote className="h-4 w-4" /> نقدية الخزن</TabsTrigger>
          <TabsTrigger value="contacts" className="gap-2"><Users className="h-4 w-4" /> العملاء والموردين</TabsTrigger>
          <TabsTrigger value="inventory" className="gap-2"><Boxes className="h-4 w-4" /> المخزون</TabsTrigger>
        </TabsList>

        <TabsContent value="cash">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفرع</TableHead>
                    <TableHead>الكود</TableHead>
                    <TableHead className="w-56">النقدية الافتتاحية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="text-muted-foreground">{b.code}</TableCell>
                      <TableCell>
                        <Input
                          type="number" step="0.01" inputMode="decimal" placeholder="0.00"
                          value={cash[b.id] ?? ""}
                          onChange={e => setCash(s => ({ ...s, [b.id]: e.target.value }))}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardHeader className="pb-3">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="ps-9" placeholder="ابحث بالاسم أو الهاتف..." value={contactSearch}
                  onChange={e => setContactSearch(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                القيمة الموجبة = العميل مدين لنا. القيمة السالبة = نحن مدينون للمورد.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الهاتف</TableHead>
                    <TableHead className="w-56">الرصيد الافتتاحي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContacts.map(c => {
                    const v = Number(contactBal[c.id]) || 0;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {c.type === "customer" ? "عميل" : c.type === "supplier" ? "مورد" : "عميل ومورد"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                        <TableCell>
                          <Input
                            type="number" step="0.01" inputMode="decimal" placeholder="0.00"
                            className={v > 0 ? "border-primary/50" : v < 0 ? "border-destructive/50" : ""}
                            value={contactBal[c.id] ?? ""}
                            onChange={e => setContactBal(s => ({ ...s, [c.id]: e.target.value }))}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory">
          <Card>
            <CardHeader className="pb-3">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="ps-9" placeholder="ابحث بالاسم أو الكود..." value={productSearch}
                  onChange={e => setProductSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصنف</TableHead>
                    <TableHead>الكود</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead className="w-32">الكمية</TableHead>
                    <TableHead className="w-40">تكلفة الوحدة</TableHead>
                    <TableHead className="w-32 text-end">الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map(p => {
                    const row = inv[p.id] ?? { quantity: "", cost_price: "" };
                    const total = (Number(row.quantity) || 0) * (Number(row.cost_price) || 0);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-muted-foreground">{p.sku}</TableCell>
                        <TableCell className="text-muted-foreground">{branchName(p.branch_id)}</TableCell>
                        <TableCell>
                          <Input
                            type="number" step="1" inputMode="numeric" placeholder="0"
                            value={row.quantity}
                            onChange={e => setInv(s => ({ ...s, [p.id]: { ...row, quantity: e.target.value } }))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number" step="0.01" inputMode="decimal"
                            placeholder={String(p.cost_price ?? 0)}
                            value={row.cost_price}
                            onChange={e => setInv(s => ({ ...s, [p.id]: { ...row, cost_price: e.target.value } }))}
                          />
                        </TableCell>
                        <TableCell className="text-end font-semibold">{fmt(total)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد ترحيل الأرصدة الافتتاحية</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-start">
                <p>سيتم إنشاء قيود افتتاحية بتاريخ <strong>{openingDate}</strong>، وإلغاء أي ترحيل افتتاحي سابق.</p>
                <ul className="text-sm space-y-1">
                  <li>نقدية الخزن: <strong>{fmt(cashTotal)}</strong></li>
                  <li>مديونية العملاء: <strong>{fmt(arTotal)}</strong></li>
                  <li>مستحقات الموردين: <strong>{fmt(apTotal)}</strong></li>
                  <li>قيمة المخزون: <strong>{fmt(invTotal)}</strong></li>
                  <li>صافي حقوق الملكية: <strong>{fmt(equityTotal)}</strong></li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); submit(); }} disabled={saving}>
              {saving ? "جارٍ الترحيل..." : "تأكيد الترحيل"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
