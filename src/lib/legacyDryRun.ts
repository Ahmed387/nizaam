import { supabase } from "@/integrations/supabase/client";
import type { LegacyDoc, LegacyKind } from "@/lib/legacySheetParser";
import {
  loadProducts, loadExisting, loadClosedPeriods, findClosedPeriod, round2,
} from "@/lib/legacyMigration";

/**
 * فحص تجريبي (Dry Run) — بيراجع الملف قبل أي كتابة في الداتا بيز.
 * مبيسجّلش أي حاجة، بس بيقولك كل مستند هيحصله إيه.
 */

export type IssueLevel = "error" | "warning" | "info";

export interface DryIssue { level: IssueLevel; text: string }

export interface DryDocCheck {
  legacyNumber: string;
  dateISO: string;
  account: string;
  items: number;
  total: number;
  paid: number;
  status: "ok" | "warning" | "blocked" | "skip";
  issues: DryIssue[];
  /** المخزن اللي في الملف والفرع اللي هيترحّل عليه */
  warehouse?: string;
  branchName?: string;
}

export interface DryRunReport {
  kind: LegacyKind;
  docs: DryDocCheck[];
  ok: number;
  warnings: number;
  blocked: number;
  skipped: number;
  newContacts: string[];
  newProducts: { code: string; name: string }[];
  missingProducts: { code: string; name: string }[];
  total: number;
}

export interface DryRunArgs {
  kind: LegacyKind;
  branchId: string;
  docs: LegacyDoc[];
  supplierId?: string | null;
  /** ربط اسم الحساب في الملف بحساب موجود على النظام */
  contactMap?: Record<string, string>;
  skipExisting?: boolean;
}

const key = (c: string, n: string) => `${String(c || "").trim()}::${(n || "").replace(/\s+/g, " ").trim().toLowerCase()}`;

async function loadContactNames(): Promise<Set<string>> {
  const set = new Set<string>();
  const { data } = await supabase.from("contacts").select("name");
  (data ?? []).forEach((c: any) => c?.name && set.add(String(c.name).trim()));
  return set;
}

/** يجيب الأرقام القديمة للمستندات الأصلية اللي المرتجعات بتشاور عليها. */
async function loadParents(kind: LegacyKind, branchId: string): Promise<Set<string>> {
  const parent: Partial<Record<LegacyKind, LegacyKind>> = {
    sale_return: "sale",
    purchase_return: "purchase",
  };
  const p = parent[kind];
  if (!p) return new Set();
  return loadExisting(p, branchId);
}

export async function runLegacyDryRun(a: DryRunArgs): Promise<DryRunReport> {
  const [idx, existing, closed, contactNames, parents] = await Promise.all([
    loadProducts(a.branchId),
    loadExisting(a.kind, a.branchId),
    loadClosedPeriods(),
    loadContactNames(),
    loadParents(a.kind, a.branchId),
  ]);

  Object.entries(a.contactMap ?? {}).forEach(([name, id]) => { if (name && id) contactNames.add(name.trim()); });

  const seen = new Map<string, number>();
  const newContacts = new Set<string>();
  const newProducts = new Map<string, { code: string; name: string }>();
  const missing = new Map<string, { code: string; name: string }>();
  const docs: DryDocCheck[] = [];

  for (const doc of a.docs) {
    const issues: DryIssue[] = [];
    let blocked = false;
    let skip = false;

    if (!doc.legacyNumber) { issues.push({ level: "error", text: "مفيش رقم مستند في الملف" }); blocked = true; }
    if (!doc.dateISO) { issues.push({ level: "error", text: "التاريخ غير مقروء" }); blocked = true; }
    if (!doc.items.length) { issues.push({ level: "error", text: "المستند مفيهوش أصناف" }); blocked = true; }

    // تكرار جوه نفس الملف
    const c = (seen.get(doc.legacyNumber) ?? 0) + 1;
    seen.set(doc.legacyNumber, c);
    if (doc.legacyNumber && c > 1) {
      issues.push({ level: "error", text: `الرقم ده مكرر جوه الملف (${c} مرات)` });
      blocked = true;
    }

    // مرحّل قبل كده
    if (doc.legacyNumber && existing.has(doc.legacyNumber)) {
      if (a.skipExisting) { issues.push({ level: "info", text: "مرحّل قبل كده — هيتخطى" }); skip = true; }
      else { issues.push({ level: "error", text: "مرحّل قبل كده — هيتكرر لو كملت" }); blocked = true; }
    }

    // فترة محاسبية مقفولة
    const closedName = findClosedPeriod(closed, doc.dateISO);
    if (closedName) {
      issues.push({ level: "error", text: `التاريخ واقع في فترة مقفولة (${closedName}) — افتح الفترة الأول` });
      blocked = true;
    }

    // الطرف (عميل / مورد)
    if (a.kind === "sale" || a.kind === "sale_return") {
      if (!doc.account) issues.push({ level: "warning", text: "مفيش اسم عميل — هيتسجل بدون عميل" });
      else if (!contactNames.has(doc.account.trim())) {
        newContacts.add(doc.account.trim());
        issues.push({ level: "info", text: `عميل جديد هيتعمل: ${doc.account}` });
      }
    } else {
      if (doc.account && !contactNames.has(doc.account.trim())) {
        newContacts.add(doc.account.trim());
        issues.push({ level: "info", text: `مورد جديد هيتعمل: ${doc.account}` });
      } else if (!doc.account && !a.supplierId) {
        issues.push({ level: "error", text: "مفيش مورد في الملف ولا مورد افتراضي مختار" });
        blocked = true;
      } else if (!doc.account) {
        issues.push({ level: "info", text: "هيتسجل على المورد الافتراضي المختار" });
      }
    }

    // الأصناف
    for (const it of doc.items) {
      const p = idx.find(it.code, it.name);
      if (!p) {
        const k = key(it.code, it.name);
        if (a.kind === "purchase") {
          newProducts.set(k, { code: it.code, name: it.name });
        } else {
          missing.set(k, { code: it.code, name: it.name });
          issues.push({ level: "error", text: `المنتج "${it.name}" (${it.code || "بدون كود"}) مش موجود — رحّل الشراء الأول` });
          blocked = true;
        }
      }
      if (it.price <= 0) issues.push({ level: "warning", text: `الصنف "${it.name}" سعره صفر` });
    }

    // أرقام
    const diff = Math.abs(round2(doc.itemsTotal - doc.headerTotal));
    if (doc.items.length && diff > 1) {
      issues.push({ level: "warning", text: `فرق ${diff} بين مجموع الأصناف (${doc.itemsTotal}) وإجمالي الفاتورة (${doc.headerTotal})` });
    }
    if (doc.paid > doc.headerTotal + 0.01) {
      issues.push({ level: "warning", text: `المدفوع (${doc.paid}) أكبر من الإجمالي (${doc.headerTotal}) — هيتقص للإجمالي` });
    }

    // مرتجع بدون أصل
    if (a.kind === "sale_return" || a.kind === "purchase_return") {
      if (!doc.originalNumber) issues.push({ level: "warning", text: "مفيش رقم مستند أصلي — هيتسجل كمرتجع حر" });
      else if (!parents.has(doc.originalNumber)) {
        issues.push({ level: "warning", text: `المستند الأصلي #${doc.originalNumber} مش مرحّل — هيتسجل كمرتجع حر` });
      }
    }

    doc.warnings.forEach((w) => issues.push({ level: "warning", text: w }));

    docs.push({
      legacyNumber: doc.legacyNumber || `(صف ${doc.row})`,
      dateISO: doc.dateISO,
      account: doc.account,
      items: doc.items.length,
      total: doc.headerTotal,
      paid: doc.paid,
      status: blocked ? "blocked" : skip ? "skip" : issues.some((i) => i.level === "warning") ? "warning" : "ok",
      issues,
      warehouse: doc.warehouse || "",
    });
  }

  return {
    kind: a.kind,
    docs,
    ok: docs.filter((d) => d.status === "ok").length,
    warnings: docs.filter((d) => d.status === "warning").length,
    blocked: docs.filter((d) => d.status === "blocked").length,
    skipped: docs.filter((d) => d.status === "skip").length,
    newContacts: [...newContacts],
    newProducts: [...newProducts.values()],
    missingProducts: [...missing.values()],
    total: round2(a.docs.reduce((s, d) => s + d.headerTotal, 0)),
  };
}
