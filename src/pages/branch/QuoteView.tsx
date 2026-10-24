import { fetchContactBalance } from "@/lib/contactBalances";
import { PermTable } from "@/components/PermTable";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Printer, FileDown, ArrowRightLeft, Loader2 } from "lucide-react";
import { RecordAttachments } from "@/components/RecordAttachments";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ThermalReceiptPrint, printThermalInvoice } from "@/components/ThermalReceiptPrint";
import { ColorChip } from "@/components/ColorPicker";
import { VariantLine } from "@/components/VariantChips";

const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  sent: "مُرسل",
  accepted: "مقبول",
  rejected: "مرفوض",
  converted: "محوّل لفاتورة",
};

export default function QuoteView() {
  const { id, quoteId } = useParams<{ id: string; quoteId: string }>();
  const nav = useNavigate();
  const { tenant } = useAuth();
  const [quote, setQuote] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [branch, setBranch] = useState<any>(null);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: q, error: e1 } = await supabase
          .from("quotes" as any)
          .select("*, contacts:contact_id(name, phone, address)")
          .eq("id", quoteId!)
          .maybeSingle();
        if (e1) throw e1;
        if (!q) { setError("عرض السعر غير موجود"); return; }
        // TODO Phase 2.2B: Remove after contacts.balance column is dropped
        if ((q as any).contact_id) {
          
          const bal = await fetchContactBalance((q as any).contact_id);
          if ((q as any).contacts) (q as any).contacts.balance = bal;
        }
        setQuote(q);
        const { data: its } = await supabase.from("quote_items" as any).select("*").eq("quote_id", quoteId!);
        setItems(its ?? []);
        const { data: b } = await supabase.from("branches").select("*").eq("id", id!).maybeSingle();
        setBranch(b);
        if ((q as any).created_by) {
          const { data: cu } = await supabase.from("profiles").select("name").eq("id", (q as any).created_by).maybeSingle();
          setCreatorName(cu?.name ?? null);
        }
      } catch (err: any) {
        setError(err.message ?? "تعذر تحميل عرض السعر");
      }
    })();
  }, [quoteId, id, reloadKey]);

  useRealtimeRefresh(["quotes", "quote_items"], () => setReloadKey((k) => k + 1));

  const doPrint = () => printThermalInvoice();

  const convertToInvoice = async () => {
    if (!quote) return;
    setConverting(true);
    // mark quote as converted (best-effort; ignore failures so navigation still happens)
    await supabase.from("quotes" as any).update({ status: "converted" }).eq("id", quote.id);
    setConverting(false);
    nav(`/branch/${id}/sales/new`, {
      state: {
        prefillFromQuote: {
          quoteId: quote.id,
          quoteNumber: quote.quote_number,
          customerId: quote.contact_id ?? "",
          customerName: quote.customer_name ?? "",
          notes: quote.notes ?? "",
          items: items.map((it) => ({
            product_id: it.product_id,
            product_name: it.product_name,
            quantity: Number(it.quantity || 1),
            unit_price: Number(it.unit_price || 0),
          })),
        },
      },
    });
  };

  if (error) return <BranchLayout><div className="p-8 text-center text-destructive">⚠️ {error}</div></BranchLayout>;
  if (!quote) return <BranchLayout><div className="p-8 text-center">جاري التحميل...</div></BranchLayout>;

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date();
  const canConvert = quote.status !== "converted" && quote.status !== "rejected";

  return (
    <BranchLayout>
      <PageHeader
        title={`عرض سعر ${quote.quote_number}`}
        actions={
          <div className="flex gap-2 no-print flex-wrap">
            {canConvert && (
              <Button className="btn-gradient" onClick={convertToInvoice} disabled={converting}>
                {converting ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 ml-1" />}
                تحويل لفاتورة
              </Button>
            )}
            <Button variant="outline" onClick={doPrint}><FileDown className="w-4 h-4 ml-1" /> تحميل PDF</Button>
            <Button variant="outline" onClick={doPrint}><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
          </div>
        }
      />

      <div className="print-area max-w-3xl mx-auto card-elevated p-8 bg-card">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-border">
          <div className="text-right">
            <div className="text-xs text-muted-foreground mb-1">الجهة البائعة</div>
            <h2 className="text-2xl font-extrabold gradient-text">🏢 {tenant?.name ?? branch?.name}</h2>
            <p className="text-sm font-semibold mt-1">📍 فرع: {branch?.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{branch?.address ?? ""} {branch?.phone && `| ☎ ${branch.phone}`}</p>
          </div>
          <div className="text-left bg-secondary/10 border border-secondary/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">رقم عرض السعر</div>
            <div className="font-mono font-extrabold text-secondary text-lg">{quote.quote_number}</div>
            <div className="text-xs text-muted-foreground mt-2">التاريخ</div>
            <div className="text-sm font-bold">{formatDateTime(quote.created_at)}</div>
            <div className="mt-2 text-xs">
              <span className="inline-block px-2 py-0.5 rounded bg-card border border-border">{STATUS_LABEL[quote.status] ?? quote.status}</span>
            </div>
          </div>
        </div>

        {/* Buyer + Validity */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">👤 الجهة المعنية (العميل)</div>
            {quote.contact_id ? (
              <a href={`/branch/${id}/customers/${quote.contact_id}`} className="font-bold text-primary hover:underline">
                {quote.contacts?.name ?? "عميل"}
              </a>
            ) : (
              <div className="font-bold">{quote.customer_name ?? "عميل غير مسجل"}</div>
            )}
            {quote.contacts?.phone && <div className="text-xs text-muted-foreground">☎ {quote.contacts.phone}</div>}
            {quote.contacts?.address && <div className="text-xs text-muted-foreground">📍 {quote.contacts.address}</div>}
          </div>
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">🧾 أصدر العرض</div>
            <div className="font-bold">{creatorName ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">
              صالح حتى:{" "}
              {quote.valid_until ? (
                <span className={isExpired ? "text-destructive font-bold" : "font-bold"}>
                  {formatDate(quote.valid_until)} {isExpired && "(منتهي)"}
                </span>
              ) : "—"}
            </div>
          </div>
        </div>

        {/* Items */}
        <PermTable className="w-full text-sm mb-6 border border-border">
          <thead>
            <tr className="bg-surface-2 border-b-2 border-border">
              <th className="text-right p-2">#</th>
              <th className="text-right p-2">المنتج</th>
              <th className="text-center p-2">الكمية</th>
              <th className="text-center p-2">سعر الوحدة</th>
              <th className="text-left p-2">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className="border-b border-border">
                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                <td className="p-2 font-medium"><span className="inline-flex items-center gap-1.5">{it.product_name}{(it as any).color && <ColorChip name={(it as any).color} />}</span><VariantLine attrs={{ ...(it as any), color: null }} className="block mt-0.5" /></td>
                <td className="text-center p-2">{it.quantity}</td>
                <td className="text-center p-2">{formatEGP(it.unit_price)}</td>
                <td className="text-left p-2 font-bold">{formatEGP(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </PermTable>

        {/* Totals */}
        <div className="space-y-2 text-sm border-t-2 border-border pt-3">
          <div className="flex justify-between"><span>المجموع قبل الخصم:</span><span className="font-bold">{formatEGP(quote.subtotal)}</span></div>
          {Number(quote.discount) > 0 && (
            <div className="flex justify-between text-destructive">
              <span>خصم:</span>
              <span className="font-bold">- {formatEGP(quote.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg pt-2 border-t border-border">
            <span className="font-bold">الإجمالي:</span>
            <span className="text-secondary font-extrabold">{formatEGP(quote.total)}</span>
          </div>
        </div>

        {quote.notes && (
          <div className="mt-4 p-3 rounded-lg bg-surface-2 border border-border text-sm">
            <div className="font-bold mb-1">ملاحظات:</div>
            <div className="whitespace-pre-wrap text-muted-foreground">{quote.notes}</div>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground border-t border-dashed border-border pt-3">
          هذا العرض غير ملزم ولا يؤثر على المخزون. يرجى الرجوع للجهة البائعة لتأكيد الأسعار والتوافر.
        </div>
      </div>

      <div className="max-w-3xl mx-auto mt-4 no-print">
        <RecordAttachments recordType="quote" recordId={quote.id} />
      </div>

      {/* Hidden thermal-style receipt used for printing (same look as invoice with logo) */}
      <div style={{ position: "fixed", left: "-10000px", top: 0, width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
        <ThermalReceiptPrint
          kind="quote"
          companyName={tenant?.name ?? branch?.name}
          branchName={branch?.name}
          invoiceNumber={quote.quote_number}
          createdAt={quote.created_at}
          dueDate={quote.valid_until}
          cashier={creatorName}
          partyName={quote.contacts?.name ?? quote.customer_name ?? null}
          notes={quote.notes}
          items={items.map((it) => ({
            name: it.product_name,
            qty: Number(it.quantity || 0),
            unit_price: Number(it.unit_price || 0),
            total: Number(it.total || 0),
          }))}
          subtotal={Number(quote.subtotal || 0)}
          discount={Number(quote.discount || 0)}
          total={Number(quote.total || 0)}
        />
      </div>
    </BranchLayout>
  );
}
