import { supabase } from "@/integrations/supabase/client";
import type { LegacyDoc, LegacyKind } from "@/lib/legacySheetParser";
import { extractAttributes } from "@/lib/productAttributeExtract";
import { createPaymentPlanWithInitial } from "@/lib/paymentPlans";
import type { PaymentPlanState } from "@/components/PaymentPlanSelector";

/**
 * ترحيل مستندات النظام القديم (بصيغة البلوكات) لنظام Nizam.
 * بيستخدم نفس الـ RPCs بتاعة الشاشات العادية عشان الأثر المخزني والمحاسبي يبقى مطابق.
 */

export interface LegacyRunArgs {
  kind: LegacyKind;
  branchId: string;
  tenantId?: string | null;
  userId: string;
  label: string;
  fileName?: string;
  /** المورد الافتراضي للشراء / مرتجع الشراء */
  supplierId?: string | null;
  docs: LegacyDoc[];
  /** يتخطى المستندات اللي رقمها القديم اتسجل قبل كده */
  skipExisting?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface LegacyDocResult {
  legacyNumber: string;
  ok: boolean;
  skipped?: boolean;
  number?: string;
  error?: string;
  note?: string;
  items: number;
  total: number;
}

export interface LegacyOutcome {
  batchId: string | null;
  results: LegacyDocResult[];
  inserted: number;
  failed: number;
  skipped: number;
}

const TABLE: Record<LegacyKind, string> = {
  sale: "invoices",
  purchase: "shipments",
  sale_return: "returns",
  purchase_return: "purchase_returns",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

interface ProdRow { id: string; name: string; legacy_code: string | null; sku: string | null; cost_price: number }

class ProductIndex {
  byCode = new Map<string, ProdRow>();
  byName = new Map<string, ProdRow>();

  add(p: ProdRow) {
    if (p.legacy_code) this.byCode.set(String(p.legacy_code).trim(), p);
    if (p.sku) this.byCode.set(String(p.sku).trim(), p);
    const n = norm(p.name);
    if (!this.byName.has(n)) this.byName.set(n, p);
  }

  find(code: string, name: string): ProdRow | null {
    const c = String(code ?? "").trim();
    if (c && this.byCode.has(c)) return this.byCode.get(c)!;
    const n = norm(name ?? "");
    return (n && this.byName.get(n)) || null;
  }
}

async function loadProducts(branchId: string): Promise<ProductIndex> {
  const idx = new ProductIndex();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, legacy_code, sku, cost_price")
      .eq("branch_id", branchId)
      .range(from, from + page - 1);
    if (error) throw error;
    (data ?? []).forEach((p: any) => idx.add({ ...p, cost_price: Number(p.cost_price || 0) }));
    if (!data || data.length < page) break;
  }
  return idx;
}

/** يجيب الأرقام القديمة اللي اترحّلت قبل كده لنفس النوع/الفرع. */
async function loadExisting(kind: LegacyKind, branchId: string): Promise<Set<string>> {
  const set = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(TABLE[kind] as any)
      .select("legacy_number")
      .eq("branch_id", branchId)
      .not("legacy_number", "is", null)
      .range(from, from + page - 1);
    if (error) break;
    (data ?? []).forEach((r: any) => r.legacy_number && set.add(String(r.legacy_number)));
    if (!data || data.length < page) break;
  }
  return set;
}

async function resolveContactByName(
  cache: Map<string, string>,
  name: string,
  branchId: string,
  type: "customer" | "supplier",
): Promise<string | null> {
  const key = name.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  const { data: found } = await supabase.from("contacts").select("id").eq("name", key).limit(1).maybeSingle();
  if (found?.id) { cache.set(key, found.id); return found.id; }
  const { data: created, error } = await supabase
    .from("contacts")
    .insert({ name: key, type, branch_id: branchId, is_migrated: true } as any)
    .select("id")
    .single();
  if (error) throw new Error(`تعذّر إنشاء ${type === "customer" ? "العميل" : "المورد"} "${key}": ${error.message}`);
  cache.set(key, created.id);
  return created.id;
}

function stampDoc(kind: LegacyKind, id: string, doc: LegacyDoc, batchId: string | null, label: string) {
  return supabase
    .from(TABLE[kind] as any)
    .update({
      legacy_number: doc.legacyNumber,
      migration_batch_id: batchId,
      invoice_date: doc.dateISO || undefined,
    } as any)
    .eq("id", id);
}

/* ----------------------------- الشراء ----------------------------- */

async function migratePurchase(doc: LegacyDoc, a: LegacyRunArgs, idx: ProductIndex, batchId: string | null) {
  if (!a.supplierId) throw new Error("اختار المورد الأول");

  const newCodes: { code: string; name: string }[] = [];
  const lines = doc.items.map((it) => {
    const p = idx.find(it.code, it.name);
    if (p) {
      return {
        product_id: p.id,
        product_name: it.name,
        quantity: it.qty,
        cost_price: it.price,
        discount_percent: 0,
        discount_amount: it.discount,
      };
    }
    const attrs = extractAttributes(it.name, it.code);
    newCodes.push({ code: it.code, name: it.name });
    return {
      product_id: null,
      product_name: it.name,
      sku: it.code || null,
      quantity: it.qty,
      cost_price: it.price,
      discount_percent: 0,
      discount_amount: it.discount,
      brand: attrs.brand || "غير محدد",
      model: attrs.model || (it.code ? `كود ${it.code}` : "غير محدد"),
      color: attrs.color || undefined,
      product_type: attrs.product_type || undefined,
      capacity: attrs.capacity || undefined,
      size: attrs.size || undefined,
    };
  });

  const total = round2(lines.reduce((s, l) => s + l.quantity * l.cost_price - (l.discount_amount || 0), 0));

  const { data: res, error } = await supabase.rpc("record_shipment", {
    p_header: {
      branch_id: a.branchId,
      contact_id: a.supplierId,
      arrival_date: doc.dateISO.slice(0, 10),
      received_by: "ترحيل بيانات",
      shipping_cost: 0,
      customs_cost: 0,
      other_cost: 0,
      other_cost_description: null,
      admin_cost: 0,
      notes: `فاتورة شراء مرحّلة — الرقم الأصلي: ${doc.legacyNumber} — دفعة: ${a.label}`,
    },
    p_lines: lines as any,
  } as any);
  if (error) throw error;

  const shipmentId = (res as any)?.shipment_id as string;
  await stampDoc("purchase", shipmentId, doc, batchId, a.label);

  // ربط المنتجات الجديدة بالكود القديم + تحديث الفهرس
  if (newCodes.length) {
    const codes = newCodes.map((c) => c.code).filter(Boolean);
    if (codes.length) {
      for (const c of newCodes) {
        if (!c.code) continue;
        await supabase
          .from("products")
          .update({ legacy_code: c.code, is_migrated: true } as any)
          .eq("branch_id", a.branchId)
          .eq("sku", c.code)
          .is("legacy_code", null);
      }
    }
    const { data: fresh } = await supabase
      .from("products")
      .select("id, name, legacy_code, sku, cost_price")
      .eq("branch_id", a.branchId)
      .in("sku", codes.length ? codes : ["__none__"]);
    (fresh ?? []).forEach((p: any) => idx.add({ ...p, cost_price: Number(p.cost_price || 0) }));
  }

  // خطة الدفع + المدفوع
  const paid = Math.min(doc.paid, total);
  const state: PaymentPlanState = {
    mode: paid >= total - 0.01 ? "full" : paid > 0 ? "partial" : "credit",
    paidNow: paid,
    splits: doc.payments.map((p, i) => ({
      id: `m${i}`,
      method: p.method as any,
      amount: Math.min(p.amount, total),
      fee_amount: 0,
      received_by_name: "ترحيل بيانات",
    })),
    feeOnCustomer: false,
    scheduleType: "open",
    installments: [],
  };
  try {
    await createPaymentPlanWithInitial({
      branchId: a.branchId,
      entityType: "supplier",
      entityId: a.supplierId,
      entityName: doc.account || "مورد",
      totalAmount: total,
      referenceType: "shipment",
      referenceId: shipmentId,
      state,
      direction: "out",
      createdBy: a.userId,
    });
  } catch (e: any) {
    doc.warnings.push(`خطة الدفع فشلت: ${e?.message ?? e}`);
  }

  const { data: sh } = await supabase.from("shipments").select("shipment_number").eq("id", shipmentId).maybeSingle();
  return { number: (sh as any)?.shipment_number ?? shipmentId, total };
}

/* ------------------------------ البيع ------------------------------ */

async function migrateSale(doc: LegacyDoc, a: LegacyRunArgs, idx: ProductIndex, contacts: Map<string, string>, batchId: string | null) {
  const customerId = doc.account ? await resolveContactByName(contacts, doc.account, a.branchId, "customer") : null;

  const items = doc.items.map((it) => {
    const p = idx.find(it.code, it.name);
    if (!p) throw new Error(`المنتج "${it.name}" (كود ${it.code}) مش موجود — رحّل فواتير الشراء الأول`);
    return {
      product_id: p.id,
      product_name: it.name,
      quantity: it.qty,
      selling_price: it.price,
      cost_price: p.cost_price,
      line_discount: it.discount,
    };
  });

  const subtotal = round2(items.reduce((s, i) => s + i.quantity * i.selling_price, 0));
  const lineDisc = round2(items.reduce((s, i) => s + i.line_discount, 0));
  const total = Math.max(0, round2(subtotal - lineDisc));
  const paid = Math.min(doc.paid, total);
  const payments = doc.payments
    .map((p) => ({ payment_method: p.method, amount: Math.min(p.amount, total), received_by_name: "ترحيل بيانات" }))
    .filter((p) => p.amount > 0);

  const { data: invId, error } = await supabase.rpc("process_sale", {
    p_branch_id: a.branchId,
    p_customer_id: customerId,
    p_subtotal: subtotal,
    p_discount_amount: 0,
    p_discount_percent: 0,
    p_discount_reason: null,
    p_total: total,
    p_payment_method: paid > 0 ? (payments[0]?.payment_method ?? "cash") : "credit",
    p_items: items as any,
    p_payments: payments.length ? (payments as any) : null,
    p_vat_rate: 0,
    p_vat_amount: 0,
  } as any);
  if (error) throw error;

  await supabase
    .from("invoices")
    .update({
      invoice_date: doc.dateISO || undefined,
      legacy_number: doc.legacyNumber,
      migration_batch_id: batchId,
      is_migrated: true,
      migration_source: a.label,
      notes: `فاتورة مرحّلة — الرقم الأصلي: ${doc.legacyNumber}`,
    } as any)
    .eq("id", invId as any);

  const { data: inv } = await supabase.from("invoices").select("invoice_number").eq("id", invId as any).maybeSingle();
  return { number: (inv as any)?.invoice_number ?? String(invId), total };
}

/* -------------------------- مرتجع البيع -------------------------- */

async function migrateSaleReturn(doc: LegacyDoc, a: LegacyRunArgs, idx: ProductIndex, batchId: string | null) {
  const items: any[] = [];
  let total = 0;
  for (const it of doc.items) {
    const p = idx.find(it.code, it.name);
    if (!p) throw new Error(`المنتج "${it.name}" (كود ${it.code}) مش موجود`);
    const refund = round2(it.total);
    total = round2(total + refund);
    items.push({ product_id: p.id, quantity: it.qty, refund });
  }

  // نبحث عن الفاتورة الأصلية بالرقم القديم
  let originalId: string | null = null;
  if (doc.originalNumber) {
    const { data } = await supabase
      .from("invoices")
      .select("id")
      .eq("branch_id", a.branchId)
      .eq("legacy_number", doc.originalNumber)
      .limit(1)
      .maybeSingle();
    originalId = (data as any)?.id ?? null;
  }

  if (originalId) {
    const { data: rr, error } = await supabase.rpc("register_sale_return_full" as any, {
      _invoice_id: originalId,
      _reason: "مرتجع مرحّل من النظام القديم",
      _notes: `مرتجع مرحّل — الرقم الأصلي: ${doc.legacyNumber} — فاتورة: ${doc.originalNumber} — دفعة: ${a.label}`,
      _status: "active",
      _refund_method: "cash",
      _refund_reference: null,
      _refund_account: null,
      _refund_cash_amount: doc.paid > 0 ? Math.min(doc.paid, total) : 0,
      _refund_transfer_amount: 0,
      _refund_balance_amount: doc.paid > 0 ? round2(total - Math.min(doc.paid, total)) : total,
      _items: items as any,
    });
    if (error) throw error;
    const id = (rr as any)?.id;
    if (id) await stampDoc("sale_return", id, doc, batchId, a.label);
    return { number: (rr as any)?.return_number as string, total };
  }

  // مرتجع حر (الفاتورة الأصلية مش موجودة في الداتا المرفوعة)
  const { data: ret, error: re } = await supabase
    .from("returns")
    .insert({
      invoice_id: null,
      branch_id: a.branchId,
      reason: "مرتجع حر مرحّل — الفاتورة الأصلية مش موجودة",
      total_refund: total,
      created_by: a.userId,
      status: "active",
      refund_method: "cash",
      refund_cash_amount: doc.paid > 0 ? Math.min(doc.paid, total) : 0,
      refund_transfer_amount: 0,
      refund_balance_amount: doc.paid > 0 ? round2(total - Math.min(doc.paid, total)) : total,
      invoice_date: doc.dateISO || undefined,
      legacy_number: doc.legacyNumber,
      migration_batch_id: batchId,
      notes: `مرتجع حر مرحّل — الرقم الأصلي: ${doc.legacyNumber}${doc.originalNumber ? ` — فاتورة قديمة: ${doc.originalNumber}` : ""} — دفعة: ${a.label}`,
    } as any)
    .select("id, return_number")
    .single();
  if (re || !ret) throw re ?? new Error("فشل حفظ المرتجع الحر");

  const { error: ie } = await supabase
    .from("return_items")
    .insert(items.map((i) => ({ ...i, return_id: (ret as any).id })) as any);
  if (ie) throw ie;

  doc.warnings.push("اتسجل كمرتجع حر — الفاتورة الأصلية مش موجودة.");
  return { number: (ret as any).return_number as string, total, note: "مرتجع حر" };
}

/* -------------------------- مرتجع الشراء -------------------------- */

async function migratePurchaseReturn(doc: LegacyDoc, a: LegacyRunArgs, idx: ProductIndex, batchId: string | null) {
  const items: any[] = [];
  let total = 0;
  for (const it of doc.items) {
    const p = idx.find(it.code, it.name);
    if (!p) throw new Error(`المنتج "${it.name}" (كود ${it.code}) مش موجود`);
    const line = round2(it.total);
    total = round2(total + line);
    items.push({ product_id: p.id, product_name: it.name, quantity: it.qty, unit_cost: it.price, total: line });
  }

  let shipmentId: string | null = null;
  let contactId: string | null = a.supplierId ?? null;
  if (doc.originalNumber) {
    const { data } = await supabase
      .from("shipments")
      .select("id, contact_id")
      .eq("branch_id", a.branchId)
      .eq("legacy_number", doc.originalNumber)
      .limit(1)
      .maybeSingle();
    if (data) { shipmentId = (data as any).id; contactId = (data as any).contact_id ?? contactId; }
  }
  if (!contactId) throw new Error("اختار المورد الأول");
  if (!shipmentId) doc.warnings.push("فاتورة الشراء الأصلية مش موجودة — اتسجل كمرتجع حر.");

  const { data: pr, error } = await supabase
    .from("purchase_returns" as any)
    .insert({
      branch_id: a.branchId,
      contact_id: contactId,
      shipment_id: shipmentId,
      reason: "مرتجع شراء مرحّل من النظام القديم",
      notes: `مرتجع شراء مرحّل — الرقم الأصلي: ${doc.legacyNumber}${doc.originalNumber ? ` — شحنة قديمة: ${doc.originalNumber}` : ""} — دفعة: ${a.label}`,
      created_by: a.userId,
      total_amount: 0, // الـ trigger بيجمّع الأصناف
      status: "active",
      refund_method: "cash",
      refund_cash_amount: doc.paid > 0 ? Math.min(doc.paid, total) : 0,
      refund_transfer_amount: 0,
      refund_balance_amount: doc.paid > 0 ? round2(total - Math.min(doc.paid, total)) : total,
      invoice_date: doc.dateISO || undefined,
      legacy_number: doc.legacyNumber,
      migration_batch_id: batchId,
    } as any)
    .select("id, return_number")
    .single();
  if (error || !pr) throw error ?? new Error("فشل حفظ مرتجع الشراء");

  const { error: e2 } = await supabase
    .from("purchase_return_items" as any)
    .insert(items.map((i) => ({ ...i, purchase_return_id: (pr as any).id })) as any);
  if (e2) throw e2;

  const cash = doc.paid > 0 ? Math.min(doc.paid, total) : 0;
  if (cash > 0) {
    await supabase.from("treasury").insert({
      branch_id: a.branchId,
      type: "income",
      category: "purchase_return",
      amount: cash,
      description: `مرتجع شراء مرحّل ${(pr as any).return_number}`,
      reference_id: (pr as any).id,
      payment_method: "cash",
      created_by: a.userId,
    } as any);
  }

  return { number: (pr as any).return_number as string, total, note: shipmentId ? undefined : "مرتجع حر" };
}

/* ------------------------------ Runner ------------------------------ */

export async function runLegacyMigration(a: LegacyRunArgs): Promise<LegacyOutcome> {
  const results: LegacyDocResult[] = [];
  const contacts = new Map<string, string>();
  const idx = await loadProducts(a.branchId);
  const existing = a.skipExisting ? await loadExisting(a.kind, a.branchId) : new Set<string>();

  let batchId: string | null = null;
  try {
    const { data } = await supabase
      .from("migration_batches" as any)
      .insert({
        branch_id: a.branchId,
        kind: a.kind,
        label: a.label,
        file_name: a.fileName ?? null,
        docs_total: a.docs.length,
        status: "running",
        created_by: a.userId,
      } as any)
      .select("id")
      .single();
    batchId = (data as any)?.id ?? null;
  } catch { /* الدفعة اختيارية */ }

  let done = 0;
  for (const doc of a.docs) {
    try {
      if (existing.has(doc.legacyNumber)) {
        results.push({ legacyNumber: doc.legacyNumber, ok: true, skipped: true, items: doc.items.length, total: doc.headerTotal, note: "مرحّل قبل كده" });
      } else if (!doc.items.length) {
        throw new Error("المستند مفيهوش أصناف");
      } else {
        let out: { number: string; total: number; note?: string };
        if (a.kind === "purchase") out = await migratePurchase(doc, a, idx, batchId);
        else if (a.kind === "sale") out = await migrateSale(doc, a, idx, contacts, batchId);
        else if (a.kind === "sale_return") out = await migrateSaleReturn(doc, a, idx, batchId);
        else out = await migratePurchaseReturn(doc, a, idx, batchId);
        results.push({
          legacyNumber: doc.legacyNumber,
          ok: true,
          number: out.number,
          items: doc.items.length,
          total: out.total,
          note: [out.note, ...doc.warnings].filter(Boolean).join(" | ") || undefined,
        });
      }
    } catch (e: any) {
      results.push({
        legacyNumber: doc.legacyNumber,
        ok: false,
        error: e?.message ?? "خطأ غير متوقع",
        items: doc.items.length,
        total: doc.headerTotal,
      });
    }
    done++;
    a.onProgress?.(done, a.docs.length);
  }

  const inserted = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;

  if (batchId) {
    await supabase
      .from("migration_batches" as any)
      .update({ docs_ok: inserted, docs_failed: failed, status: failed ? "completed_with_errors" : "completed" } as any)
      .eq("id", batchId);
  }

  return { batchId, results, inserted, failed, skipped };
}
