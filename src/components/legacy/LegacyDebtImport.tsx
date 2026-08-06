import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { CsvImportPanel, ValidationOutput } from "@/components/CsvImportPanel";
import { CsvColumn, ParsedCsvRow, findDuplicates } from "@/lib/csvImport";
import { formatEGP } from "@/lib/format";
import { Info } from "lucide-react";

const key = (v: any) => String(v ?? "").trim().toLowerCase();

const cols: CsvColumn[] = [
  { key: "kind", ar: "النوع", en: "Type", required: true, note: "عميل = دين ليك عند العميل · مورد = دين عليك للمورد" },
  { key: "name", ar: "اسم العميل/المورد", en: "Contact Name", required: true, note: "لازم يكون مسجّل عندك قبل كده" },
  { key: "phone", ar: "التليفون", en: "Phone", note: "للتفرقة لو الأسماء متشابهة" },
  { key: "branch_code", ar: "كود الفرع", en: "Branch Code", required: true },
  { key: "legacy_number", ar: "رقم الفاتورة القديم", en: "Legacy Invoice No.", required: true, note: "بيمنع الترحيل مرتين" },
  { key: "date", ar: "تاريخ الفاتورة", en: "Invoice Date", required: true, type: "date" },
  { key: "total", ar: "إجمالي الفاتورة", en: "Invoice Total", required: true, type: "number" },
  { key: "paid", ar: "المدفوع منها", en: "Paid Amount", type: "number", note: "سيبه فاضي لو مدفعش حاجة" },
  { key: "notes", ar: "ملاحظات", en: "Notes" },
];

export function LegacyDebtImport() {
  const [tenantId, setTenantId] = useState<string | null>(null);

  const loadRef = async () => {
    const { data: prof } = await supabase.from("profiles").select("tenant_id").maybeSingle();
    setTenantId(prof?.tenant_id ?? null);
    const [{ data: branches }, { data: contacts }] = await Promise.all([
      supabase.from("branches").select("id, code, name"),
      supabase.from("contacts").select("id, name, phone, type"),
    ]);
    return { branches: branches ?? [], contacts: contacts ?? [] };
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-2 border-primary/30 bg-primary/5">
        <div className="flex items-center gap-2 font-bold text-sm">
          <Info className="w-4 h-4 text-primary" /> ترحيل الديون القديمة كفواتير حقيقية
        </div>
        <ul className="text-xs text-muted-foreground leading-6 list-disc pe-5 space-y-0.5">
          <li>كل سطر بيتسجل <b>فاتورة فعلية</b> برقمها القديم وتاريخها — فتظهر في كشف حساب العميل/المورد وفي تقرير أعمار الديون بعمرها الصح.</li>
          <li><b>مفيش أي أثر على المخزون</b> — الفاتورة دي مالهاش أصناف، فالكميات ما بتتغيرش.</li>
          <li><b>مفيش أي أثر على الخزنة</b> — حتى المبلغ المدفوع بيتسجل كسداد تاريخي من غير ما يدخل فلوس الخزنة النهاردة.</li>
          <li>الطرف المحاسبي التاني هو حساب <b>3950 أرصدة افتتاحية</b>، فالميزانية تفضل متوازنة.</li>
          <li>رقم الفاتورة القديم مايتكررش — لو رفعت نفس الملف تاني الصف هيترفض.</li>
        </ul>
      </Card>

      <CsvImportPanel
        title="ديون قديمة كفواتير / Opening Debt as Invoices"
        templateName="opening-debt-invoices"
        description="الطريقة دي أدق من «رصيد افتتاحي» واحد، لأن كل دين بيفضل عارف تاريخه ورقمه."
        columns={cols}
        sample={{
          kind: "عميل", name: "محمد السيد", phone: "01000000000", branch_code: "B01",
          legacy_number: "1001", date: "2025-03-15", total: 5000, paid: 2000, notes: "",
        }}
        validate={async (rows) => {
          const ref = await loadRef();
          const branches = new Map(ref.branches.map((b: any) => [key(b.code), b.id]));
          const byName = new Map<string, any[]>();
          ref.contacts.forEach((c: any) => byName.set(key(c.name), [...(byName.get(key(c.name)) ?? []), c]));
          const byPhone = new Map(ref.contacts.filter((c: any) => c.phone).map((c: any) => [key(c.phone), c]));
          const dupNums = new Map(findDuplicates(rows, (d) => `${d.branch_code}|${d.legacy_number}`));
          const ok: ParsedCsvRow[] = []; const bad: ValidationOutput["bad"] = [];
          let ar = 0, ap = 0;

          rows.forEach((r) => {
            const e = [...r.errors];
            const k = key(r.data.kind);
            const kind = ["عميل", "customer", "عملاء"].includes(k) ? "customer"
              : ["مورد", "supplier", "موردين"].includes(k) ? "supplier" : null;
            if (!kind) e.push(`النوع «${r.data.kind}» مش مفهوم — اكتب: عميل أو مورد`);

            const bid = branches.get(key(r.data.branch_code));
            if (!bid) e.push(`كود الفرع «${r.data.branch_code}» مش موجود`);

            let c: any = r.data.phone ? byPhone.get(key(r.data.phone)) : undefined;
            if (!c) {
              const hits = byName.get(key(r.data.name)) ?? [];
              if (!hits.length) e.push(`«${r.data.name}» مش مسجّل في العملاء/الموردين — ارفعه الأول`);
              else if (hits.length > 1) e.push("فيه أكتر من حساب بنفس الاسم — حدّد التليفون");
              else c = hits[0];
            }
            if (c && kind && c.type !== "both" && c.type !== kind) {
              e.push(`«${r.data.name}» مسجّل كـ ${c.type === "customer" ? "عميل" : "مورد"} مش ${kind === "customer" ? "عميل" : "مورد"}`);
            }

            const total = Number(r.data.total ?? 0);
            const paid = Number(r.data.paid ?? 0);
            if (total <= 0) e.push("إجمالي الفاتورة لازم يكون أكبر من صفر");
            if (paid < 0) e.push("المدفوع مايكونش بالسالب");
            if (paid > total) e.push(`المدفوع (${paid}) أكبر من الإجمالي (${total})`);
            if (dupNums.has(key(`${r.data.branch_code}|${r.data.legacy_number}`)))
              e.push("رقم الفاتورة القديم متكرر داخل الملف لنفس الفرع");

            if (e.length) { bad.push({ index: r.index, errors: e }); return; }
            r.data._branch = bid; r.data._contact = c.id; r.data._kind = kind;
            const out = total - paid;
            kind === "customer" ? (ar += out) : (ap += out);
            ok.push(r);
          });

          return {
            ok, bad,
            notes: [
              `دين متبقّي على العملاء: ${formatEGP(ar)} • دين متبقّي للموردين: ${formatEGP(ap)}`,
              "الفواتير دي مش هتأثر على المخزون ولا على رصيد الخزنة إطلاقًا.",
            ],
          };
        }}
        onImport={async (rows) => {
          const failed: { index: number; error: string }[] = [];
          let inserted = 0;
          for (const r of rows) {
            const { error } = await (supabase as any).rpc("import_opening_debt", {
              p_branch_id: r.data._branch,
              p_contact_id: r.data._contact,
              p_kind: r.data._kind,
              p_legacy_number: String(r.data.legacy_number),
              p_date: new Date(`${r.data.date}T12:00:00`).toISOString(),
              p_total: Number(r.data.total),
              p_paid: Number(r.data.paid ?? 0),
              p_notes: r.data.notes || null,
            });
            if (error) failed.push({ index: r.index, error: error.message });
            else inserted++;
          }
          return {
            inserted, failed,
            notes: [
              "تقدر تشوفها دلوقتي في كشف حساب كل عميل/مورد، وفي تقرير أعمار الديون (المحاسبة ← أعمار الديون).",
              tenantId ? "" : "",
            ].filter(Boolean),
          };
        }}
        extra={
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">مالهاش أثر على المخزون</Badge>
            <Badge variant="outline">مالهاش أثر على الخزنة</Badge>
            <Badge variant="outline">بتظهر في أعمار الديون</Badge>
          </div>
        }
      />
    </div>
  );
}
