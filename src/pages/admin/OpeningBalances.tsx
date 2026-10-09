import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchGlReconciliation, previewOpeningMatch, applyOpeningMatch, type GlReconciliation, type OpeningMatchPreview } from "@/lib/ledger";
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
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Banknote, Boxes, Users, Save, Scale, Search, ShieldAlert } from "lucide-react";
import { useBranchScope } from "@/lib/branchScope";
import { FinancialAmount } from "@/components/FinancialAmount";

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

  const { filterBranches } = useBranchScope();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [openingDate, setOpeningDate] = useState("2026-01-01");
  const [cash, setCash] = useState<Record<string, string>>({});
  const [contactBal, setContactBal] = useState<Record<string, string>>({});
  const [inv, setInv] = useState<Record<string, { quantity: string; cost_price: string }>>({});
  const [postedAt, setPostedAt] = useState<string | null>(null);
  const [invLocked, setInvLocked] = useState(false);
  const [mainTreasury, setMainTreasury] = useState<{ id: string; name: string } | null>(null);

  const [contactSearch, setContactSearch] = useState("");
  const [sp] = useSearchParams();
  // the books vs the ledger for the opening balances of contacts (G2 / G7 of the integrity check)
  const [glOpen, setGlOpen] = useState<GlReconciliation["opening"] | null>(null);
  const [postingContacts, setPostingContacts] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [b, c, p, snap] = await Promise.all([
      supabase.from("branches" as any).select("id,name,code").eq("tenant_id", tenantId).order("code"),
      fetchAllRows<any>(() => supabase.from("contacts" as any).select("id,name,type,phone").eq("tenant_id", tenantId).eq("is_archived", false).order("name").order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("products" as any).select("id,name,sku,branch_id,cost_price,quantity")
        .eq("tenant_id", tenantId).is("archived_at", null).order("name").order("id")).then((data) => ({ data })),
      supabase.rpc("get_opening_balances" as any),
    ]);
    setBranches(filterBranches(((b.data as any) ?? []) as any) as any);
    setContacts((c.data as any) ?? []);
    setProducts((p.data as any) ?? []);

    const s: any = snap.data ?? {};
    setPostedAt(s.posted_at ?? null);
    setInvLocked(!!s.inventory_locked);
    setMainTreasury(s.main_treasury ?? null);
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
    fetchGlReconciliation().then((g) => setGlOpen(g.opening)).catch(() => setGlOpen(null));
    setLoading(false);
  };

  // contacts' opening balances vs the books on 1 Jan 2026 (G2 / G7): one entry for the difference only —
  // the full opening when 2025 is not in the books, nothing when they already agree (never counted twice)
  const [matchPreview, setMatchPreview] = useState<OpeningMatchPreview | null>(null);
  const previewMatch = async () => {
    setPostingContacts(true);
    try { setMatchPreview(await previewOpeningMatch()); }
    catch (e: any) { toast.error("تعذر حساب الفرق", { description: e.message }); }
    finally { setPostingContacts(false); }
  };
  const applyMatch = async () => {
    setPostingContacts(true);
    try {
      const r = await applyOpeningMatch();
      toast.success("اتطابقت القيود مع الدفتر الموحد", { description: `${r.entry_id ? "اتسجل قيد مطابقة بتاريخ 2026-01-01" : "مفيش فرق يتسجل"}${r.reversed ? ` • اتعكس ${r.reversed} قيد مطابقة سابق` : ""}` });
      setMatchPreview(null);
      await load();
    } catch (e: any) {
      toast.error("فشلت المطابقة", { description: e.message });
    } finally {
      setPostingContacts(false);
    }
  };
  const openingMismatch = glOpen
    ? Object.keys(glOpen.ledger ?? {}).some((k) => Math.abs((glOpen.ledger?.[k] ?? 0) - (glOpen.journal?.[k] ?? 0)) > 0.005)
    : false;

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  const cashTotal = useMemo(
    () => Object.values(cash).reduce((s, v) => s + (Number(v) || 0), 0), [cash]);
  // sign: + = the contact owes us, − = we owe the contact; the side follows the contact type
  // (customer: + receivable / − customer advance; supplier: + our advance / − payable; both: + customer / − supplier)
  const typeOf = (id: string) => contacts.find((c) => c.id === id)?.type ?? "customer";
  const sideTotals = useMemo(() => {
    let ar = 0, cAdv = 0, ap = 0, sAdv = 0;
    for (const [id, raw] of Object.entries(contactBal)) {
      const v = Number(raw) || 0;
      if (!v) continue;
      const t = typeOf(id);
      if (t === "supplier") { if (v > 0) sAdv += v; else ap += -v; }
      else if (t === "customer") { if (v > 0) ar += v; else cAdv += -v; }
      else { if (v > 0) ar += v; else ap += -v; }
    }
    return { ar, cAdv, ap, sAdv };
  }, [contactBal, contacts]);
  const arTotal = sideTotals.ar;
  const apTotal = sideTotals.ap;
  const invTotal = useMemo(
    () => Object.values(inv).reduce((s, v) => s + (Number(v.quantity) || 0) * (Number(v.cost_price) || 0), 0), [inv]);

  const equityTotal = cashTotal + sideTotals.ar + sideTotals.sAdv + invTotal - sideTotals.ap - sideTotals.cAdv;

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

      // a stock opening that was already sold from cannot be re-posted: that section is left as it is
      const { data, error } = await supabase.rpc("post_opening_balances" as any, {
        p_date: openingDate,
        p_cash: payloadCash,
        p_contacts: payloadContacts,
        p_inventory: invLocked ? null : payloadInv,
      });
      if (error) throw error;
      const r: any = data ?? {};
      toast.success(`تم ترحيل الأرصدة الافتتاحية — ${r.entries ?? 0} قيد`, {
        description: `نقدية ${fmt(r.cash_total)} • عملاء ${fmt(r.receivables_total)} • مقدمات عملاء ${fmt(r.customer_advances_total)} • موردين ${fmt(r.payables_total)} • مقدمات موردين ${fmt(r.supplier_advances_total)} • مخزون ${fmt(r.inventory_total)}${r.reversed_entries ? ` • اتعكس ${r.reversed_entries} قيد سابق` : ""}`,
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

      <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-7 mb-4">
        {[
          { l: "النقدية", v: cashTotal },
          { l: "مديونية العملاء (1200)", v: sideTotals.ar },
          { l: "مقدمات العملاء (2150)", v: sideTotals.cAdv },
          { l: "مستحقات الموردين (2100)", v: sideTotals.ap },
          { l: "مقدماتنا عند الموردين (1460)", v: sideTotals.sAdv },
          { l: "قيمة المخزون", v: invTotal },
        ].map((c) => (
          <Card key={c.l}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{c.l}</CardTitle></CardHeader>
            <CardContent><FinancialAmount value={fmt(c.v)} size="md" className="justify-start" /></CardContent>
          </Card>
        ))}
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Scale className="h-4 w-4" /> صافي حقوق الملكية (3950)
            </CardTitle>
          </CardHeader>
          <CardContent><FinancialAmount value={fmt(equityTotal)} size="md" className="justify-start text-primary" /></CardContent>
        </Card>
      </div>

      <Card className="mb-4 border-primary/30 bg-primary/5">
        <CardContent className="p-4 text-sm space-y-1">
          <div>• أرصدة العملاء والموردين الافتتاحية بتتسجل على <b>{mainTreasury?.name ?? "الخزنة الرئيسية"}</b> وبتظهر في الصفحة الرئيسية وصفحة الخزائن.</div>
          <div>• حساب العميل وحساب المورد منفصلين: الرصيد بيروح للجانب حسب نوع الجهة (للجهة اللي عميل ومورد: الموجب على جانب العميل، والسالب على جانب المورد).</div>
          <div>• إعادة الترحيل مش بتمسح حاجة: القيود السابقة بتتعكس بقيود عكسية، والنقدية بتتسجل في خزنة كل فرع.</div>
          {invLocked && <div className="text-warning font-semibold">• مخزون أول المدة اتباع أو اتحول منه بالفعل، فمش هيتعاد ترحيله — أي تعديل في الكميات يبقى بتسوية مخزون.</div>}
        </CardContent>
      </Card>

      {glOpen && (
        <Card className={`mb-4 ${openingMismatch ? "border-warning/60 bg-warning/5" : "border-success/40"}`}>
          <CardContent className="p-4 space-y-3 text-sm">
            <div className="font-semibold">{openingMismatch ? "أرصدة العملاء والموردين في القيود يوم 2026-01-01 مش مطابقة للدفتر الموحد" : "✓ أرصدة العملاء والموردين في القيود يوم 2026-01-01 مطابقة للدفتر الموحد"}</div>
            <div className="text-xs text-muted-foreground">
              «القيود يوم 2026-01-01» = قيود 2025 الموجودة على السيستم + القيود الافتتاحية. لازم تساوي اللي في الدفتر (الأرصدة الافتتاحية للجهات).
              لو شغل 2025 مش على السيستم، الفرق هو الرصيد الافتتاحي كله؛ ولو موجود، الفرق بس هو اللي ناقص أو زيادة — عشان مفيش حاجة تتحسب مرتين.
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-right">الحساب</TableHead>
                <TableHead className="text-right">في الدفتر (أرصدة الجهات)</TableHead>
                <TableHead className="text-right">قيود 2025</TableHead>
                <TableHead className="text-right">قيود افتتاحية ومطابقة</TableHead>
                <TableHead className="text-right">الفرق</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {[["1200", "مديونية عملاء"], ["2150", "مقدمات عملاء"], ["2100", "مستحقات موردين"], ["1460", "مقدماتنا عند الموردين"]].map(([k, label]) => {
                  const diff = (glOpen.ledger?.[k] ?? 0) - (glOpen.journal?.[k] ?? 0);
                  return (
                    <TableRow key={k}>
                      <TableCell>{label} ({k})</TableCell>
                      <TableCell>{fmt(glOpen.ledger?.[k] ?? 0)}</TableCell>
                      <TableCell>{fmt(glOpen.books_2025?.[k] ?? 0)}</TableCell>
                      <TableCell>{fmt(glOpen.opening_entries?.[k] ?? 0)}</TableCell>
                      <TableCell className={Math.abs(diff) > 0.005 ? "text-destructive font-semibold" : "text-success"}>{Math.abs(diff) > 0.005 ? fmt(diff) : "✓"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {openingMismatch && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  الأول اتأكد إن أرصدة الجهات في تبويب «العملاء والموردين» صح (ولو فيه فواتير بتاريخ 2025 اتسجلت بعد بداية السيستم — تنبيه L7 — صحّحها الأول).
                  بعدها «طابق»: بيتسجل قيد واحد بتاريخ 2026-01-01 بالفرق بس قصاد 3950، وأي قيد مطابقة قديم بيتعكس (مفيش حذف). النقدية والمخزون مش بيتلمسوا.
                </div>
                {!matchPreview ? (
                  <Button onClick={previewMatch} disabled={postingContacts || loading} variant="outline">
                    <Scale className="h-4 w-4 me-2" /> اعرض قيد المطابقة
                  </Button>
                ) : (
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="font-medium">قيد المطابقة اللي هيتسجل (2026-01-01):</div>
                    {matchPreview.lines.length === 0 ? <div className="text-xs">مفيش فرق.</div> : (
                      <Table>
                        <TableHeader><TableRow><TableHead className="text-right">الحساب</TableHead><TableHead className="text-right">مدين</TableHead><TableHead className="text-right">دائن</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {matchPreview.lines.map((l, i) => (
                            <TableRow key={i}><TableCell>{l.account_code} — {l.description}</TableCell><TableCell>{l.debit ? fmt(l.debit) : ""}</TableCell><TableCell>{l.credit ? fmt(l.credit) : ""}</TableCell></TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    <div className="flex gap-2">
                      <Button onClick={applyMatch} disabled={postingContacts || loading}><Users className="h-4 w-4 me-2" /> طابق القيود مع الدفتر</Button>
                      <Button variant="ghost" onClick={() => setMatchPreview(null)} disabled={postingContacts}>إلغاء</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

      <Tabs defaultValue={sp.get("section") === "contacts" ? "contacts" : sp.get("section") === "inventory" ? "inventory" : "cash"}>
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
                الموجب = الجهة عليها فلوس لنا (للعميل: مديونية · للمورد: مقدم دفعناه له). السالب = إحنا علينا للجهة (للعميل: مقدم دفعه لنا · للمورد: مستحق له).
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
                <p>سيتم إنشاء قيود افتتاحية بتاريخ <strong>{openingDate}</strong>، والقيود الافتتاحية السابقة هتتعكس بقيود عكسية (مفيش حذف).</p>
                <p className="text-warning">لو شغل 2025 متسجل على السيستم، أرصدة العملاء والموردين موجودة في قيوده بالفعل — بعد الحفظ راجع كارت «مطابقة القيود مع الدفتر» فوق واضغط «طابق» عشان الفرق بس يتظبط ومفيش حاجة تتحسب مرتين.</p>
                <ul className="text-sm space-y-1">
                  <li>نقدية الخزن: <strong>{fmt(cashTotal)}</strong></li>
                  <li>مديونية العملاء: <strong>{fmt(sideTotals.ar)}</strong> · مقدمات العملاء: <strong>{fmt(sideTotals.cAdv)}</strong></li>
                  <li>مستحقات الموردين: <strong>{fmt(sideTotals.ap)}</strong> · مقدماتنا عند الموردين: <strong>{fmt(sideTotals.sAdv)}</strong></li>
                  <li>قيمة المخزون: <strong>{fmt(invTotal)}</strong>{invLocked ? " (مش هيتعاد ترحيلها)" : ""}</li>
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
