import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";

interface Req {
  id: string; tenant_id: string; requested_by_name: string | null; branch_name: string | null; note: string | null;
  limit_at_request: number; branches_at_request: number; status: "pending" | "approved" | "rejected";
  new_limit: number | null; created_at: string; decided_at: string | null;
}

/** Platform owner: branch-increase requests from companies at their limit (migration 0109). */
export default function BranchRequests() {
  const [rows, setRows] = useState<Req[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    const [r, t] = await Promise.all([
      supabase.from("branch_limit_requests" as any).select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("tenants").select("id, name"),
    ]);
    if (r.error) setErr(rpcErrorText(r.error as any, "طلبات الفروع")); else setErr("");
    setRows(((r.data ?? []) as any[]) as Req[]);
    setNames(Object.fromEntries(((t.data ?? []) as any[]).map((x) => [x.id, x.name])));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const decide = async (q: Req, approve: boolean, newLimit?: number) => {
    setBusy(q.id);
    const { data, error } = await supabase.rpc("super_decide_branch_request" as any, {
      p_request: q.id, p_approve: approve, p_new_limit: newLimit ?? null,
    } as any);
    setBusy(null);
    if (error) return toast.error(rpcErrorText(error, "الرد على الطلب"));
    toast.success(approve ? `اتوافق — الحد بقى ${(data as any)?.new_limit} فروع` : "اترفض الطلب");
    load();
  };

  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");

  return (
    <SuperAdminLayout>
      <PageHeader title="طلبات زيادة الفروع" subtitle={`${pending.length} مستني ردّك`} />
      {err && <div className="card-elevated p-4 mb-4 text-destructive">{err}</div>}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <div className="grid gap-4">
          {pending.length === 0 && <div className="card-elevated p-8 text-center text-muted-foreground">مفيش طلبات مستنية دلوقتي.</div>}
          {pending.map((q) => {
            const val = custom[q.id] ?? String(q.limit_at_request + 1);
            return (
              <article key={q.id} className="card-elevated p-5 grid gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Link to={`/super/tenants/${q.tenant_id}`} className="text-lg font-extrabold hover:text-primary">{names[q.tenant_id] ?? "شركة"}</Link>
                  <Badge className="bg-warning text-warning-foreground">مستني ردّك</Badge>
                  <span className="mr-auto text-sm text-muted-foreground">طلبه {q.requested_by_name ?? "صاحب الشركة"} — {new Date(q.created_at).toLocaleString("ar-EG")}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/50 p-3"><div className="text-xs text-muted-foreground font-semibold">الفروع وقت الطلب</div><div className="text-xl font-extrabold tabular-nums">{q.branches_at_request} من {q.limit_at_request}</div></div>
                  <div className="rounded-lg bg-muted/50 p-3"><div className="text-xs text-muted-foreground font-semibold">الفرع المطلوب</div><div className="font-bold">{q.branch_name ?? "—"}</div></div>
                  <div className="rounded-lg bg-muted/50 p-3"><div className="text-xs text-muted-foreground font-semibold">ملاحظته</div><div>{q.note ?? "—"}</div></div>
                </div>
                <div className="flex flex-wrap items-end gap-2 border-t pt-4">
                  <Button className="bg-success text-success-foreground hover:bg-success/90" disabled={busy === q.id} onClick={() => decide(q, true)}>
                    <Check className="w-4 h-4 ml-1" /> موافقة — يبقى {q.limit_at_request + 1} فروع
                  </Button>
                  <Button variant="outline" disabled={busy === q.id} onClick={() => decide(q, false)}><X className="w-4 h-4 ml-1" /> رفض</Button>
                  <div className="mr-auto flex items-end gap-2">
                    <div className="grid gap-1">
                      <Label htmlFor={`lim-${q.id}`}>أو حدد العدد بنفسك</Label>
                      <Input id={`lim-${q.id}`} type="number" min={q.branches_at_request + 1} dir="ltr" className="w-28" value={val}
                        onChange={(e) => setCustom({ ...custom, [q.id]: e.target.value })} />
                    </div>
                    <Button variant="outline" className="border-primary text-primary" disabled={busy === q.id}
                      onClick={() => {
                        const n = Number(val);
                        if (!Number.isInteger(n) || n <= q.branches_at_request) return toast.error(`العدد لازم يكون أكبر من ${q.branches_at_request}`);
                        decide(q, true, n);
                      }}>موافقة بالعدد ده</Button>
                  </div>
                </div>
              </article>
            );
          })}

          {done.length > 0 && (
            <section className="grid gap-2">
              <h2 className="text-base font-extrabold text-muted-foreground">طلبات قديمة</h2>
              <div className="card-elevated overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr><th className="text-start p-3">الشركة</th><th className="text-start p-3">الفرع</th><th className="text-start p-3">الرد</th><th className="text-start p-3">التاريخ</th></tr>
                  </thead>
                  <tbody>
                    {done.map((q) => (
                      <tr key={q.id} className="border-t">
                        <td className="p-3 font-semibold">{names[q.tenant_id] ?? "—"}</td>
                        <td className="p-3">{q.branch_name ?? "—"}</td>
                        <td className="p-3">{q.status === "approved" ? `اتوافق (الحد ${q.new_limit})` : "اترفض"}</td>
                        <td className="p-3 text-muted-foreground">{q.decided_at ? new Date(q.decided_at).toLocaleDateString("ar-EG") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </SuperAdminLayout>
  );
}
