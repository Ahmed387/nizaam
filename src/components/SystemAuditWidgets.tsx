import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, RefreshCcw, CheckCircle2, AlertTriangle, Scale, ClipboardList, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const fmt = (n: any) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

type Variance = { branch_id: string | null; branch_name: string | null; treasury_balance: number; gl_balance: number; variance: number };

type AuditState = {
  variances: Variance[];
  unbalancedEntries: { id: string; entry_number: string | null; total_debit: number; total_credit: number }[];
  vouchersNoCategory: number;
  staleInvoices: number;
  invoicesNoItems: number;
};

const EMPTY: AuditState = { variances: [], unbalancedEntries: [], vouchersNoCategory: 0, staleInvoices: 0, invoicesNoItems: 0 };

function OkLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-success text-sm font-semibold">
      <CheckCircle2 className="w-4 h-4" /> {text}
    </div>
  );
}

export function SystemAuditWidgets() {
  const [state, setState] = useState<AuditState>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

      const [varRes, jeRes, vcRes, invRes] = await Promise.all([
        supabase.from("v_treasury_gl_variance" as any).select("*"),
        supabase
          .from("journal_entries")
          .select("id, entry_number, total_debit, total_credit")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("vouchers")
          .select("id", { count: "exact", head: true })
          .is("category_id", null)
          .eq("status", "active"),
        supabase
          .from("invoices")
          .select("id, created_at, invoice_items(id)")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      const invoices = (invRes.data ?? []) as any[];
      const invoicesNoItems = invoices.filter((i) => !(i.invoice_items ?? []).length).length;

      // فواتير أقدم من 48 ساعة ومالهاش قيد يومي
      const oldIds = invoices.filter((i) => i.created_at < cutoff).map((i) => i.id);
      let staleInvoices = 0;
      if (oldIds.length) {
        const { data: posted } = await supabase
          .from("journal_entries")
          .select("source_id")
          .eq("source_type", "invoice")
          .in("source_id", oldIds);
        const postedSet = new Set((posted ?? []).map((p: any) => p.source_id));
        staleInvoices = oldIds.filter((id) => !postedSet.has(id)).length;
      }

      setState({
        variances: ((varRes.data ?? []) as any[]).map((v) => ({
          branch_id: v.branch_id,
          branch_name: v.branch_name,
          treasury_balance: Number(v.treasury_balance || 0),
          gl_balance: Number(v.gl_balance || 0),
          variance: Number(v.variance || 0),
        })),
        unbalancedEntries: ((jeRes.data ?? []) as any[]).filter(
          (e) => Math.abs(Number(e.total_debit || 0) - Number(e.total_credit || 0)) > 0.01,
        ),
        vouchersNoCategory: vcRes.count ?? 0,
        staleInvoices,
        invoicesNoItems,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const badVar = state.variances.filter((v) => Math.abs(v.variance) > 0.01);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-muted-foreground">لوحة الرقابة الذكية</h3>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <RefreshCcw className="w-4 h-4 ml-2" />}
          تحديث
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* 1. رادار المطابقة المالية */}
        <Card className={badVar.length || state.unbalancedEntries.length ? "border-destructive/50" : "border-success/40"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="w-4 h-4 text-primary" /> رادار المطابقة المالية
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                {badVar.length === 0 ? (
                  <OkLine text="✅ الخزينة مطابقة للدفاتر" />
                ) : (
                  badVar.map((v) => (
                    <Alert key={v.branch_id ?? "none"} variant="destructive" className="py-2">
                      <AlertDescription className="text-xs leading-relaxed">
                        <span className="font-bold">{v.branch_name ?? "بدون فرع"}</span> — فرق {fmt(v.variance)} جنيه
                        <div className="text-[11px] opacity-80">الخزنة: {fmt(v.treasury_balance)} • الدفاتر: {fmt(v.gl_balance)}</div>
                      </AlertDescription>
                    </Alert>
                  ))
                )}
                {state.unbalancedEntries.length === 0 ? (
                  <div className="text-xs text-muted-foreground">كل القيود اليومية متزنة (مدين = دائن).</div>
                ) : (
                  <Badge className="bg-destructive/15 text-destructive border-destructive/30 gap-1">
                    <AlertTriangle className="w-3 h-3" /> {state.unbalancedEntries.length} قيد غير متزن
                  </Badge>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* 2. فحص سلامة العمليات */}
        <Card className={state.vouchersNoCategory || state.staleInvoices ? "border-warning/50" : "border-success/40"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" /> فحص سلامة العمليات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : state.vouchersNoCategory === 0 && state.staleInvoices === 0 ? (
              <OkLine text="مفيش مشاكل في العمليات" />
            ) : (
              <>
                {state.vouchersNoCategory > 0 && (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs">
                    فيه <span className="font-bold">{state.vouchersNoCategory}</span> سند محفوظ من غير تصنيف — افتح «السندات» وحدّد التصنيف.
                  </div>
                )}
                {state.staleInvoices > 0 && (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs">
                    فيه <span className="font-bold">{state.staleInvoices}</span> فاتورة عدّى عليها أكتر من 48 ساعة ولسه من غير قيد يومي.
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* 3. صحة قاعدة البيانات */}
        <Card className={state.invoicesNoItems ? "border-warning/50" : "border-success/40"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" /> صحة قاعدة البيانات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : state.invoicesNoItems === 0 ? (
              <OkLine text="مفيش بيانات يتيمة في آخر الفواتير" />
            ) : (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs">
                فيه <span className="font-bold">{state.invoicesNoItems}</span> فاتورة من غير أي أصناف — راجعها أو احذفها.
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">الفحص بيتم على آخر 500 فاتورة للحفاظ على سرعة النظام.</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
