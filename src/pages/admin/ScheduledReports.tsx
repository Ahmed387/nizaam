import { useEffect, useState } from "react";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { exportToExcel, printReport } from "@/lib/export";
import { formatEGP as fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { CalendarRange, Download, FileText, Loader2, Play, Sparkles } from "lucide-react";

interface Report {
  id: string;
  period: string;
  period_start: string;
  period_end: string;
  summary: any;
  created_at: string;
}

export default function ScheduledReports({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiOutput, setAiOutput] = useState<Record<string, string>>({});

  const load = async () => {
    const { data } = await supabase
      .from("scheduled_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(52);
    setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("sr-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_reports" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId]);

  const runNow = async () => {
    setRunning(true);
    const { error } = await supabase.functions.invoke("generate-scheduled-reports", {
      body: { tenant_id: tenantId },
    });
    setRunning(false);
    if (error) toast.error(error.message);
    else { toast.success("تم إنشاء التقرير"); load(); }
  };

  const downloadExcel = (r: Report) => {
    const s = r.summary || {};
    const totals = s.totals || {};
    exportToExcel(`weekly-report-${r.id.slice(0, 8)}`, [
      { name: "ملخص", rows: [
        { البند: "إجمالي المبيعات", القيمة: totals.sales ?? 0 },
        { البند: "إجمالي المرتجعات", القيمة: totals.returns ?? 0 },
        { البند: "إجمالي المصروفات", القيمة: totals.expenses ?? 0 },
        { البند: "إيراد الخزنة", القيمة: totals.treasury_income ?? 0 },
        { البند: "مصروف الخزنة", القيمة: totals.treasury_expense ?? 0 },
        { البند: "صافي الربح", القيمة: totals.net_profit ?? 0 },
        { البند: "عدد الفواتير", القيمة: totals.invoice_count ?? 0 },
      ]},
      { name: "حسب الفرع", rows: (s.per_branch ?? []).map((b: any) => ({ الفرع: b.branch_name, المبيعات: b.sales })) },
      { name: "أعلى المنتجات", rows: (s.top_products ?? []).map((p: any) => ({ المنتج: p.name, الكمية: p.qty, الإجمالي: p.total })) },
    ]);
  };

  const runAi = async (r: Report) => {
    setAiBusy(r.id);
    try {
      const { data, error } = await supabase.functions.invoke("ai-report-analysis", { body: { report_id: r.id } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setAiOutput((o) => ({ ...o, [r.id]: (data as any).analysis ?? "" }));
      toast.success("تم إنشاء التحليل");
    } catch (e: any) {
      toast.error(e.message || "فشل التحليل");
    } finally {
      setAiBusy(null);
    }
  };

  const mdToHtml = (md: string) =>
    md.replace(/^## (.+)$/gm, "<h3>$1</h3>")
      .replace(/^### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\n\n/g, "<br/>");

  const downloadPdf = (r: Report) => {
    const s = r.summary || {}; const t = s.totals || {};
    const ps = new Date(r.period_start).toLocaleDateString("ar-EG");
    const pe = new Date(r.period_end).toLocaleDateString("ar-EG");
    const ai = aiOutput[r.id];
    const html = `
      <div class="kpi">
        <div>إجمالي المبيعات<b>${fmtMoney(t.sales ?? 0)}</b></div>
        <div>المرتجعات<b class="neg">${fmtMoney(t.returns ?? 0)}</b></div>
        <div>المصروفات<b class="neg">${fmtMoney(t.expenses ?? 0)}</b></div>
        <div>صافي الربح<b class="${(t.net_profit ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtMoney(t.net_profit ?? 0)}</b></div>
        <div>عدد الفواتير<b>${t.invoice_count ?? 0}</b></div>
      </div>
      <h3>المبيعات حسب الفرع</h3>
      <table><thead><tr><th>الفرع</th><th>المبيعات</th></tr></thead><tbody>
        ${(s.per_branch ?? []).map((b: any) => `<tr><td>${b.branch_name}</td><td>${fmtMoney(b.sales)}</td></tr>`).join("")}
      </tbody></table>
      <h3>أعلى المنتجات مبيعاً</h3>
      <table><thead><tr><th>المنتج</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>
        ${(s.top_products ?? []).map((p: any) => `<tr><td>${p.name}</td><td>${p.qty}</td><td>${fmtMoney(p.total)}</td></tr>`).join("")}
      </tbody></table>
      ${ai ? `<div style="margin-top:24px;padding:16px;border:1px solid #ddd;border-radius:8px;background:#fafafa">
        <h2 style="margin-top:0">🤖 تحليل ذكاء اصطناعي</h2>
        ${mdToHtml(ai)}
      </div>` : ""}
    `;
    printReport(`التقرير الأسبوعي ${ps} - ${pe}`, html);
  };

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader title="التقارير المجدولة" subtitle="تقارير أسبوعية تلقائية كل يوم أحد" />

      <div className="flex justify-end mb-4">
        <Button onClick={runNow} disabled={running} className="gap-2">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          إنشاء تقرير الآن
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <div className="card-elevated p-12 text-center text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
          لا توجد تقارير بعد. سيتم إنشاء تقرير أسبوعي تلقائياً كل يوم أحد، أو اضغط "إنشاء تقرير الآن".
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const t = r.summary?.totals || {};
            return (
              <div key={r.id} className="card-elevated p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <CalendarRange className="w-5 h-5 text-primary" />
                    <div>
                      <div className="font-semibold">
                        تقرير {r.period === "weekly" ? "أسبوعي" : r.period}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.period_start).toLocaleDateString("ar-EG")} – {new Date(r.period_end).toLocaleDateString("ar-EG")}
                        {" · "}أُنشئ في {new Date(r.created_at).toLocaleString("ar-EG")}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => runAi(r)} disabled={aiBusy === r.id} className="gap-1 border-primary/30">
                      {aiBusy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
                      {aiOutput[r.id] ? "إعادة تحليل AI" : "تحليل AI"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadPdf(r)} className="gap-1">
                      <FileText className="w-4 h-4" /> PDF{aiOutput[r.id] ? " + AI" : ""}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadExcel(r)} className="gap-1">
                      <Download className="w-4 h-4" /> Excel
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3 text-sm">
                  <div className="bg-surface-2 rounded p-2"><div className="text-xs text-muted-foreground">المبيعات</div><div className="font-bold">{fmtMoney(t.sales ?? 0)}</div></div>
                  <div className="bg-surface-2 rounded p-2"><div className="text-xs text-muted-foreground">المرتجعات</div><div className="font-bold text-destructive">{fmtMoney(t.returns ?? 0)}</div></div>
                  <div className="bg-surface-2 rounded p-2"><div className="text-xs text-muted-foreground">المصروفات</div><div className="font-bold text-destructive">{fmtMoney(t.expenses ?? 0)}</div></div>
                  <div className="bg-surface-2 rounded p-2"><div className="text-xs text-muted-foreground">صافي الربح</div><div className={`font-bold ${(t.net_profit ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtMoney(t.net_profit ?? 0)}</div></div>
                  <div className="bg-surface-2 rounded p-2"><div className="text-xs text-muted-foreground">عدد الفواتير</div><div className="font-bold">{t.invoice_count ?? 0}</div></div>
                </div>
                {aiOutput[r.id] && (
                  <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2 mb-2 text-primary font-bold"><Sparkles className="w-4 h-4" /> تحليل AI</div>
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-7" dir="rtl">{aiOutput[r.id]}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ConditionalLayout>
  );
}
