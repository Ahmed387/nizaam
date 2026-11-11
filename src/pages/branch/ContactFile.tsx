import { useCallback, useEffect, useMemo, useState } from "react";
import { ContactBalanceHeader } from "@/components/contact/ContactBalanceHeader";
import { InternalBranchTag } from "@/components/contact/InternalBranchTag";
import { SettleWithoutMoneyButton } from "@/components/contact/SettleWithoutMoneyButton";
import { MergeContactButton } from "@/components/contact/MergeContactButton";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout, AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { PaymentPlansPanel } from "@/components/PaymentPlansPanel";
import { MultiMethodPaymentDialog } from "@/components/MultiMethodPaymentDialog";
import { ContactMovements } from "@/components/contact/ContactMovements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP } from "@/lib/format";
import { logAudit } from "@/lib/roles";
import { saveContact, deleteContact } from "@/lib/contactWrites";
import { fetchContactOverview, type ContactOverview, type Side } from "@/lib/ledger";
import { toast } from "sonner";
import { ArrowRight, Building2, DollarSign, HandCoins, Pencil, Phone, MapPin, Receipt, Archive, User } from "lucide-react";

/**
 * Contact file — owner 2026-11-11 «التعامل الأول والأخير … دائن ومدين ورصيد»: ONE balance (مدين / دائن) and ONE movements
 * table (`ContactMovements`, migration 0199). No «لينا عنده / علينا له» cards, no open / closed invoices, no separate
 * statement button. Scope: all branches (company admins) or one branch. «الأقساط» shows only for an account that has an
 * instalment plan. Collect / pay, settle without money, merge, edit and archive stay in the header.
 */
export default function ContactFile() {
  const params = useParams<{ id: string; supplierId: string; contactId: string }>();
  const routeBranchId = params.id;
  const contactId = params.supplierId || params.contactId;
  const nav = useNavigate();
  const { user, profile, tenantId, branches, isAdmin, hasRole } = useAuth();
  const isAdminView = !routeBranchId;
  const Layout = isAdminView ? AdminLayout : BranchLayout;
  const backTo = isAdminView ? "/admin/contacts" : `/branch/${routeBranchId}/contacts`;

  // scope: "all" = company-wide (admins); otherwise a branch id
  const [scope, setScope] = useState<string>(isAdmin || !routeBranchId ? "all" : routeBranchId);
  const scopeBranch = scope === "all" ? null : scope;
  const [ov, setOv] = useState<ContactOverview | null>(null);
  const [ovAll, setOvAll] = useState<ContactOverview | null>(null);
  const [side, setSide] = useState<Side>("customer");
  const [loading, setLoading] = useState(true);
  const [payDir, setPayDir] = useState<null | "in" | "out">(null);
  // branch that receives / pays the money: the page's branch, the chosen scope, or picked by the user
  const [payPick, setPayPick] = useState<null | "in" | "out">(null);
  const [pickedBranch, setPickedBranch] = useState<string>("");
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [edit, setEdit] = useState({ name: "", type: "customer" as "customer" | "supplier" | "both", contact_person: "", phone: "", address: "", notes: "" });

  // «الأقساط» shows only for an account that has an instalment plan (an «open» plan is plain credit, not instalments)
  const [hasInstallments, setHasInstallments] = useState(false);
  useEffect(() => {
    if (!contactId) return;
    let alive = true;
    (supabase.from("payment_plans") as any).select("id", { count: "exact", head: true }).eq("entity_id", contactId).neq("plan_type", "open")
      .then(({ count }: any) => { if (alive) setHasInstallments((count ?? 0) > 0); });
    return () => { alive = false; };
  }, [contactId]);

  const c = ov?.contact;
  const hasCustomer = c?.type === "customer" || c?.type === "both" || Math.abs(ov?.customer?.balance ?? 0) > 0.005;
  const hasSupplier = c?.type === "supplier" || c?.type === "both" || Math.abs(ov?.supplier?.balance ?? 0) > 0.005;

  const loadOverview = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const [o, oa] = await Promise.all([
        fetchContactOverview(contactId, scopeBranch),
        scopeBranch ? fetchContactOverview(contactId, null).catch(() => null) : Promise.resolve(null),
      ]);
      setOv(o);
      setOvAll(oa);
      setSide((cur) => {
        const cOk = o.customer && (o.contact.type !== "supplier" || Math.abs(o.customer.balance) > 0.005);
        const sOk = o.supplier && (o.contact.type !== "customer" || Math.abs(o.supplier.balance) > 0.005);
        if (cur === "customer" && cOk) return cur;
        if (cur === "supplier" && sOk) return cur;
        return cOk ? "customer" : "supplier";
      });
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تحميل ملف الجهة");
    } finally {
      setLoading(false);
    }
  }, [contactId, scopeBranch]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useRealtimeRefresh(["invoices", "invoice_payments", "shipments", "supplier_payments", "returns", "purchase_returns", "vouchers", "payment_transactions", "customer_credit_log", "contacts"], loadOverview);

  useEffect(() => {
    if (c) setEdit({ name: c.name ?? "", type: c.type, contact_person: c.contact_person ?? "", phone: c.phone ?? "", address: c.address ?? "", notes: c.notes ?? "" });
  }, [c?.id]);

  const scopeName = scopeBranch ? (c?.branches?.find((b) => b.id === scopeBranch)?.name ?? branches.find((b) => b.id === scopeBranch)?.name ?? "فرع") : "كل الفروع";
  const scopeOptions = useMemo(() => {
    // admins: every branch the contact dealt with; branch staff: their own branches only
    const list = new Map<string, string>();
    if (isAdmin) (c?.branches ?? []).forEach((b) => list.set(b.id, b.name));
    else branches.forEach((b: any) => list.set(b.id, b.name));
    if (routeBranchId && !list.has(routeBranchId)) list.set(routeBranchId, branches.find((b) => b.id === routeBranchId)?.name ?? "الفرع");
    return Array.from(list.entries()).map(([id, name]) => ({ id, name }));
  }, [c?.branches, branches, isAdmin, routeBranchId]);

  const submitEdit = async () => {
    if (!edit.name) return toast.error("الاسم مطلوب");
    const { error } = await saveContact(contactId!, edit);
    if (error) return toast.error(error.message);
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", tenantId, action: "UPDATE", entity: "Contact", entityId: contactId, details: edit });
    toast.success("تم التعديل");
    setEditOpen(false);
    loadOverview();
  };
  const submitArchive = async () => {
    const { error } = await deleteContact(contactId!);
    if (error) return toast.error(error.message);
    toast.success("تمت الأرشفة — المستندات والحركات محفوظة");
    nav(backTo);
  };

  const canCollect = hasCustomer && !!ov?.customer;
  const canPay = hasSupplier && !!ov?.supplier && (isAdmin || hasRole("branch_manager") || hasRole("accountant"));
  // never guess a branch: with "all branches" the user picks which branch's till takes the money
  const fixedPayBranch = routeBranchId ?? scopeBranch ?? null;
  const payBranch = fixedPayBranch ?? (pickedBranch || null);
  const startPay = (dir: "in" | "out") => {
    if (fixedPayBranch) { setPayDir(dir); return; }
    setPickedBranch("");
    setPayPick(dir);
  };

  return (
    <Layout>
      <PageHeader
        title={c?.name ?? "ملف الجهة"}
        subtitle={c ? `${c.type === "customer" ? "عميل" : c.type === "supplier" ? "مورد" : "عميل ومورد"}${c.contact_person ? " · " + c.contact_person : ""}` : ""}
        actions={
          <div className="flex flex-wrap gap-2">
            {canCollect && branches.length > 0 && (
              <Button className="btn-gradient" onClick={() => startPay("in")}><HandCoins className="w-4 h-4 ml-1" /> تحصيل من العميل</Button>
            )}
            {canPay && branches.length > 0 && (
              <Button variant="outline" onClick={() => startPay("out")}><DollarSign className="w-4 h-4 ml-1" /> سداد للمورد</Button>
            )}
            {c && contactId && (hasCustomer || hasSupplier) && (
              <SettleWithoutMoneyButton contactId={contactId} contactName={c.name} side={side}
                sides={[...(hasCustomer ? ["customer" as const] : []), ...(hasSupplier ? ["supplier" as const] : [])]}
                defaultBranch={scopeBranch ?? routeBranchId ?? null} onDone={() => { loadOverview(); }} />
            )}
            {c && contactId && !c.is_archived && (
              <MergeContactButton contactId={contactId} contactName={c.name} branchId={c.branch_id ?? null}
                onDone={(kept) => { if (kept === contactId) { loadOverview(); } else nav(isAdminView ? `/admin/contacts/${kept}` : `/branch/${routeBranchId}/contacts/${kept}`); }} />
            )}
            {isAdmin && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 ml-1" /> تعديل</Button>}
            {isAdmin && <Button variant="outline" className="text-destructive" onClick={() => setArchiveOpen(true)}><Archive className="w-4 h-4 ml-1" /> أرشفة</Button>}
            {isAdmin && c && c.type !== "both" && (
              <Button variant="outline" onClick={async () => {
                const { error } = await saveContact(contactId!, { type: "both" });
                if (error) return toast.error(error.message);
                toast.success(c.type === "supplier" ? "تمت إضافته كعميل أيضاً" : "تمت إضافته كمورد أيضاً");
                loadOverview();
              }}><Receipt className="w-4 h-4 ml-1" /> {c.type === "supplier" ? "أيضاً عميل" : "أيضاً مورد"}</Button>
            )}
            <Button variant="outline" onClick={() => nav(backTo)}><ArrowRight className="w-4 h-4 ml-1" /> رجوع</Button>
          </div>
        }
      />

      {c && (
        <div className="card-elevated p-4 mb-4 grid md:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" /> {c.contact_person ?? "—"}</div>
          <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /> <span dir="ltr">{c.phone ?? "—"}</span></div>
          <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /> {c.address ?? "—"}</div>
          {c.notes && <div className="md:col-span-3 text-muted-foreground">📝 {c.notes}</div>}
          {c.is_archived && <div className="md:col-span-3 text-destructive font-semibold">الجهة مؤرشفة</div>}
        </div>
      )}

      {/* scope: company-wide or one branch */}
      <div className="card-elevated p-3 mb-4 flex flex-wrap items-center gap-2">
        <Building2 className="w-4 h-4 text-muted-foreground" />
        {isAdmin && (
          <Button size="sm" variant={scope === "all" ? "default" : "outline"} className="rounded-full" onClick={() => setScope("all")}>كل الفروع</Button>
        )}
        {scopeOptions.map((b) => (
          <Button key={b.id} size="sm" variant={scope === b.id ? "default" : "outline"} className="rounded-full" onClick={() => setScope(b.id)}>{b.name}</Button>
        ))}
        <span className="text-xs text-muted-foreground mr-2">
          {scopeBranch
            ? "حركات الفرع ده بس."
            : "كل الفروع = الرصيد الإجمالي للحساب."}
        </span>
      </div>

      {scopeBranch && ovAll && (() => {
        const net = Math.round(((ovAll.customer?.balance ?? 0) - (ovAll.supplier?.balance ?? 0)) * 100) / 100;
        return (
          <div className="card-elevated p-3 mb-4 text-sm flex flex-wrap gap-2">
            <span className="font-semibold">الرصيد في كل الفروع:</span>
            <b className="tabular-nums">{formatEGP(Math.abs(net))}</b>
            <span>{Math.abs(net) <= 0.005 ? "مسدد" : net > 0 ? "مدين — لنا عنده" : "دائن — علينا له"}</span>
          </div>
        );
      })()}

      {loading && !ov && <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>}

      {contactId && <InternalBranchTag contactId={contactId} />}

      {ov && (
        <ContactBalanceHeader customer={ov.customer} supplier={ov.supplier}
          scopeLabel={scopeBranch ? `فرع ${scopeOptions.find((b) => b.id === scope)?.name ?? ""}` : "كل الفروع"} />
      )}

      {ov && c && contactId && (
        <Tabs defaultValue="moves" className="w-full">
          {hasInstallments && (
            <TabsList>
              <TabsTrigger value="moves">الحركات</TabsTrigger>
              <TabsTrigger value="plans">الأقساط</TabsTrigger>
            </TabsList>
          )}
          <TabsContent value="moves" className="mt-3">
            <ContactMovements contactId={contactId} contactName={c.name} branchId={scopeBranch} scopeName={scopeName} reloadKey={ov} />
          </TabsContent>
          {hasInstallments && (
            <TabsContent value="plans" className="mt-3 space-y-4">
              {hasCustomer && <PaymentPlansPanel entityType="customer" entityId={contactId} direction="in" />}
              {hasSupplier && <PaymentPlansPanel entityType="supplier" entityId={contactId} direction="out" />}
            </TabsContent>
          )}
        </Tabs>
      )}

      {payDir && contactId && payBranch && (
        <MultiMethodPaymentDialog
          open={!!payDir}
          onOpenChange={(o) => { if (!o) setPayDir(null); }}
          mode={{ kind: "contact", contactId, branchId: payBranch }}
          defaultAmount={payDir === "in" ? Math.max(ovAll?.customer?.balance ?? ov?.customer?.balance ?? 0, 0) : Math.max(ovAll?.supplier?.balance ?? ov?.supplier?.balance ?? 0, 0)}
          direction={payDir}
          title={payDir === "in" ? `تحصيل من العميل — ${c?.name ?? ""}` : `سداد للمورد — ${c?.name ?? ""}`}
          onSuccess={() => { setPayDir(null); setPickedBranch(""); loadOverview(); }}
        />
      )}

      <Dialog open={!!payPick} onOpenChange={(o) => { if (!o) setPayPick(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{payPick === "in" ? "الفلوس هتدخل خزنة أنهي فرع؟" : "الفلوس هتطلع من خزنة أنهي فرع؟"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">الحركة بتتسجل في الفرع اللي استلم أو دفع الفلوس، وبتتخصم من أقدم مستند مفتوح لنفس الحساب في أي فرع.</p>
          <Select value={pickedBranch} onValueChange={setPickedBranch}>
            <SelectTrigger><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
            <SelectContent>
              {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button disabled={!pickedBranch} onClick={() => { const d = payPick; setPayPick(null); setPayDir(d); }}>متابعة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>تعديل بيانات الجهة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>النوع *</Label>
              <Select value={edit.type} onValueChange={(v) => setEdit({ ...edit, type: v as any })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">عميل</SelectItem>
                  <SelectItem value="supplier">مورد</SelectItem>
                  <SelectItem value="both">عميل ومورد</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>الاسم *</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>المسؤول</Label><Input value={edit.contact_person} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
            <div><Label>العنوان</Label><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} className="mt-1.5" /></div>
            <div><Label>ملاحظات</Label><Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submitEdit}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>أرشفة {c?.name}؟</AlertDialogTitle>
            <AlertDialogDescription>
              مفيش حذف نهائي: الجهة هتتأرشف وتختفي من القوائم، وكل مستنداتها وحركاتها محفوظة. الأرشفة مش مسموحة لو حساب العميل أو حساب المورد فيه رصيد مفتوح.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={submitArchive} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">أرشفة</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
