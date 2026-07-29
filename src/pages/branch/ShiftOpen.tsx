import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Loader2, DoorOpen, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { getOpenShift, openShift } from "@/lib/shifts";
import { formatEGP } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";

export default function ShiftOpen() {
  const { id: branchId = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const returnTo = (loc.state as any)?.returnTo as string | undefined;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [existing, setExisting] = useState<any>(null);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      try {
        const s = await getOpenShift(branchId);
        setExisting(s);
      } catch (e: any) {
        toast.error(e.message ?? "خطأ في قراءة الوردية");
      } finally {
        setLoading(false);
      }
    })();
  }, [branchId, user?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await openShift(branchId, Number(openingCash) || 0, notes || undefined);
      toast.success("تم فتح الوردية");
      nav(returnTo || `/branch/${branchId}/sales/new`, { replace: true });
    } catch (e: any) {
      toast.error(e.message ?? "فشل فتح الوردية");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <BranchLayout><div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></BranchLayout>;
  }

  if (existing) {
    return (
      <BranchLayout>
        <PageHeader title="وردية الكاشير" subtitle="لديك وردية مفتوحة بالفعل" />
        <Card className="p-6 max-w-xl mx-auto space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-muted-foreground">تاريخ الفتح</div><div className="font-semibold">{new Date(existing.opened_at).toLocaleString("ar-EG")}</div></div>
            <div><div className="text-muted-foreground">الرصيد الافتتاحي</div><div className="font-semibold">{formatEGP(existing.opening_cash)}</div></div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => nav(`/branch/${branchId}/sales/new`)}>
              <ShoppingCart className="w-4 h-4 me-2" />بدء البيع
            </Button>
            <Button variant="outline" onClick={() => nav(`/branch/${branchId}/shifts/close`)}>قفل الوردية</Button>
          </div>
        </Card>
      </BranchLayout>
    );
  }

  return (
    <BranchLayout>
      <PageHeader title="فتح وردية جديدة" subtitle="أدخل رصيد الدرج الافتتاحي قبل بدء البيع" />
      <Card className="p-6 max-w-xl mx-auto">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>الرصيد الافتتاحي في الدرج (جنيه)</Label>
            <Input
              type="number" min={0} step="0.01" required
              value={openingCash}
              onChange={(e) => setOpeningCash(Number(e.target.value))}
              className="mt-1.5 text-lg"
              autoFocus
            />
          </div>
          <div>
            <Label>ملاحظات (اختياري)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
          </div>
          <Button type="submit" disabled={busy} className="w-full h-11">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><DoorOpen className="w-4 h-4 me-2" />فتح الوردية</>)}
          </Button>
        </form>
      </Card>
    </BranchLayout>
  );
}
