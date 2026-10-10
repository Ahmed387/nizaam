import { cairoTodayDay, addDaysDay, monthStartDay } from "@/lib/cairoDate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { NumberedPagination } from "@/components/NumberedPagination";

const PAGE_SIZE = 50;
/** Strip PostgREST or()/ilike metacharacters from free text. */
const safeLike = (s: string) => s.replace(/[,()%*\\]/g, " ").trim();
/** Cairo-day shortcut pills; SQL date bounds are applied directly to transaction_date. */
const DATE_SHORTCUTS: { label: string; range: () => [string, string] }[] = [
  { label: "النهاردة", range: () => { const d = cairoTodayDay(); return [d, d]; } },
  { label: "امبارح", range: () => { const d = addDaysDay(cairoTodayDay(), -1); return [d, d]; } },
  { label: "آخر 7 أيام", range: () => { const d = cairoTodayDay(); return [addDaysDay(d, -6), d]; } },
  { label: "الشهر ده", range: () => { const d = cairoTodayDay(); return [monthStartDay(d), d]; } },
  { label: "الشهر اللي فات", range: () => { const d = cairoTodayDay(); return [monthStartDay(d, -1), addDaysDay(monthStartDay(d), -1)]; } },
];
import { useEffect, useState, useMemo } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useParams, useSearchParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { MetricHint } from "@/components/ui/MetricHint";
import { VouchersTable } from "@/components/VouchersTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, formatEGP, formatDateTime, resolveTreasuryOperationNumber, sanitizeOperationalDescription, treasuryCategoryLabel } from "@/lib/format";
import { TreasuryMovementDialog, TreasuryMovement } from "@/components/TreasuryMovementDialog";
import { DetailsChevron } from "@/components/DetailsChevron";
import { notifyMany, getBranchManagers, getTenantAdmins } from "@/lib/notifications";
import { PaymentMethodPicker, emptyPaymentValue, PaymentMethodValue } from "@/components/PaymentMethodPicker";
import { PAYMENT_METHOD_LABELS, PaymentMethod } from "@/lib/paymentMethods";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { ArrowLeftRight, FileSpreadsheet, CheckCircle2, XCircle, Wallet, Smartphone, CreditCard, Landmark, AlertTriangle } from "lucide-react";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { FinancialAmount } from "@/components/FinancialAmount";
import { RecordAttachments } from "@/components/RecordAttachments";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { TreasuryMetricsGrid, type PeriodTransaction, type TreasuryChannel } from "@/components/treasury/TreasuryMetricsGrid";

interface WalletBalances {
  cash_balance: number;
  vodafone_balance: number;
  instapay_balance: number;
  bank_balance: number;
  other_balance: number;
  total_balance: number;
}

export default function Treasury() {
  const { id: branchId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as "movements" | "receipts" | "payments" | "transfers" | null) ?? "movements";
  const { user, profile, branches, isAdmin, hasRole } = useAuth();
  const canTransfer = isAdmin || hasRole("branch_manager");
  const canSeeBalances = isAdmin || hasRole("branch_manager") || hasRole("viewer");

  const [rows, setRows] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [walletBalances, setWalletBalances] = useState<WalletBalances>({
    cash_balance: 0, vodafone_balance: 0, instapay_balance: 0, bank_balance: 0, other_balance: 0, total_balance: 0,
  });
  const [lowThreshold, setLowThreshold] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "income" | "expense">("all");
  const [methodFilter, setMethodFilter] = useState<"all" | PaymentMethod>("all");
  const [openTransfer, setOpenTransfer] = useState(false);
  const [openReject, setOpenReject] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [tForm, setTForm] = useState({ to: "", amount: "", reason: "" });
  const [tPayment, setTPayment] = useState<PaymentMethodValue>(emptyPaymentValue("cash"));
  const [tFeeCharged, setTFeeCharged] = useState(true);
  const [viewTransfer, setViewTransfer] = useState<any | null>(null);
  const [viewMovement, setViewMovement] = useState<TreasuryMovement | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [search, setSearch] = useState("");
  const [notesSearch, setNotesSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [periodRows, setPeriodRows] = useState<PeriodTransaction[]>([]);
  const [periodLoading, setPeriodLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setSearch(searchText.trim()), 300); return () => clearTimeout(t); }, [searchText]);
  useEffect(() => { const t = setTimeout(() => setNotesSearch(notesText.trim()), 300); return () => clearTimeout(t); }, [notesText]);
  useEffect(() => { setPage(1); }, [fromDate, toDate, search, notesSearch, minAmount, maxAmount, tab, methodFilter]);
  const resetFilters = () => {
    setFromDate(""); setToDate(""); setSearchText(""); setNotesText("");
    setMinAmount(""); setMaxAmount(""); setTab("all"); setMethodFilter("all");
  };

  /** Applies the page's filters to any treasury query (shared by table page + period totals). */
  const applyFilters = (q: any) => {
    let tq = q.eq("branch_id", branchId!);
    if (fromDate) tq = tq.gte("transaction_date", fromDate);
    if (toDate) tq = tq.lte("transaction_date", toDate);
    if (tab !== "all") tq = tq.eq("type", tab);
    if (methodFilter !== "all") tq = tq.eq("payment_method", methodFilter);
    const s = safeLike(search);
    if (s) tq = tq.or(`reference_number.ilike.%${s}%,description.ilike.%${s}%,category.ilike.%${s}%`);
    const n = safeLike(notesSearch);
    if (n) tq = tq.ilike("description", `%${n}%`);
    if (minAmount !== "" && !isNaN(Number(minAmount))) tq = tq.gte("amount", Number(minAmount));
    if (maxAmount !== "" && !isNaN(Number(maxAmount))) tq = tq.lte("amount", Number(maxAmount));
    return tq;
  };

  // Period totals need every filtered row (table is paginated) — lean columns only, refetched only when filters change.
  const loadPeriod = async () => {
    setPeriodLoading(true);
    try {
      const data = await fetchAllRows<PeriodTransaction>(() =>
        applyFilters(supabase.from("treasury").select("id,type,payment_method,amount")).order("transaction_date").order("id"));
      setPeriodRows(data);
    } finally { setPeriodLoading(false); }
  };
  useEffect(() => { if (branchId) loadPeriod(); }, [branchId, fromDate, toDate, search, notesSearch, minAmount, maxAmount, tab, methodFilter]);

  const load = async () => {
    setLoading(true);
    const tq = applyFilters(supabase.from("treasury").select("*", { count: "exact" }));
    const offset = (page - 1) * PAGE_SIZE;
    const [tr, tt, wb, br] = await Promise.all([
      tq.order("transaction_date", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1),
      fetchAllRows<any>(() => supabase.from("treasury_transfers").select("*, from_branch:branches!from_branch_id(name), to_branch:branches!to_branch_id(name)").or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`).order("created_at", { ascending: false }).order("id")).then((data) => ({ data, error: null })),
      supabase.rpc("get_branch_wallet_balances", { p_branch_id: branchId! }),
      supabase.from("branches").select("low_balance_threshold, tenant_id, name").eq("id", branchId!).maybeSingle(),
    ]);
    const movements = (tr.data ?? []) as TreasuryMovement[];
    const movementIds = movements.map((row) => row.id);
    const referenceIds = movements.map((row) => row.reference_id).filter((id): id is string => Boolean(id));
    const [{ data: vouchers }, { data: invoices }] = await Promise.all([
      movementIds.length
        ? supabase.from("vouchers").select("treasury_id,voucher_number").in("treasury_id", movementIds)
        : Promise.resolve({ data: [] as { treasury_id: string | null; voucher_number: string }[] }),
      referenceIds.length
        ? supabase.from("invoices").select("id,invoice_number").in("id", referenceIds)
        : Promise.resolve({ data: [] as { id: string; invoice_number: string }[] }),
    ]);
    const voucherByMovement = new Map((vouchers ?? []).map((voucher) => [voucher.treasury_id, voucher.voucher_number]));
    const invoiceByReference = new Map((invoices ?? []).map((invoice) => [invoice.id, invoice.invoice_number]));
    setRows(movements.map((row) => ({
      ...row,
      voucher_number: voucherByMovement.get(row.id) ?? null,
      invoice_number: row.reference_id ? invoiceByReference.get(row.reference_id) ?? null : null,
    })));
    setTotalCount(tr.count ?? 0);
    setTransfers(tt.data ?? []);
    const balances = (wb.data && wb.data[0]) ? (wb.data[0] as any) : null;
    if (balances) setWalletBalances(balances);
    const threshold = Number((br.data as any)?.low_balance_threshold ?? 0);
    setLowThreshold(threshold);
    setLoading(false);
    // Low balance alert + once-per-day notification
    if (balances && threshold > 0 && Number(balances.total_balance) < threshold) {
      const key = `low_balance_notified_${branchId}_${cairoTodayDay()}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        const brName = (br.data as any)?.name ?? "الفرع";
        const tenantId = (br.data as any)?.tenant_id;
        const [managers, admins] = await Promise.all([
          getBranchManagers(branchId!),
          tenantId ? getTenantAdmins(tenantId) : Promise.resolve([] as string[]),
        ]);
        const recipients = Array.from(new Set([...(managers ?? []), ...(admins ?? [])]));
        if (recipients.length) {
          await notifyMany(recipients, {
            title: "⚠️ تنبيه: رصيد الخزينة منخفض",
            body: `${brName} — الرصيد الحالي ${formatEGP(Number(balances.total_balance))} أقل من الحد ${formatEGP(threshold)}`,
            type: "general",
            link: `/branch/${branchId}/treasury`,
            relatedEntity: "treasury_low_balance",
          });
        }
      }
    }
  };
  useEffect(() => { load(); }, [branchId, fromDate, toDate, search, notesSearch, minAmount, maxAmount, tab, methodFilter, page]);
  useRealtimeRefresh(["vouchers", "treasury", "treasury_transfers"], () => { load(); loadPeriod(); });

  const filtered = rows;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));


  const transfer = async () => {
    if (!tForm.to || !tForm.amount) return toast.error("املأ البيانات");
    const amt = Number(tForm.amount);
    if (amt <= 0) return toast.error("المبلغ لازم يكون أكبر من صفر");
    const tErr = (await import("@/lib/paymentMethods")).validateTransferPayment(tPayment);
    if (tErr) return toast.error(tErr);
    // also add transfer_from_account if set
    (tPayment as any).transfer_from_account = tPayment.transfer_from_account ?? null;

    const walletKey = `${tPayment.method}_balance` as keyof WalletBalances;
    const available = walletBalances[walletKey];
    if (available < amt + tPayment.fee_amount) {
      return toast.error(`رصيد وعاء ${PAYMENT_METHOD_LABELS[tPayment.method]} غير كافٍ — المتاح: ${formatEGP(available)}`);
    }

    const { error } = await supabase.rpc("transfer_treasury_atomic", {
      p_from_branch: branchId!,
      p_to_branch: tForm.to,
      p_amount: amt,
      p_reason: tForm.reason || null,
      p_payment_method: tPayment.method,
      p_fee_amount: tPayment.fee_amount,
      p_reference_number: tPayment.reference_number || null,
      p_transfer_to_account: tPayment.transfer_to_account || null,
      p_fee_actually_charged: tPayment.fee_amount > 0 ? tFeeCharged : true,
    } as any);
    if (error) return toast.error(error.message);

    const toBr = branches.find((b) => b.id === tForm.to);
    const recipients = await getBranchManagers(tForm.to);
    await notifyMany(recipients, {
      title: "💰 طلب استلام تحويل خزنة",
      body: `${formatEGP(amt)} عبر ${PAYMENT_METHOD_LABELS[tPayment.method]}${tPayment.reference_number ? ` — رقم: ${tPayment.reference_number}` : ""}`,
      type: "general",
      link: `/branch/${tForm.to}/treasury`,
      relatedEntity: "treasury_transfer",
    });

    toast.success(`تم تحويل ${formatEGP(amt)} لـ ${toBr?.name ?? "الفرع"}`);
    setOpenTransfer(false);
    setTForm({ to: "", amount: "", reason: "" });
    setTPayment(emptyPaymentValue("cash"));
    setTFeeCharged(true);
    load();
  };


  const acknowledge = async (t: any) => {
    const { error } = await supabase.rpc("acknowledge_treasury_transfer", { p_transfer_id: t.id });
    if (error) return toast.error(error.message);
    toast.success("تم تأكيد الاستلام"); load();
  };

  const reject = async () => {
    if (!openReject) return;
    if (!rejectReason.trim()) return toast.error("اكتب سبب الرفض");
    const { error } = await supabase.rpc("reject_treasury_transfer", {
      p_transfer_id: openReject.id, p_reason: rejectReason,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("تم رفض التحويل وإرجاع المبلغ للمرسِل");
    setOpenReject(null); setRejectReason(""); load();
  };

  const otherBranches = branches.filter((b) => b.id !== branchId);
  const canAck = isAdmin || hasRole("branch_manager");
  const transferAttCounts = useAttachmentCounts("treasury_transfer", useMemo(() => transfers.map((t: any) => t.id), [transfers]));

  const wallets = [
    { key: "cash_balance" as const, label: "كاش في الدرج", icon: Wallet, color: "text-success", method: "cash" as const },
    { key: "vodafone_balance" as const, label: "فودافون كاش", icon: Smartphone, color: "text-rose-500", method: "vodafone" as const },
    { key: "instapay_balance" as const, label: "انستاباي", icon: CreditCard, color: "text-violet-500", method: "instapay" as const },
    { key: "bank_balance" as const, label: "حساب بنكي", icon: Landmark, color: "text-blue-500", method: "bank" as const },
    // وسائل الدفع المخصّصة — من غيرها مجموع المحافظ ما كانش بيساوي إجمالي الخزنة
    ...(Number(walletBalances.other_balance ?? 0) !== 0
      ? [{ key: "other_balance" as const, label: "وسائل أخرى", icon: Wallet, color: "text-amber-500", method: "other" as const }]
      : []),
  ];
  const channels = useMemo<TreasuryChannel[]>(() => [
    { method: "cash", label: "حركة الكاش (الدرج)", icon: Wallet, color: "text-success" },
    { method: "vodafone", label: "حركة فودافون كاش", icon: Smartphone, color: "text-destructive" },
    { method: "instapay", label: "حركة انستاباي", icon: CreditCard, color: "text-primary" },
    { method: "bank", label: "حركة الحساب البنكي", icon: Landmark, color: "text-primary" },
    ...(periodRows.some((r) => !["cash", "vodafone", "instapay", "bank"].includes(String(r.payment_method)))
      ? [{ method: "other", label: "وسائل أخرى", icon: Wallet, color: "text-warning" }] : []),
  ], [periodRows]);

  // تحويلات واردة لسه محصلش عليها تأكيد استلام — الفلوس دي مش مضافة للرصيد
  const pendingIncoming = useMemo(
    () => transfers.filter((t: any) => t.to_branch_id === branchId && !t.acknowledged_at && !t.rejected_at),
    [transfers, branchId]
  );
  const pendingIncomingTotal = pendingIncoming.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);



  const [exporting, setExporting] = useState(false);
  const exportLedger = async () => {
    if (!branchId) return;
    setExporting(true);
    try {
      const all = await fetchAllRows<any>(() => supabase.from("treasury")
        .select("id,type,category,amount,description,reference_id,reference_number,payment_method,transaction_date")
        .eq("branch_id", branchId).order("transaction_date", { ascending: true }).order("id"));
      const ids = all.map((r) => r.id);
      const refIds = [...new Set(all.map((r) => r.reference_id).filter(Boolean))] as string[];
      const chunk = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
      const vMap = new Map<string, any>(); const iMap = new Map<string, any>();
      for (const c of chunk(ids)) {
        const { data } = await supabase.from("vouchers").select("treasury_id,voucher_number,party_name").in("treasury_id", c);
        (data ?? []).forEach((v: any) => vMap.set(v.treasury_id, v));
      }
      for (const c of chunk(refIds)) {
        const { data } = await supabase.from("invoices").select("id,invoice_number,contact:contacts!invoices_contact_id_fkey(name)").in("id", c);
        (data ?? []).forEach((v: any) => iMap.set(v.id, v));
      }
      const header = ["م", "تاريخ السند / الحركة", "رقم السند / العملية", "نوع الحركة", "التصنيف", "الجهة / المستلم", "البيان / الملاحظات", "الوعاء المالي", "وارد (+)", "منصرف (-)", "الرصيد التراكمي"];
      const aoa: any[][] = [header];
      all.forEach((r, i) => {
        const v = vMap.get(r.id); const inv = r.reference_id ? iMap.get(r.reference_id) : null;
        const amt = Number(r.amount ?? 0); const isIn = r.type === "income";
        aoa.push([i + 1, formatDate(r.transaction_date),
          resolveTreasuryOperationNumber(v?.voucher_number, inv?.invoice_number, r.reference_number),
          isIn ? "وارد" : "منصرف", treasuryCategoryLabel(r.category),
          v?.party_name || inv?.contact?.name || "—", sanitizeOperationalDescription(r.description) || "—",
          PAYMENT_METHOD_LABELS[(r.payment_method ?? "cash") as PaymentMethod] ?? r.payment_method,
          isIn ? amt : 0, isIn ? 0 : amt, 0]);
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const n = all.length; const last = n + 1;
      for (let row = 2; row <= last; row++) {
        ws[`K${row}`] = { t: "n", f: row === 2 ? `I2-J2` : `K${row - 1}+I${row}-J${row}` };
      }
      const s = last + 2;
      XLSX.utils.sheet_add_aoa(ws, [
        ["", "إجمالي المقبوضات (الوارد)"], ["", "إجمالي المصروفات (المنصرف)"], ["", "صافي رصيد الخزينة"],
      ], { origin: `A${s}` });
      ws[`C${s}`] = { t: "n", f: n ? `SUM(I2:I${last})` : "0" };
      ws[`C${s + 1}`] = { t: "n", f: n ? `SUM(J2:J${last})` : "0" };
      ws[`C${s + 2}`] = { t: "n", f: `C${s}-C${s + 1}` };
      ws["!ref"] = `A1:K${s + 2}`;
      ws["!cols"] = [6, 18, 16, 10, 20, 24, 40, 14, 14, 14, 16].map((wch) => ({ wch }));
      ws["!views"] = [{ RTL: true }] as any;
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] } as any;
      XLSX.utils.book_append_sheet(wb, ws, "كشف الخزينة");
      XLSX.writeFile(wb, `كشف-خزينة-الفرع-${cairoTodayDay()}.xlsx`);
      toast.success(`تم تصدير ${n} حركة`);
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر التصدير");
    } finally { setExporting(false); }
  };

  return (
    <BranchLayout>
      <PageHeader title="الخزينة" subtitle="عرض فقط — كل الحركات تتم عبر سندات القبض والصرف"
        actions={
          <div className="flex gap-2">
            {canSeeBalances && (
              <Button variant="outline" onClick={exportLedger} disabled={exporting}>
                <FileSpreadsheet className="w-4 h-4 ml-1" /> {exporting ? "جارٍ التصدير..." : "تصدير كشف الخزينة Excel"}
              </Button>
            )}
            {canTransfer && otherBranches.length > 0 && (
              <Button className="btn-gradient" onClick={() => setOpenTransfer(true)}>
                <ArrowLeftRight className="w-4 h-4 ml-1" /> تحويل لفرع
              </Button>
            )}
          </div>
        }
      />

      {canSeeBalances ? (
        <TreasuryMetricsGrid
          cumulativeBalance={Number(walletBalances.total_balance)}
          periodRows={periodRows}
          channels={channels}
          loading={periodLoading}
          lowThresholdAlert={lowThreshold > 0 && walletBalances.total_balance < lowThreshold ? (
            <div className="mt-4 flex items-center justify-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive border border-destructive/30">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-semibold">تنبيه: الرصيد أقل من الحد المسموح ({formatEGP(lowThreshold)})</span>
            </div>
          ) : null}
        />
      ) : (
        <div className="card-elevated p-6 mb-6 text-center text-muted-foreground">
          أرصدة الخزينة غير متاحة لدورك. يمكنك تسجيل الحركات فقط.
        </div>
      )}

      {pendingIncoming.length > 0 && (
        <div className="card-elevated p-4 mb-6 border border-warning/40 bg-warning/5">
          <div className="flex items-center gap-2 text-warning font-bold mb-1">
            <AlertTriangle className="w-5 h-5" />
            فيه {pendingIncoming.length} تحويل وارد لسه محتاج تأكيد استلام
          </div>
          <div className="text-sm text-muted-foreground">
            إجمالي <span className="font-bold text-foreground">{formatEGP(pendingIncomingTotal)}</span> —
            الفلوس دي <span className="font-bold">لسه مش مضافة لرصيد الخزنة</span>، هتتضاف أول ما تأكد الاستلام من تبويب «تحويلات بين الفروع».
          </div>
        </div>
      )}


      <Tabs value={initialTab} onValueChange={(v) => setSearchParams((p) => { p.set("tab", v); return p; }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="movements">حركات الخزنة</TabsTrigger>
          <TabsTrigger value="receipts">سندات القبض</TabsTrigger>
          <TabsTrigger value="payments">سندات الصرف</TabsTrigger>
          <TabsTrigger value="transfers">تحويلات بين الفروع ({transfers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="receipts" className="mt-4">
          <VouchersTable branchId={branchId} type="receipt" />
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <VouchersTable branchId={branchId} type="payment" />
        </TabsContent>



        <TabsContent value="movements" className="mt-4">
          <div className="card-elevated p-4 mb-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm">
                فلاتر حركات الخزينة{" "}
                <span className="text-muted-foreground font-normal">
                  (يعرض {totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} - {Math.min(page * PAGE_SIZE, totalCount)} من أصل {totalCount} حركة)
                </span>
              </h3>
              <Button size="sm" variant="ghost" onClick={resetFilters}>مسح الفلاتر</Button>
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className="text-muted-foreground">اختصارات:</span>
              {DATE_SHORTCUTS.map((s) => (
                <Button key={s.label} size="sm" variant="outline" className="h-7 rounded-full" onClick={() => { const [f, t] = s.range(); setFromDate(f); setToDate(t); }}>
                  {s.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div><Label className="text-xs">بحث (رقم العملية / البيان / التصنيف...)</Label>
                <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">من تاريخ</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">إلى تاريخ</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 h-9" /></div>

              <div><Label className="text-xs">النوع</Label>
                <Select value={tab} onValueChange={(v) => setTab(v as any)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="income">دخول</SelectItem>
                    <SelectItem value="expense">خروج</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><Label className="text-xs">بحث الملاحظات</Label>
                <Input value={notesText} onChange={(e) => setNotesText(e.target.value)} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">المبلغ من</Label>
                <Input type="number" min={0} placeholder="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="mt-1 h-9" /></div>

              <div><Label className="text-xs">الوعاء / طريقة الدفع</Label>
                <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v as any)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأوعية</SelectItem>
                    {(["cash","vodafone","instapay","bank"] as PaymentMethod[]).map((m) => (
                      <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <div><Label className="text-xs">المبلغ إلى</Label>
                <Input type="number" min={0} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="mt-1 h-9" /></div>
            </div>
          </div>

          <TooltipProvider delayDuration={200}>
          <DataTable loading={loading} rows={filtered} indexColumn={{ offset: (page - 1) * PAGE_SIZE }} tableClassName="max-lg:min-w-[1100px]"
            columns={[
              { key: "details", header: "تفاصيل", align: "center", width: "5rem", render: (r: any) => (
                <DetailsChevron label="عرض تفاصيل الحركة" onClick={() => setViewMovement(r as TreasuryMovement)} />
              )},
              { key: "transaction_date", header: "تاريخ السند / الحركة", align: "center", width: "10rem", render: (r: any) => formatDate(r.transaction_date) },
              { key: "type", header: "النوع", align: "center", width: "7rem", render: (r: any) => (
                <span className={`px-2 py-1 rounded text-xs font-bold ${r.type === "income" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                  {r.type === "income" ? "💚 دخول" : "🔴 خروج"}
                </span>
              )},
              { key: "payment_method", header: "الوعاء", align: "center", width: "8rem", render: (r: any) => (
                <span className="text-xs px-2 py-0.5 rounded bg-muted">{PAYMENT_METHOD_LABELS[(r.payment_method ?? "cash") as PaymentMethod]}</span>
              )},
              { key: "category", header: "التصنيف", align: "center", width: "9rem", render: (r: any) => (
                <span>{treasuryCategoryLabel(r.category)}{r.is_fee ? <span className="ml-1 text-warning text-xs">(عمولة)</span> : null}</span>
              )},
              { key: "description", header: "الملاحظات / البيان", align: "right", width: "18rem", className: "whitespace-normal break-words leading-6", render: (r: any) => {
                const text = sanitizeOperationalDescription(r.description);
                return text ? (
                  <span dir="rtl" className="unicode-isolate block w-full whitespace-normal break-words text-right">{text}</span>
                ) : "—";
              }},
              { key: "reference_number", header: "رقم العملية", align: "center", width: "10rem", render: (r: any) => (
                <Badge variant="secondary" dir="ltr" className="unicode-isolate max-w-full rounded-md font-mono text-xs font-bold">
                  {resolveTreasuryOperationNumber(r.voucher_number, r.invoice_number, r.reference_number)}
                </Badge>
              )},
              { key: "amount", header: "المبلغ", align: "center", width: "10rem", numeric: true, render: (r: any) => (
                <span dir="ltr" className={`unicode-isolate inline-block font-bold ${r.type === "income" ? "text-success" : "text-destructive"}`}>
                  {r.type === "income" ? "+" : "−"} {formatEGP(r.amount)}
                </span>
              )},
            ]} />
          </TooltipProvider>
          {pageCount > 1 && (
            <div className="mt-4 flex justify-center">
              <NumberedPagination page={page} pageCount={pageCount} onChange={setPage} disabled={loading} />
            </div>
          )}


        </TabsContent>

        <TabsContent value="transfers" className="mt-4">
          <DataTable loading={loading} rows={transfers} indexColumn
            onRowClick={(r: any) => setViewTransfer(r)}
            columns={[
              { key: "details", header: "تفاصيل", align: "center", width: "5rem", render: (r: any) => (
                <DetailsChevron label="عرض تفاصيل التحويل" onClick={() => setViewTransfer(r)} />
              )},
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
              { key: "direction", header: "الاتجاه", render: (r: any) => (
                r.from_branch_id === branchId
                  ? <span className="text-destructive font-bold">↗ صادر</span>
                  : <span className="text-success font-bold">↘ وارد</span>
              )},
              { key: "from", header: "من", render: (r: any) => r.from_branch?.name ?? "—" },
              { key: "to", header: "إلى", render: (r: any) => r.to_branch?.name ?? "—" },
              { key: "amount", header: "المبلغ", render: (r: any) => <span className="font-bold">{formatEGP(r.amount)}</span> },
              { key: "method", header: "طريقة الدفع", render: (r: any) => (
                <span className="text-xs">{PAYMENT_METHOD_LABELS[(r.payment_method ?? "cash") as PaymentMethod]}</span>
              )},
              { key: "fee", header: "عمولة", render: (r: any) => Number(r.fee_amount) > 0 ? <span className="text-warning text-xs">{formatEGP(r.fee_amount)}</span> : "—" },
              { key: "ref", header: "رقم العملية", render: (r: any) => r.reference_number ?? "—" },
              { key: "reason", header: "السبب", render: (r: any) => r.reason ?? "—" },
              { key: "ack", header: "الحالة", render: (r: any) => (
                r.rejected_at
                  ? <span className="text-xs px-2 py-1 rounded bg-destructive/15 text-destructive font-bold">✗ مرفوض</span>
                  : r.acknowledged_at
                  ? <span className="text-xs px-2 py-1 rounded bg-success/15 text-success font-bold">✓ مؤكد {formatDateTime(r.acknowledged_at)}</span>
                  : r.to_branch_id === branchId && canAck
                    ? (
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" onClick={() => acknowledge(r)}><CheckCircle2 className="w-3.5 h-3.5 ml-1" /> تأكيد</Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpenReject(r)}><XCircle className="w-3.5 h-3.5 ml-1" /> رفض</Button>
                      </div>
                    )
                    : <span className="text-xs px-2 py-1 rounded bg-warning/15 text-warning">بانتظار التأكيد</span>
              )},
              { key: "actions", header: "الإجراءات", render: (r: any) => (
                <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                  <AttachmentsDialogButton recordType="treasury_transfer" recordId={r.id} count={transferAttCounts[r.id] ?? 0} />
                </div>
              )},
            ]} />
        </TabsContent>
      </Tabs>

      <Dialog open={openTransfer} onOpenChange={setOpenTransfer}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تحويل لفرع آخر</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border-r-4 border-primary bg-primary/5 p-3 text-sm leading-7">
              بتحوّل من <b>خزنة {branches.find((b) => b.id === branchId)?.name ?? "الفرع الحالي"}</b> (وعاء{" "}
              <b>{PAYMENT_METHOD_LABELS[tPayment.method]}</b>
              {canSeeBalances && <> — المتاح: <b className="tabular-nums">{formatEGP(walletBalances[`${tPayment.method}_balance` as keyof WalletBalances])}</b></>})
              {" "}لفرع <b>{branches.find((b) => b.id === tForm.to)?.name ?? "— اختر الفرع —"}</b>.
              <div className="text-xs text-muted-foreground mt-1">
                الفلوس بتتخصم من خزنتك على طول، ومش بتدخل خزنة الفرع التاني غير لما يأكّد الاستلام.
              </div>
            </div>
            {canSeeBalances && (
              <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-0.5">
                <div>الإجمالي الكلي في خزنتك: <span className="font-bold">{formatEGP(walletBalances.total_balance)}</span></div>
              </div>
            )}

            <div>
              <Label>الفرع المستهدف *</Label>
              <select className="w-full bg-input border border-border rounded-lg p-2 mt-1.5" value={tForm.to} onChange={(e) => setTForm({...tForm, to: e.target.value})}>
                <option value="">— اختر —</option>
                {otherBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div><Label>المبلغ *</Label><Input type="number" value={tForm.amount} onChange={(e) => setTForm({...tForm, amount: e.target.value})} className="mt-1.5" /></div>
            <div><Label>السبب</Label><Textarea value={tForm.reason} onChange={(e) => setTForm({...tForm, reason: e.target.value})} className="mt-1.5" rows={2} /></div>
            <PaymentMethodPicker amount={Number(tForm.amount) || 0} value={tPayment} onChange={setTPayment} label="طريقة التنفيذ" />
            {tPayment.fee_amount > 0 && (
              <div className="rounded-lg border border-border p-3 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium">هل اتخصمت العمولة فعلاً؟ ({formatEGP(tPayment.fee_amount)})</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {tFeeCharged
                        ? "العمولة هتفضل كمصروف لو الفرع التاني رفض"
                        : "العمولة هترجع للخزنة لو الفرع التاني رفض"}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                    <input type="checkbox" checked={tFeeCharged} onChange={(e) => setTFeeCharged(e.target.checked)} className="w-4 h-4" />
                    <span className="text-xs">اتخصمت</span>
                  </label>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTransfer(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={transfer}>تحويل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={!!openReject} onOpenChange={(v) => !v && setOpenReject(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-destructive">رفض التحويل</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              المبلغ {openReject && formatEGP(openReject.amount)} سيُعاد لخزينة المرسِل. العمولة (إن وُجدت) لا تُسترد.
            </p>
            <div>
              <Label>سبب الرفض *</Label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-1.5" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenReject(null); setRejectReason(""); }}>إلغاء</Button>
            <Button variant="destructive" onClick={reject}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewTransfer} onOpenChange={(o) => !o && setViewTransfer(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              تحويل خزنة — {formatEGP(Number(viewTransfer?.amount ?? 0))}
            </DialogTitle>
          </DialogHeader>
          {viewTransfer && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 bg-surface-2 rounded-lg p-3">
                <div><span className="text-muted-foreground">من:</span> <b>{viewTransfer.from_branch?.name ?? "—"}</b></div>
                <div><span className="text-muted-foreground">إلى:</span> <b>{viewTransfer.to_branch?.name ?? "—"}</b></div>
                <div><span className="text-muted-foreground">التاريخ:</span> {formatDateTime(viewTransfer.created_at)}</div>
                <div><span className="text-muted-foreground">طريقة الدفع:</span> {PAYMENT_METHOD_LABELS[(viewTransfer.payment_method ?? "cash") as PaymentMethod]}</div>
                {Number(viewTransfer.fee_amount) > 0 && (
                  <div><span className="text-muted-foreground">العمولة:</span> <span className="text-warning">{formatEGP(viewTransfer.fee_amount)}</span></div>
                )}
                {viewTransfer.reference_number && (
                  <div><span className="text-muted-foreground">رقم العملية:</span> {viewTransfer.reference_number}</div>
                )}
                {viewTransfer.reason && (
                  <div className="col-span-2"><span className="text-muted-foreground">السبب:</span> {viewTransfer.reason}</div>
                )}
                <div className="col-span-2">
                  <span className="text-muted-foreground">الحالة:</span>{" "}
                  {viewTransfer.rejected_at ? (
                    <span className="text-destructive font-bold">مرفوض</span>
                  ) : viewTransfer.acknowledged_at ? (
                    <span className="text-success font-bold">مؤكد — {formatDateTime(viewTransfer.acknowledged_at)}</span>
                  ) : (
                    <span className="text-warning font-bold">بانتظار التأكيد</span>
                  )}
                </div>
              </div>
              <RecordAttachments recordType="treasury_transfer" recordId={viewTransfer.id} />
            </div>
          )}
        </DialogContent>
      </Dialog>
      <TreasuryMovementDialog
        movement={viewMovement}
        open={!!viewMovement}
        onOpenChange={(o) => { if (!o) setViewMovement(null); }}
        branchName={branches.find((b) => b.id === branchId)?.name}
      />


    </BranchLayout>
  );
}
