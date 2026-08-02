import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck, Percent, HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import ApprovalRequests from "./ApprovalRequests";
import AdminDiscountApprovals from "./AdminDiscountApprovals";
import AdminAdvanceApprovals from "./AdminAdvanceApprovals";

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="mr-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold">
      {n}
    </span>
  );
}

export default function AdminApprovalsHub() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const show = {
    approvals: can("admin_approvals_requests.view"),
    discounts: can("admin_approvals_discounts.view"),
    advances: can("admin_approvals_advances.view"),
  };
  const first = (Object.keys(show) as (keyof typeof show)[]).find((k) => show[k]) ?? "approvals";
  const requested = params.get("tab") as keyof typeof show | null;
  const tab = requested && show[requested] ? requested : first;
  const [counts, setCounts] = useState({ approvals: 0, discounts: 0, advances: 0 });

  const loadCounts = async () => {
    const [a, d, adv] = await Promise.all([
      supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("discount_approval_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("advance_requests").select("id", { count: "exact", head: true }).in("status", ["pending_admin", "approved_pending_funds"] as any),
    ]);
    setCounts({ approvals: a.count ?? 0, discounts: d.count ?? 0, advances: adv.count ?? 0 });
  };

  useEffect(() => {
    loadCounts();
    const ch = supabase
      .channel("approvals-hub-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests" }, loadCounts)
      .on("postgres_changes", { event: "*", schema: "public", table: "discount_approval_requests" }, loadCounts)
      .on("postgres_changes", { event: "*", schema: "public", table: "advance_requests" }, loadCounts)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <AdminLayout>
      <PageHeader title="مركز الموافقات" subtitle="طلبات الحذف/التعديل، الخصومات، وسلف الموظفين — كل الفروع في مكان واحد" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          {show.approvals && <TabsTrigger value="approvals" className="gap-1"><ShieldCheck className="w-4 h-4" /> طلبات الموافقة <CountBadge n={counts.approvals} /></TabsTrigger>}
          {show.discounts && <TabsTrigger value="discounts" className="gap-1"><Percent className="w-4 h-4" /> طلبات الخصم <CountBadge n={counts.discounts} /></TabsTrigger>}
          {show.advances && <TabsTrigger value="advances" className="gap-1"><HandCoins className="w-4 h-4" /> طلبات السلف <CountBadge n={counts.advances} /></TabsTrigger>}
        </TabsList>
        {show.approvals && <TabsContent value="approvals" className="mt-4"><ApprovalRequests embedded /></TabsContent>}
        {show.discounts && <TabsContent value="discounts" className="mt-4"><AdminDiscountApprovals embedded /></TabsContent>}
        {show.advances && <TabsContent value="advances" className="mt-4"><AdminAdvanceApprovals embedded /></TabsContent>}
      </Tabs>
    </AdminLayout>
  );
}
