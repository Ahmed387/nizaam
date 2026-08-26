import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Loader2, DatabaseBackup, PlayCircle, Clock, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { formatDateTime } from "@/lib/format";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const TABLES: { key: string; label: string }[] = [
  { key: "branches", label: "الفروع" },
  { key: "categories", label: "التصنيفات" },
  { key: "products", label: "المنتجات" },
  { key: "product_batches", label: "دفعات المنتجات" },
  { key: "brands", label: "الماركات" },
  { key: "product_types", label: "أنواع المنتجات" },
  { key: "colors", label: "الألوان" },
  { key: "capacities", label: "السعات" },
  { key: "sizes", label: "المقاسات" },
  { key: "price_list_sources", label: "موردين قائمة الأسعار" },
  { key: "price_list_items", label: "أصناف قائمة الأسعار" },
  { key: "contacts", label: "العملاء والموردين" },
  { key: "customer_credit_log", label: "سجل رصيد العملاء" },
  { key: "employees", label: "الموظفين" },
  { key: "invoices", label: "الفواتير" },
  { key: "invoice_items", label: "أصناف الفواتير" },
  { key: "invoice_payments", label: "مدفوعات الفواتير" },
  { key: "quotes", label: "عروض الأسعار" },
  { key: "quote_items", label: "أصناف عروض الأسعار" },
  { key: "returns", label: "المرتجعات" },
  { key: "return_items", label: "أصناف المرتجعات" },
  { key: "purchase_returns", label: "مرتجعات المشتريات" },
  { key: "purchase_return_items", label: "أصناف مرتجعات المشتريات" },
  { key: "shipments", label: "الشحنات" },
  { key: "shipment_items", label: "أصناف الشحنات" },
  { key: "supplier_payments", label: "مدفوعات الموردين" },
  { key: "stock_transfers", label: "تحويلات المخزون" },
  { key: "stock_adjustments", label: "تسويات المخزون" },
  { key: "stock_adjustment_items", label: "أصناف تسويات المخزون" },
  { key: "inventory_sessions", label: "جلسات الجرد" },
  { key: "inventory_session_items", label: "أصناف الجرد" },
  { key: "inventory_adjustments", label: "تعديلات المخزون" },
  { key: "inventory_reservations", label: "حجوزات المخزون" },
  { key: "pre_orders", label: "طلبات الحجز" },
  { key: "pre_order_transactions", label: "حركات طلبات الحجز" },
  { key: "payment_plans", label: "خطط السداد" },
  { key: "payment_installments", label: "الأقساط" },
  { key: "payment_transactions", label: "حركات السداد" },
  { key: "treasury", label: "حركات الخزينة" },
  { key: "treasury_transfers", label: "تحويلات الخزينة" },
  { key: "cashier_shifts", label: "ورديات الكاشير" },
  { key: "vouchers", label: "السندات المالية" },
  { key: "voucher_categories", label: "تصنيفات السندات" },
  { key: "expenses", label: "المصروفات" },
  { key: "bank_accounts", label: "الحسابات البنكية" },
  { key: "chart_of_accounts", label: "شجرة الحسابات" },
  { key: "journal_entries", label: "قيود اليومية" },
  { key: "journal_entry_lines", label: "بنود قيود اليومية" },
  { key: "fixed_assets", label: "الأصول الثابتة" },
  { key: "depreciation_entries", label: "قيود الإهلاك" },
  { key: "equity_partners", label: "الشركاء" },
  { key: "partner_transactions", label: "حركات الشركاء" },
  { key: "partner_share_history", label: "سجل حصص الشركاء" },
  { key: "partner_advances", label: "سلف الشركاء" },
  { key: "profit_distributions", label: "توزيعات الأرباح" },
  { key: "profit_distribution_lines", label: "بنود توزيعات الأرباح" },
  { key: "branch_capital_allocations", label: "رأس مال الفروع" },
  { key: "fiscal_periods", label: "الفترات المالية" },
  { key: "budgets", label: "الموازنات" },
  { key: "advances", label: "السلف" },
  { key: "advance_payments", label: "أقساط السلف" },
  { key: "advance_requests", label: "طلبات السلف" },
  { key: "salaries", label: "الرواتب" },
  { key: "attendance", label: "الحضور" },
  { key: "branch_schedules", label: "مواعيد الفروع" },
  { key: "branch_closures", label: "إجازات الفروع" },
  { key: "approval_requests", label: "طلبات الاعتماد" },
  { key: "discount_approval_requests", label: "طلبات اعتماد الخصم" },
  { key: "price_audit_log", label: "سجل تعديل الأسعار" },
  { key: "settings", label: "الإعدادات" },
  { key: "audit_log", label: "سجل العمليات" },
];

const num = (v: any) => Number(v ?? 0);
const fmtDate = (v: any) => (v ? new Date(v).toLocaleString("ar-EG") : "");
const attrs = (r: any) =>
  [r?.brand, r?.model, r?.color, r?.product_type, r?.capacity, r?.size].filter(Boolean).join(" • ");

export function BackupTab() {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [runningServer, setRunningServer] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = async () => {
    const { data } = await supabase
      .from("system_backups" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory(data ?? []);
  };
  useEffect(() => { loadHistory(); }, []);
  useRealtimeRefresh(["system_backups"], loadHistory);

  const runScheduledNow = async () => {
    setRunningServer(true);
    try {
      const { error } = await supabase.functions.invoke("scheduled-backup", { body: {} });
      const bErr = await edgeErrorMessage(error);
      if (bErr) throw new Error(bErr);
      toast.success("تم تشغيل النسخ الاحتياطي — قد يستغرق دقيقة");
      setTimeout(loadHistory, 3000);
    } catch (e: any) {
      toast.error(e.message ?? "فشل التشغيل");
    } finally {
      setRunningServer(false);
    }
  };

  const downloadBackup = async (row: any) => {
    if (!row.storage_path) return toast.error("لا يوجد ملف");
    const { data, error } = await supabase.storage.from("system-backups").createSignedUrl(row.storage_path, 300);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const deleteBackup = async (row: any) => {
    setDeletingId(row.id);
    try {
      if (row.storage_path) {
        const { error: sErr } = await supabase.storage.from("system-backups").remove([row.storage_path]);
        if (sErr) console.warn("storage delete:", sErr.message);
      }
      const { error } = await supabase.from("system_backups" as any).delete().eq("id", row.id);
      if (error) throw error;
      toast.success("تم حذف النسخة");
      setHistory((h) => h.filter((x) => x.id !== row.id));
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحذف");
    } finally {
      setDeletingId(null);
    }
  };

  const fetchTable = async (key: string) => {
    let from = 0;
    const pageSize = 1000;
    const rows: any[] = [];
    while (true) {
      const { data, error } = await supabase.from(key as any).select("*").range(from, from + pageSize - 1);
      if (error) {
        console.warn(`Failed ${key}:`, error.message);
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  };

  const exportAll = async (format: "xlsx" | "json") => {
    setExporting(true);
    try {
      const all: Record<string, any[]> = {};
      let i = 0;
      for (const t of TABLES) {
        i++;
        setProgress(`(${i}/${TABLES.length}) تحميل ${t.label}...`);
        all[t.key] = await fetchTable(t.key);
      }

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

      if (format === "json") {
        setProgress("جاري بناء ملف JSON...");
        const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), data: all }, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nizam-backup-${stamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("تم تصدير النسخة الاحتياطية");
        return;
      }

      setProgress("جاري بناء التقارير التفصيلية...");

      // ---------- lookup maps ----------
      const map = (rows: any[], k = "id") => {
        const m: Record<string, any> = {};
        for (const r of rows ?? []) m[r[k]] = r;
        return m;
      };
      const branches = map(all.branches);
      const contacts = map(all.contacts);
      const products = map(all.products);
      const categories = map(all.categories);
      const employees = map(all.employees);
      const invoices = map(all.invoices);
      const branchName = (id: any) => branches[id]?.name ?? "";

      // payments/returns aggregated per invoice
      const paidByInvoice: Record<string, number> = {};
      for (const p of all.invoice_payments ?? []) {
        if (p.voided_at) continue;
        paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] ?? 0) + num(p.amount);
      }
      const refundByInvoice: Record<string, number> = {};
      for (const r of all.returns ?? []) {
        refundByInvoice[r.invoice_id] = (refundByInvoice[r.invoice_id] ?? 0) + num(r.total_refund);
      }
      const itemsByInvoice: Record<string, any[]> = {};
      for (const it of all.invoice_items ?? []) {
        (itemsByInvoice[it.invoice_id] ||= []).push(it);
      }

      const sheets: { name: string; rows: any[] }[] = [];

      // ---------- 1. نظرة عامة ----------
      const totalSales = (all.invoices ?? []).filter((x) => x.status !== "cancelled").reduce((s, x) => s + num(x.total), 0);
      const totalPaid = Object.values(paidByInvoice).reduce((s: number, v: any) => s + num(v), 0);
      const totalRefund = (all.returns ?? []).reduce((s, x) => s + num(x.total_refund), 0);
      const stockValue = (all.products ?? [])
        .filter((p) => !p.archived_at)
        .reduce((s, p) => s + num(p.quantity) * num(p.cost_price), 0);
      const overview: any[] = [
        { "البند": "تاريخ التصدير", "القيمة": fmtDate(new Date()) },
        { "البند": "عدد الفروع", "القيمة": (all.branches ?? []).length },
        { "البند": "عدد المنتجات", "القيمة": (all.products ?? []).length },
        { "البند": "عدد العملاء/الموردين", "القيمة": (all.contacts ?? []).length },
        { "البند": "عدد الموظفين", "القيمة": (all.employees ?? []).length },
        { "البند": "عدد الفواتير", "القيمة": (all.invoices ?? []).length },
        { "البند": "إجمالي المبيعات", "القيمة": totalSales },
        { "البند": "إجمالي المحصّل", "القيمة": totalPaid },
        { "البند": "إجمالي المرتجعات", "القيمة": totalRefund },
        { "البند": "المتبقي على العملاء", "القيمة": totalSales - totalPaid - totalRefund },
        { "البند": "قيمة المخزون بالتكلفة", "القيمة": stockValue },
        { "البند": "", "القيمة": "" },
        { "البند": "— عدد صفوف كل جدول —", "القيمة": "" },
        ...TABLES.map((t) => ({ "البند": t.label, "القيمة": (all[t.key] ?? []).length })),
      ];
      sheets.push({ name: "نظرة عامة", rows: overview });

      // ---------- 2. ملخص الفروع ----------
      sheets.push({
        name: "ملخص الفروع",
        rows: (all.branches ?? []).map((b) => {
          const inv = (all.invoices ?? []).filter((x) => x.branch_id === b.id && x.status !== "cancelled");
          const sales = inv.reduce((s, x) => s + num(x.total), 0);
          const paid = inv.reduce((s, x) => s + num(paidByInvoice[x.id]), 0);
          const refunds = (all.returns ?? []).filter((r) => r.branch_id === b.id).reduce((s, r) => s + num(r.total_refund), 0);
          const cashIn = (all.treasury ?? []).filter((t) => t.branch_id === b.id && t.type === "in").reduce((s, t) => s + num(t.amount), 0);
          const cashOut = (all.treasury ?? []).filter((t) => t.branch_id === b.id && t.type === "out").reduce((s, t) => s + num(t.amount), 0);
          const prods = (all.products ?? []).filter((p) => p.branch_id === b.id && !p.archived_at);
          return {
            "الكود": b.code,
            "الفرع": b.name,
            "العنوان": b.address,
            "التليفون": b.phone,
            "نشط": b.is_active ? "نعم" : "لا",
            "عدد الفواتير": inv.length,
            "إجمالي المبيعات": sales,
            "المحصّل": paid,
            "المتبقي": sales - paid - refunds,
            "المرتجعات": refunds,
            "وارد الخزينة": cashIn,
            "منصرف الخزينة": cashOut,
            "رصيد الخزينة": cashIn - cashOut,
            "عدد الأصناف": prods.length,
            "قيمة المخزون (تكلفة)": prods.reduce((s, p) => s + num(p.quantity) * num(p.cost_price), 0),
            "عدد الموظفين": (all.employees ?? []).filter((e) => e.branch_id === b.id && e.is_active).length,
          };
        }),
      });

      // ---------- 3. الفواتير تفصيلي ----------
      sheets.push({
        name: "الفواتير (تفصيلي)",
        rows: (all.invoices ?? []).map((v) => {
          const items = itemsByInvoice[v.id] ?? [];
          const cost = items.reduce((s, it) => s + num(it.unit_cost_at_sale ?? it.cost_price) * num(it.quantity), 0);
          const paid = num(paidByInvoice[v.id]);
          const ct = contacts[v.contact_id];
          return {
            "رقم الفاتورة": v.invoice_number,
            "التاريخ": fmtDate(v.invoice_date ?? v.created_at),
            "الفرع": branchName(v.branch_id),
            "العميل": ct?.name ?? "",
            "تليفون العميل": ct?.phone ?? "",
            "الكاشير": employees[v.cashier_id]?.name ?? v.cashier_id ?? "",
            "عدد الأصناف": items.length,
            "إجمالي الكمية": items.reduce((s, it) => s + num(it.quantity), 0),
            "الإجمالي قبل الخصم": num(v.subtotal),
            "الخصم": num(v.discount_amount),
            "نسبة الخصم %": num(v.discount_percent),
            "سبب الخصم": v.discount_reason ?? "",
            "ضريبة": num(v.vat_amount),
            "الصافي": num(v.total),
            "المدفوع": paid,
            "المتبقي": num(v.total) - paid,
            "المرتجع": num(refundByInvoice[v.id]),
            "طريقة الدفع": v.payment_method,
            "الحالة": v.status,
            "التكلفة": cost,
            "الربح": num(v.total) - cost,
            "ملاحظات": v.notes ?? "",
            "سبب الإلغاء": v.cancel_reason ?? "",
            "رصيد سابق": num(v.previous_balance),
            "رصيد حالي": num(v.current_balance),
          };
        }),
      });

      // ---------- 4. أصناف الفواتير تفصيلي ----------
      sheets.push({
        name: "أصناف الفواتير (تفصيلي)",
        rows: (all.invoice_items ?? []).map((it) => {
          const v = invoices[it.invoice_id] ?? {};
          const p = products[it.product_id] ?? {};
          const unitCost = num(it.unit_cost_at_sale ?? it.cost_price);
          return {
            "رقم الفاتورة": v.invoice_number ?? "",
            "التاريخ": fmtDate(v.invoice_date ?? v.created_at),
            "الفرع": branchName(v.branch_id),
            "العميل": contacts[v.contact_id]?.name ?? "",
            "المنتج": it.product_name ?? p.name ?? "",
            "الكود SKU": p.sku ?? "",
            "التصنيف": categories[p.category_id]?.name ?? "",
            "الماركة": it.brand ?? p.brand ?? "",
            "الموديل": it.model ?? p.model ?? "",
            "اللون": it.color ?? p.color ?? "",
            "النوع": it.product_type ?? p.product_type ?? "",
            "السعة": it.capacity ?? p.capacity ?? "",
            "المقاس": it.size ?? p.size ?? "",
            "الكمية": num(it.quantity),
            "المرتجع": num(it.returned_quantity),
            "الصافي": num(it.net_quantity ?? num(it.quantity) - num(it.returned_quantity)),
            "سعر القطعة قبل الخصم": num(it.original_price ?? it.selling_price),
            "خصم السطر": num(it.line_discount),
            "نسبة خصم %": num(it.discount_percent),
            "سعر البيع النهائي": num(it.final_price ?? it.selling_price),
            "إجمالي السطر": num(it.total),
            "تكلفة القطعة": unitCost,
            "إجمالي التكلفة": unitCost * num(it.quantity),
            "ربح السطر": num(it.total) - unitCost * num(it.quantity),
            "سعر السوق": num(it.market_price),
            "حالة الفاتورة": v.status ?? "",
          };
        }),
      });

      // ---------- 5. المدفوعات ----------
      sheets.push({
        name: "المدفوعات (تفصيلي)",
        rows: (all.invoice_payments ?? []).map((p) => {
          const v = invoices[p.invoice_id] ?? {};
          return {
            "التاريخ": fmtDate(p.created_at),
            "رقم الفاتورة": v.invoice_number ?? "",
            "الفرع": branchName(p.branch_id ?? v.branch_id),
            "العميل": contacts[v.contact_id]?.name ?? "",
            "المبلغ": num(p.amount),
            "طريقة الدفع": p.payment_method,
            "رسوم": num(p.fee_amount),
            "الرسوم على العميل": p.fee_on_customer ? "نعم" : "لا",
            "رقم المرجع": p.reference_number ?? "",
            "تحويل من": p.transfer_from_account ?? "",
            "تحويل إلى": p.transfer_to_account ?? "",
            "المستلم": p.received_by_name ?? "",
            "ملغي": p.voided_at ? "نعم" : "لا",
            "سبب الإلغاء": p.void_reason ?? "",
          };
        }),
      });

      // ---------- 6. المخزون تفصيلي ----------
      sheets.push({
        name: "المخزون (تفصيلي)",
        rows: (all.products ?? []).map((p) => {
          const sold = (all.invoice_items ?? [])
            .filter((it) => it.product_id === p.id)
            .reduce((s, it) => s + num(it.net_quantity ?? it.quantity), 0);
          return {
            "المنتج": p.name,
            "الكود SKU": p.sku ?? "",
            "الفرع": branchName(p.branch_id),
            "التصنيف": categories[p.category_id]?.name ?? "",
            "الماركة": p.brand ?? "",
            "الموديل": p.model ?? "",
            "اللون": p.color ?? "",
            "النوع": p.product_type ?? "",
            "السعة": p.capacity ?? "",
            "المقاس": p.size ?? "",
            "الخصائص": attrs(p),
            "الكمية الحالية": num(p.quantity),
            "حد الطلب": num(p.min_stock_level ?? p.low_stock_alert),
            "سعر التكلفة": num(p.cost_price),
            "سعر البيع": num(p.selling_price),
            "سعر السوق": num(p.market_price),
            "قيمة المخزون (تكلفة)": num(p.quantity) * num(p.cost_price),
            "قيمة المخزون (بيع)": num(p.quantity) * num(p.selling_price),
            "هامش الربح للقطعة": num(p.selling_price) - num(p.cost_price),
            "إجمالي المباع": sold,
            "مؤرشف": p.archived_at ? "نعم" : "لا",
            "تاريخ الإضافة": fmtDate(p.created_at),
          };
        }),
      });

      // ---------- 7. المرتجعات ----------
      const returnsMap = map(all.returns);
      sheets.push({
        name: "المرتجعات (تفصيلي)",
        rows: (all.return_items ?? []).map((ri) => {
          const r = returnsMap[ri.return_id] ?? {};
          const v = invoices[r.invoice_id] ?? {};
          const p = products[ri.product_id] ?? {};
          return {
            "رقم المرتجع": r.return_number ?? "",
            "التاريخ": fmtDate(r.created_at),
            "رقم الفاتورة": v.invoice_number ?? "",
            "الفرع": branchName(r.branch_id),
            "العميل": contacts[v.contact_id]?.name ?? "",
            "المنتج": p.name ?? "",
            "الخصائص": attrs({ ...p, ...ri }),
            "الكمية": num(ri.quantity),
            "قيمة الاسترجاع": num(ri.refund),
            "إجمالي المرتجع": num(r.total_refund),
            "طريقة الاسترجاع": r.refund_method ?? "",
            "الحالة": r.status ?? "",
            "السبب": r.reason ?? "",
          };
        }),
      });

      // ---------- 8. الخزينة ----------
      sheets.push({
        name: "الخزينة (تفصيلي)",
        rows: (all.treasury ?? []).map((t) => ({
          "التاريخ": fmtDate(t.created_at),
          "الفرع": branchName(t.branch_id),
          "النوع": t.type === "in" ? "وارد" : "منصرف",
          "التصنيف": t.category ?? "",
          "المبلغ": num(t.amount),
          "طريقة الدفع": t.payment_method ?? "",
          "رقم المرجع": t.reference_number ?? "",
          "تحويل من": t.transfer_from_account ?? "",
          "تحويل إلى": t.transfer_to_account ?? "",
          "رسوم": t.is_fee ? "نعم" : "لا",
          "البيان": t.description ?? "",
        })),
      });

      // ---------- 9. الأقساط ----------
      const plans = map(all.payment_plans);
      sheets.push({
        name: "الأقساط (تفصيلي)",
        rows: (all.payment_installments ?? []).map((ins) => {
          const pl = plans[ins.payment_plan_id] ?? {};
          const v = invoices[pl.invoice_id] ?? {};
          return {
            "رقم الفاتورة": v.invoice_number ?? "",
            "الفرع": branchName(v.branch_id ?? pl.branch_id),
            "العميل": contacts[v.contact_id ?? pl.contact_id]?.name ?? "",
            "رقم القسط": ins.installment_number,
            "تاريخ الاستحقاق": ins.due_date,
            "المبلغ": num(ins.amount),
            "المدفوع": num(ins.paid_amount),
            "المتبقي": num(ins.amount) - num(ins.paid_amount),
            "الحالة": ins.status,
            "تاريخ السداد": fmtDate(ins.paid_at),
            "ملاحظات": ins.notes ?? "",
          };
        }),
      });

      // ---------- 10. العملاء ----------
      sheets.push({
        name: "العملاء (تفصيلي)",
        rows: (all.contacts ?? []).map((c) => {
          const inv = (all.invoices ?? []).filter((v) => v.contact_id === c.id && v.status !== "cancelled");
          const sales = inv.reduce((s, v) => s + num(v.total), 0);
          const paid = inv.reduce((s, v) => s + num(paidByInvoice[v.id]), 0);
          return {
            "الاسم": c.name,
            "النوع": c.type,
            "التليفون": c.phone ?? "",
            "الفرع": branchName(c.branch_id),
            "العنوان": c.address ?? "",
            "عدد الفواتير": inv.length,
            "إجمالي التعامل": sales,
            "المدفوع": paid,
            "المتبقي": sales - paid,
            "رصيد دائن": num(c.credit_balance),
            "رصيد افتتاحي": num(c.opening_balance),
            "أول تعامل": fmtDate(c.created_at),
            "ملاحظات": c.notes ?? "",
          };
        }),
      });

      // ---------- 11. الموظفين ----------
      sheets.push({
        name: "الموظفين (تفصيلي)",
        rows: (all.employees ?? []).map((e) => ({
          "الاسم": e.name,
          "الوظيفة": e.job_title ?? "",
          "الدور": e.role ?? "",
          "الفرع": branchName(e.branch_id),
          "التليفون": e.phone ?? "",
          "الإيميل": e.email ?? "",
          "المرتب الأساسي": num(e.base_salary),
          "تاريخ التعيين": e.hire_date ?? "",
          "نشط": e.is_active ? "نعم" : "لا",
          "له حساب دخول": e.has_system_access ? "نعم" : "لا",
        })),
      });

      // ---------- build workbook ----------
      setProgress("جاري بناء ملف Excel...");
      const wb = XLSX.utils.book_new();
      const usedNames = new Set<string>();
      const addSheet = (name: string, rows: any[]) => {
        let safe = name.slice(0, 31).replace(/[:\\/?*[\]]/g, " ");
        let n = 1;
        while (usedNames.has(safe)) safe = `${name.slice(0, 28)}_${++n}`;
        usedNames.add(safe);
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "لا توجد بيانات": "" }]);
        const keys = Object.keys(rows[0] ?? { "لا توجد بيانات": "" });
        ws["!cols"] = keys.map((k) => ({
          wch: Math.min(40, Math.max(12, k.length + 4)),
        }));
        ws["!autofilter"] = { ref: ws["!ref"] as string };
        ws["!freeze"] = { xSplit: "0", ySplit: "1" } as any;
        XLSX.utils.book_append_sheet(wb, ws, safe);
      };

      for (const s of sheets) addSheet(s.name, s.rows);
      for (const t of TABLES) addSheet(`خام-${t.label}`, all[t.key] ?? []);

      XLSX.writeFile(wb, `nizam-full-export-${stamp}.xlsx`);
      toast.success(`تم التصدير: ${sheets.length} تقرير تفصيلي + ${TABLES.length} جدول خام`);
    } catch (e: any) {
      toast.error(e.message ?? "خطأ في التصدير");
    } finally {
      setExporting(false);
      setProgress("");
    }
  };

  return (
    <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-start gap-3">
        <DatabaseBackup className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <div>
          <h2 className="font-bold">نسخة احتياطية شاملة لكل بيانات الشركة</h2>
          <p className="text-sm text-muted-foreground mt-1">
            ملف Excel فيه تقارير تفصيلية جاهزة للتدقيق (فواتير، أصناف، مدفوعات، مخزون، خزينة، أقساط، عملاء، موظفين)
            بالإضافة لكل الجداول الخام لكل الفروع.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button onClick={() => exportAll("xlsx")} disabled={exporting} className="gap-2" size="lg">
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          تصدير Excel تفصيلي
        </Button>
        <Button onClick={() => exportAll("json")} disabled={exporting} variant="outline" className="gap-2" size="lg">
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          تصدير JSON (للمطورين)
        </Button>
      </div>

      {progress && <p className="text-sm text-muted-foreground text-center">{progress}</p>}

      <div className="text-xs text-muted-foreground bg-surface-2 p-3 rounded">
        <b>محتوى ملف الإكسيل:</b>
        <ul className="list-disc pr-5 mt-1 space-y-1">
          <li>نظرة عامة + ملخص لكل فرع (مبيعات، محصّل، متبقي، خزينة، مخزون).</li>
          <li>الفواتير سطر بسطر مع التكلفة والربح، وأصناف الفواتير بكل الخصائص (ماركة/موديل/لون/سعة/مقاس).</li>
          <li>المدفوعات، المرتجعات، الخزينة، الأقساط، العملاء، الموظفين — كلها تفصيلية.</li>
          <li>وكمان {TABLES.length} جدول خام (شيت لكل جدول) للتدقيق الكامل.</li>
        </ul>
      </div>

      {/* Scheduled (server-side) backups */}
      <div className="border-t pt-4 mt-2 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold flex items-center gap-2"><Clock className="w-4 h-4" /> النسخ التلقائية المجدولة</h3>
            <p className="text-xs text-muted-foreground mt-1">
              تعمل تلقائياً كل جمعة 3:00 صباحاً وتخزّن على السيرفر (آخر 12 نسخة).
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={runScheduledNow} disabled={runningServer} className="gap-2">
            {runningServer ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            تشغيل الآن
          </Button>
        </div>

        {history.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">لا توجد نسخ بعد — اضغط "تشغيل الآن" لأول نسخة.</div>
        ) : (
          <div className="border rounded divide-y">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {h.status === "success"
                    ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    : <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                  <div className="min-w-0">
                    <div className="truncate font-medium">{h.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(h.created_at)} • {(Number(h.size_bytes) / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {h.status === "success" && (
                    <Button size="sm" variant="ghost" onClick={() => downloadBackup(h)} className="gap-1">
                      <Download className="w-3 h-3" /> تنزيل
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="gap-1 text-destructive hover:text-destructive" disabled={deletingId === h.id}>
                        {deletingId === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        حذف
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>حذف النسخة الاحتياطية؟</AlertDialogTitle>
                        <AlertDialogDescription>
                          هيتم حذف الملف «{h.filename}» نهائياً من السيرفر ومش هينفع ترجعه.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>إلغاء</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteBackup(h)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          حذف نهائي
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
