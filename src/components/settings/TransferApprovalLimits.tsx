import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";
import { Loader2, Save, ShieldCheck } from "lucide-react";

/**
 * «موافقة المالك على التحويلات» (0285, owner 2026-11-25): a transfer between branches above these amounts, sent by
 * anyone but the owner, waits on «طلبات الموافقة» — nothing moves until he approves. 0 = no approval.
 * Goods are valued at the sending branch's average cost. Only the owner changes them.
 */
export function TransferApprovalLimits() {
  const { isOwner } = useAuth();
  const [money, setMoney] = useState("0");
  const [goods, setGoods] = useState("0");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.rpc("get_transfer_approval_limits" as any).then(({ data }) => {
      if (data) { setMoney(String(Number((data as any).money) || 0)); setGoods(String(Number((data as any).goods) || 0)); }
    });
  }, []);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("set_transfer_approval_limits" as any, { p_money: Number(money) || 0, p_goods: Number(goods) || 0 } as any);
    setBusy(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success("اتحفظ حد الموافقة");
  };
  const line = (v: string, what: string) => (Number(v) > 0
    ? `أي ${what} فوق ${Number(v).toLocaleString("en-US")} ج.م من غيرك هيستناك توافق عليه في «طلبات الموافقة»، ومفيش حاجة بتتحرك لحد ما توافق.`
    : `${what} من غير موافقة — مهما كان المبلغ.`);
  return (
    <div className="card-elevated p-4 space-y-3" data-testid="transfer-limits">
      <div className="flex items-center gap-2 font-extrabold"><ShieldCheck className="w-5 h-5 text-primary" /> موافقة المالك على التحويلات بين الفروع</div>
      <p className="text-xs text-muted-foreground">0 = من غير موافقة. البضاعة بتتحسب بمتوسط تكلفتها في الفرع المرسل. التحويل اللي بتعمله إنت مش بيستنى.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>تحويل فلوس فوق (ج.م)</Label>
          <Input type="number" min={0} value={money} disabled={!isOwner} onChange={(e) => setMoney(e.target.value)} className="mt-1.5" />
          <p className="text-xs text-muted-foreground mt-1">{line(money, "تحويل فلوس")}</p>
        </div>
        <div>
          <Label>تحويل بضاعة قيمتها فوق (ج.م)</Label>
          <Input type="number" min={0} value={goods} disabled={!isOwner} onChange={(e) => setGoods(e.target.value)} className="mt-1.5" />
          <p className="text-xs text-muted-foreground mt-1">{line(goods, "تحويل بضاعة")}</p>
        </div>
      </div>
      {isOwner
        ? <Button onClick={save} disabled={busy} className="gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ</Button>
        : <p className="text-xs text-muted-foreground">صاحب الشركة بس اللي يغير الحد ده.</p>}
    </div>
  );
}
