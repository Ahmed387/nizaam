import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { BellRing, CalendarClock, CheckCircle2, Loader2, PieChart } from "lucide-react";

const SETTING_KEY = "partner_capital_last_review";
const SHARES_LINK = "/admin/financial-position?tab=partners";

type ContributionRow = {
  id: string;
  amount: number;
  created_at: string;
  partner_name: string;
};

const fmt = (n: any) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-EG");

/**
 * تنبيهات مساهمات الشركاء — قراءة فقط من partner_transactions (نوع contribution)
 * ولا تمس محرك الأرصدة (v_partner_balances) ولا توزيع الأرباح (distribute_profits).
 *
 * mode="live"    : تنبيه لحظي بالمساهمات اللي حصلت بعد آخر مراجعة للنسب.
 * mode="monthly" : تذكير أول الشهر بمساهمات الشهر المنصرم اللي لسه النسب متراجعتش بعدها.
 */
export function PartnerContributionAlerts({ mode = "live" }: { mode?: "live" | "monthly" }) {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<ContributionRow[]>([]);
  const [lastReview, setLastReview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data: setting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", SETTING_KEY)
        .maybeSingle();
      const reviewedAt: string | null = (setting?.value as any)?.at ?? null;
      setLastReview(reviewedAt);

      const now = new Date();
      // فترة الفحص: من آخر مراجعة (أو أول الشهر المنصرم في وضع التذكير الشهري)
      const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

      let q = supabase
        .from("partner_transactions" as any)
        .select("id, amount, created_at, equity_partners(name)")
        .eq("tenant_id", tenantId)
        .eq("transaction_type", "contribution")
        .order("created_at", { ascending: false })
        .limit(10);

      if (mode === "monthly") {
        q = q.gte("created_at", prevMonthStart).lt("created_at", monthStart);
      }
      if (reviewedAt) q = q.gt("created_at", reviewedAt);

      const { data } = await q;
      setRows(
        ((data as any[]) ?? []).map((r) => ({
          id: r.id,
          amount: Number(r.amount || 0),
          created_at: r.created_at,
          partner_name: r.equity_partners?.name ?? "شريك",
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId, mode]);

  useEffect(() => { load(); }, [load]);

  const markReviewed = async () => {
    setSaving(true);
    const { error } = await supabase.from("settings").upsert({
      key: SETTING_KEY,
      value: { at: new Date().toISOString() } as any,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل مراجعة نسب رأس المال");
    load();
  };

  if (loading || rows.length === 0) return null;

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const isMonthly = mode === "monthly";

  return (
    <Card className={isMonthly ? "border-primary/40" : "border-warning/50"}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {isMonthly ? <CalendarClock className="w-4 h-4 text-primary" /> : <BellRing className="w-4 h-4 text-warning" />}
          {isMonthly ? "تذكير مطلع الشهر — مراجعة نسب رأس المال" : "مساهمات جديدة تستدعي مراجعة النسب"}
        </CardTitle>
        <Badge variant="outline">{rows.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-3" dir="rtl">
        {isMonthly && (
          <p className="text-sm text-muted-foreground">
            فيه مساهمات اتسجلت الشهر اللي فات ولسه نسب رأس المال متراجعتش بعدها. راجع النسب قبل توزيع الأرباح.
          </p>
        )}
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="text-sm leading-relaxed border-b border-border/50 last:border-0 pb-2 last:pb-0">
              قام الشريك <span className="font-semibold">{r.partner_name}</span> بإضافة مساهمة بقيمة{" "}
              <span className="font-mono font-semibold">{fmt(r.amount)}</span> ج.م بتاريخ {fmtDate(r.created_at)}، هل ترغب في مراجعة وتعديل نسب رأس المال؟
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-sm text-muted-foreground">
            إجمالي المساهمات غير المراجعة: <span className="font-mono font-semibold text-foreground">{fmt(total)}</span> ج.م
            {lastReview && <> — آخر مراجعة: {fmtDate(lastReview)}</>}
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link to={SHARES_LINK}>
                <PieChart className="w-4 h-4 ml-2" />
                تعديل نسب رأس المال
              </Link>
            </Button>
            <Button size="sm" variant="outline" onClick={markReviewed} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <CheckCircle2 className="w-4 h-4 ml-2" />}
              تمت المراجعة
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
