import { supabase } from "@/integrations/supabase/client";
import { ImportColumn } from "@/lib/excelImport";

/**
 * ترحيل الفواتير القديمة (داتا شركة) — بيع / شراء / مرتجع بيع / مرتجع شراء.
 * الفكرة: نعيد استخدام نفس الـ RPCs المستخدمة في الشاشات العادية عشان الأثر المحاسبي
 * والمخزني يبقى مطابق 100% للفواتير اللي بتتعمل يدوي، مع تسجيل تاريخ المستند الأصلي.
 */

export type DocKind = "sale" | "purchase" | "sale_return" | "purchase_return";

export const KIND_LABEL: Record<DocKind, string> = {
  sale: "فواتير البيع",
  purchase: "فواتير الشراء (الشحنات)",
  sale_return: "مرتجعات البيع",
  purchase_return: "مرتجعات الشراء",
};

export const MIGRATION_COLUMNS: Record<DocKind, ImportColumn[]> = {
  sale: [
    { key: "doc_no", header: "رقم الفاتورة", required: true },
    { key: "date", header: "التاريخ", required: true, type: "date" },
    { key: "customer", header: "اسم العميل" },
    { key: "phone", header: "تليفون العميل" },
    { key: "product", header: "اسم المنتج", required: true },
    { key: "qty", header: "الكمية", required: true, type: "number" },
    { key: "price", header: "سعر البيع", required: true, type: "number" },
    { key: "line_discount", header: "خصم الصنف (ج)", type: "number" },
    { key: "invoice_discount", header: "خصم إجمالي الفاتورة (ج)", type: "number" },
    { key: "paid", header: "المدفوع (ج)", type: "number" },
    { key: "notes", header: "ملاحظات" },
  ],
  purchase: [
    { key: "doc_no", header: "رقم فاتورة الشراء", required: true },
    { key: "date", header: "التاريخ", required: true, type: "date" },
    { key: "supplier", header: "اسم المورد", required: true },
    { key: "phone", header: "تليفون المورد" },
    { key: "product", header: "اسم المنتج", required: true },
    { key: "brand", header: "الماركة" },
    { key: "model", header: "الموديل" },
    { key: "qty", header: "الكمية", required: true, type: "number" },
    { key: "cost", header: "سعر التكلفة", required: true, type: "number" },
    { key: "line_discount", header: "خصم الصنف (ج)", type: "number" },
    { key: "shipping", header: "مصاريف شحن الفاتورة (ج)", type: "number" },
    { key: "notes", header: "ملاحظات" },
  ],
  sale_return: [
    { key: "doc_no", header: "رقم المرتجع", required: true },
    { key: "date", header: "التاريخ", required: true, type: "date" },
    { key: "invoice_no", header: "رقم فاتورة البيع الأصلية", required: true },
    { key: "product", header: "اسم المنتج", required: true },
    { key: "qty", header: "الكمية", required: true, type: "number" },
    { key: "unit_refund", header: "قيمة الاسترجاع للوحدة", required: true, type: "number" },
    { key: "refund_method", header: "طريقة الاسترداد (cash / balance)" },
    { key: "reason", header: "السبب" },
  ],
  purchase_return: [
    { key: "doc_no", header: "رقم المرتجع", required: true },
    { key: "date", header: "التاريخ", required: true, type: "date" },
    { key: "shipment_no", header: "رقم فاتورة الشراء الأصلية", required: true },
    { key: "product", header: "اسم المنتج", required: true },
    { key: "qty", header: "الكمية", required: true, type: "number" },
    { key: "unit_cost", header: "سعر التكلفة للوحدة", required: true, type: "number" },
    { key: "refund_method", header: "طريقة الاسترداد (cash / balance)" },
    { key: "reason", header: "السبب" },
  ],
};

export const MIGRATION_SAMPLE: Record<DocKind, Record<string, any>> = {
  sale: {
    doc_no: "OLD-1001", date: "2024-03-15", customer: "أحمد محمد", phone: "01012345678",
    product: "هاتف سامسونج A54", qty: 2, price: 11000, line_discount: 0, invoice_discount: 500, paid: 21500, notes: "",
  },
  purchase: {
    doc_no: "PO-2001", date: "2024-02-01", supplier: "شركة النور", phone: "01000111222",
    product: "هاتف سامسونج A54", brand: "سامسونج", model: "A54", qty: 10, cost: 8500, line_discount: 0, shipping: 300, notes: "",
  },
  sale_return: {
    doc_no: "RET-1", date: "2024-03-20", invoice_no: "OLD-1001", product: "هاتف سامسونج A54",
    qty: 1, unit_refund: 11000, refund_method: "cash", reason: "عيب صناعة",
  },
  purchase_return: {
    doc_no: "PRET-1", date: "2024-02-10", shipment_no: "PO-2001", product: "هاتف سامسونج A54",
    qty: 1, unit_cost: 8500, refund_method: "cash", reason: "مرتجع للمورد",
  },
};

export interface DocResult {
  doc_no: string;
  ok: boolean;
  number?: string;
  error?: string;
  lines: number;
  total: number;
}

export interface MigrationOutcome {
  results: DocResult[];
  inserted: number;
  failed: number;
}

interface RunArgs {
  kind: DocKind;
  branchId: string;
  userId: string;
  label: string;
  rows: any[];
  onProgress?: (done: number, total: number) => void;
}

const num = (v: any) => Number(v || 0) || 0;

export function groupByDoc(rows: any[]): Map<string, any[]> {
  const m = new Map<string, any[]>();
  for (const r of rows) {
    const k = String(r.doc_no ?? "").trim();
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

/* ---------------- helpers ---------------- */

async function resolveContact(
  cache: Map<string, string>,
  name: string,
  phone: string | null,
  branchId: string,
): Promise<string | null> {
  const key = name.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  const { data: found } = await supabase.from("contacts").select("id").eq("name", key).limit(1).maybeSingle();
  if (found?.id) { cache.set(key, found.id); return found.id; }
  const { data: created, error } = await supabase
    .from("contacts")
    .insert({ name: key, phone: phone || null, branch_id: branchId, is_migrated: true } as any)
    .select("id")
    .single();
  if (error) throw new Error(`تعذّر إنشاء جهة الاتصال "${key}": ${error.message}`);
  cache.set(key, created.id);
  return created.id;
}

async function findProduct(
  cache: Map<string, { id: string; cost: number } | null>,
  name: string,
  branchId: string,
) {
  const key = name.trim();
  if (cache.has(key)) return cache.get(key)!;
  const { data } = await supabase
    .from("products")
    .select("id, cost_price")
    .eq("branch_id", branchId)
    .eq("name", key)
    .limit(1)
    .maybeSingle();
  const val = data ? { id: data.id, cost: Number(data.cost_price || 0) } : null;
  cache.set(key, val);
  return val;
}

/* ---------------- importers ---------------- */

async function importSale(doc: string, rows: any[], a: RunArgs, contacts: Map<string, string>, products: Map<string, any>) {
  const head = rows[0];
  const customerId = head.customer ? await resolveContact(contacts, String(head.customer), head.phone ?? null, a.branchId) : null;

  const items: any[] = [];
  for (const r of rows) {
    const p = await findProduct(products, String(r.product), a.branchId);
    if (!p) throw new Error(`المنتج "${r.product}" غير موجود في المخزن — استورد فواتير الشراء الأول`);
    items.push({
      product_id: p.id,
      product_name: String(r.product),
      quantity: num(r.qty),
      selling_price: num(r.price),
      cost_price: p.cost,
      line_discount: num(r.line_discount),
    });
  }

  const subtotal = items.reduce((s, i) => s + i.quantity * i.selling_price, 0);
  const lineDisc = items.reduce((s, i) => s + i.line_discount, 0);
  const invDisc = num(head.invoice_discount);
  const total = Math.max(0, subtotal - lineDisc - invDisc);
  const paid = Math.min(num(head.paid), total);

  const { data: invId, error } = await supabase.rpc("process_sale", {
    p_branch_id: a.branchId,
    p_customer_id: customerId,
    p_subtotal: subtotal,
    p_discount_amount: invDisc,
    p_discount_percent: subtotal > 0 ? +((invDisc / subtotal) * 100).toFixed(2) : 0,
    p_discount_reason: invDisc > 0 ? "خصم مرحّل من الفاتورة القديمة" : null,
    p_total: total,
    p_payment_method: paid > 0 ? "cash" : "credit",
    p_items: items as any,
    p_payments: paid > 0 ? ([{ payment_method: "cash", amount: paid }] as any) : null,
    p_vat_rate: 0,
    p_vat_amount: 0,
  } as any);
  if (error) throw error;

  await supabase
    .from("invoices")
    .update({
      invoice_date: head.date,
      is_migrated: true,
      migration_source: a.label,
      notes: [head.notes, `فاتورة مرحّلة — الرقم الأصلي: ${doc}`].filter(Boolean).join(" | "),
    } as any)
    .eq("id", invId as any);

  const { data: inv } = await supabase.from("invoices").select("invoice_number").eq("id", invId as any).maybeSingle();
  return { number: (inv as any)?.invoice_number ?? String(invId), total };
}

async function importPurchase(doc: string, rows: any[], a: RunArgs, contacts: Map<string, string>, products: Map<string, any>) {
  const head = rows[0];
  const supplierId = await resolveContact(contacts, String(head.supplier), head.phone ?? null, a.branchId);
  if (!supplierId) throw new Error("اسم المورد مطلوب");

  const lines: any[] = [];
  for (const r of rows) {
    const p = await findProduct(products, String(r.product), a.branchId);
    if (!p && (!String(r.brand ?? "").trim() || !String(r.model ?? "").trim()))
      throw new Error(`المنتج "${r.product}" جديد — لازم تدخل الماركة والموديل`);
    lines.push({
      product_id: p?.id ?? null,
      product_name: String(r.product),
      quantity: num(r.qty),
      cost_price: num(r.cost),
      discount_amount: num(r.line_discount),
      discount_percent: 0,
      brand: String(r.brand ?? "").trim() || undefined,
      model: String(r.model ?? "").trim() || undefined,
    });
  }

  const total = lines.reduce((s, l) => s + l.quantity * l.cost_price - l.discount_amount, 0) + num(head.shipping);

  const { data: res, error } = await supabase.rpc("record_shipment", {
    p_header: {
      branch_id: a.branchId,
      contact_id: supplierId,
      arrival_date: head.date,
      received_by: "ترحيل بيانات",
      shipping_cost: num(head.shipping),
      customs_cost: 0,
      other_cost: 0,
      other_cost_description: null,
      admin_cost: 0,
      notes: [head.notes, `فاتورة شراء مرحّلة — الرقم الأصلي: ${doc} — دفعة: ${a.label}`].filter(Boolean).join(" | "),
    },
    p_lines: lines,
  } as any);
  if (error) throw error;

  const shipmentId = (res as any)?.shipment_id;
  products.clear(); // منتجات جديدة اتعملت جوه الـ RPC
  if (shipmentId) await supabase.from("shipments").update({ invoice_date: head.date } as any).eq("id", shipmentId);
  const { data: sh } = await supabase.from("shipments").select("shipment_number").eq("id", shipmentId).maybeSingle();
  return { number: (sh as any)?.shipment_number ?? String(shipmentId), total };
}

async function importSaleReturn(doc: string, rows: any[], a: RunArgs, products: Map<string, any>) {
  const head = rows[0];
  const { data: inv } = await supabase
    .from("invoices")
    .select("id")
    .eq("branch_id", a.branchId)
    .or(`invoice_number.eq.${head.invoice_no},notes.ilike.%${head.invoice_no}%`)
    .limit(1)
    .maybeSingle();
  if (!inv?.id) throw new Error(`فاتورة البيع "${head.invoice_no}" مش موجودة`);

  const items: any[] = [];
  let total = 0;
  for (const r of rows) {
    const p = await findProduct(products, String(r.product), a.branchId);
    if (!p) throw new Error(`المنتج "${r.product}" غير موجود`);
    const refund = num(r.qty) * num(r.unit_refund);
    total += refund;
    items.push({ product_id: p.id, quantity: num(r.qty), refund });
  }

  const method = String(head.refund_method ?? "cash").trim() === "balance" ? "balance" : "cash";
  const { data: rr, error } = await supabase.rpc("register_sale_return_full" as any, {
    _invoice_id: inv.id,
    _reason: String(head.reason ?? "مرتجع مرحّل"),
    _notes: `مرتجع مرحّل — الرقم الأصلي: ${doc} — دفعة: ${a.label}`,
    _status: "active",
    _refund_method: method,
    _refund_reference: null,
    _refund_account: null,
    _refund_cash_amount: method === "cash" ? total : 0,
    _refund_transfer_amount: 0,
    _refund_balance_amount: method === "balance" ? total : 0,
    _items: items as any,
  });
  if (error) throw error;
  const number = (rr as any)?.return_number as string;
  if (number) await supabase.from("returns").update({ invoice_date: head.date } as any).eq("return_number", number);
  return { number, total };
}

async function importPurchaseReturn(doc: string, rows: any[], a: RunArgs, products: Map<string, any>) {
  const head = rows[0];
  const { data: sh } = await supabase
    .from("shipments")
    .select("id, contact_id")
    .eq("branch_id", a.branchId)
    .or(`shipment_number.eq.${head.shipment_no},notes.ilike.%${head.shipment_no}%`)
    .limit(1)
    .maybeSingle();
  if (!sh?.id) throw new Error(`فاتورة الشراء "${head.shipment_no}" مش موجودة`);

  const items: any[] = [];
  let total = 0;
  for (const r of rows) {
    const p = await findProduct(products, String(r.product), a.branchId);
    if (!p) throw new Error(`المنتج "${r.product}" غير موجود`);
    const line = num(r.qty) * num(r.unit_cost);
    total += line;
    items.push({ product_id: p.id, product_name: String(r.product), quantity: num(r.qty), unit_cost: num(r.unit_cost), total: line });
  }

  const method = String(head.refund_method ?? "cash").trim() === "balance" ? "balance" : "cash";
  const { data: pr, error } = await supabase
    .from("purchase_returns" as any)
    .insert({
      branch_id: a.branchId,
      contact_id: (sh as any).contact_id,
      shipment_id: sh.id,
      reason: String(head.reason ?? "مرتجع مرحّل"),
      notes: `مرتجع شراء مرحّل — الرقم الأصلي: ${doc} — دفعة: ${a.label}`,
      created_by: a.userId,
      total_amount: total,
      status: "active",
      refund_method: method,
      refund_cash_amount: method === "cash" ? total : 0,
      refund_transfer_amount: 0,
      refund_balance_amount: method === "balance" ? total : 0,
      invoice_date: head.date,
    } as any)
    .select()
    .single();
  if (error || !pr) throw error ?? new Error("فشل حفظ المرتجع");

  const { error: e2 } = await supabase
    .from("purchase_return_items" as any)
    .insert(items.map((i) => ({ ...i, purchase_return_id: (pr as any).id })) as any);
  if (e2) throw e2;

  if (method === "cash" && total > 0) {
    await supabase.from("treasury").insert({
      branch_id: a.branchId,
      type: "income",
      category: "purchase_return",
      amount: total,
      description: `مرتجع شراء مرحّل ${(pr as any).return_number}`,
      reference_id: (pr as any).id,
      payment_method: "cash",
      created_by: a.userId,
    } as any);
  }
  return { number: (pr as any).return_number as string, total };
}

/* ---------------- runner ---------------- */

export async function runMigration(args: RunArgs): Promise<MigrationOutcome> {
  const groups = groupByDoc(args.rows);
  const contacts = new Map<string, string>();
  const products = new Map<string, any>();
  const results: DocResult[] = [];
  let done = 0;

  for (const [doc, rows] of groups) {
    try {
      let out: { number: string; total: number };
      if (args.kind === "sale") out = await importSale(doc, rows, args, contacts, products);
      else if (args.kind === "purchase") out = await importPurchase(doc, rows, args, contacts, products);
      else if (args.kind === "sale_return") out = await importSaleReturn(doc, rows, args, products);
      else out = await importPurchaseReturn(doc, rows, args, products);
      results.push({ doc_no: doc, ok: true, number: out.number, lines: rows.length, total: out.total });
    } catch (e: any) {
      results.push({ doc_no: doc, ok: false, error: e?.message ?? "خطأ غير متوقع", lines: rows.length, total: 0 });
    }
    done++;
    args.onProgress?.(done, groups.size);
  }

  return {
    results,
    inserted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
