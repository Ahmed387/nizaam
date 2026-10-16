import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { VoucherViewDialog } from "@/components/VoucherViewDialog";
import { VoucherDialog } from "@/components/VoucherDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** A voucher on its own address, so «فتح الكل» can open receipt / payment vouchers as tabs. */
export default function VoucherView() {
  const { id: branchId, voucherId } = useParams<{ id: string; voucherId: string }>();
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [v, setV] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState<{ v: any; focus: boolean } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    supabase.from("vouchers" as any).select("*, voucher_categories(name, system_key)").eq("id", voucherId!).maybeSingle()
      .then(({ data }) => { if (!alive) return; if (data) setV(data); else setMissing(true); });
    return () => { alive = false; };
  }, [voucherId, tick]);

  const back = () => nav(`/branch/${branchId}/invoices?tab=${v?.type === "payment" ? "expense" : "income"}`);

  return (
    <BranchLayout>
      {missing && <div className="p-8 text-center text-muted-foreground">السند مش موجود أو مش مسموح لك تشوفه</div>}
      {!v && !missing && <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>}
      {v && !edit && (
        <VoucherViewDialog voucher={v} open onOpenChange={(o) => { if (!o) back(); }} categoryName={v.voucher_categories?.name}
          onEdit={isAdmin ? (x, focus) => setEdit({ v: x, focus: !!focus }) : undefined} />
      )}
      {edit && (
        <VoucherDialog open onOpenChange={(o) => { if (!o) setEdit(null); }} branchId={edit.v.branch_id}
          type={edit.v.type} editingVoucher={edit.v} focusDate={edit.focus} onSuccess={() => { setEdit(null); setTick((t) => t + 1); }} />
      )}
    </BranchLayout>
  );
}
