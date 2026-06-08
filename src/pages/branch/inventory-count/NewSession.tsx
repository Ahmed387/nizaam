import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Navigate } from "react-router-dom";

export default function NewSession() {
  const { id: branchId } = useParams<{ id: string }>();
  const { isAdmin, hasRole, branches } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  if (!isAdmin && !hasRole("branch_manager")) {
    return <Navigate to={`/branch/${branchId}/inventory-count`} replace />;
  }

  const branch = branches.find((b) => b.id === branchId);

  const submit = async () => {
    if (!branchId) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("create_inventory_session" as any, {
      p_branch_id: branchId,
      p_notes: notes || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم فتح جلسة جرد جديدة — تم التقاط الكميات الحالية");
    navigate(`/branch/${branchId}/inventory-count/${data}/report`);
  };

  return (
    <ConditionalLayout
      title="بدء جرد جديد"
      subtitle="عند البدء يتم التقاط (Snapshot) لكميات المخزون الحالية"
    >
      <div className="card-elevated p-6 max-w-2xl space-y-5">
        <div>
          <Label>المخزن</Label>
          <div className="mt-2 p-3 rounded-lg bg-surface-2 border border-border font-semibold">
            {branch?.name ?? "—"}
          </div>
        </div>
        <div>
          <Label>ملاحظات (اختياري)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="أي ملاحظات تخص هذه الجلسة..."
            className="mt-2"
          />
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          ⚠️ بمجرد بدء الجلسة سيتم تثبيت كميات النظام لحظياً ولن تتأثر بأي مبيعات أو مشتريات لاحقة.
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => navigate(-1)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            بدء الجرد
          </Button>
        </div>
      </div>
    </ConditionalLayout>
  );
}
