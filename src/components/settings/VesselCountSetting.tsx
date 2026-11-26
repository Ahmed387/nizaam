import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchVesselCountMode, setVesselCountMode, type VesselCountMode } from "@/lib/vesselCount";
import { rpcErrorText } from "@/lib/rpcError";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MODES: { value: VesselCountMode; title: string; text: string }[] = [
  { value: "owner", title: "المالك بس", text: "إنت بس اللي بتعدّ الوعاء وتختار الفرق يتسجل إزاي — بيتسجل على طول." },
  { value: "approval", title: "الموظف يعدّ والمالك يوافق", text: "اللي معاه صلاحية «تسوية الوعاء» يعدّ ويبعتلك. الوعاء مش بيتغير غير لما توافق وتختار الفرق يتسجل إزاي." },
];

/** 0294: who does «تسوية الوعاء» — owner only. */
export function VesselCountSetting() {
  const { isOwner, tenantId } = useAuth();
  const [mode, setMode] = useState<VesselCountMode | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (tenantId) fetchVesselCountMode(tenantId).then(setMode); }, [tenantId]);
  if (!isOwner) return null;
  const choose = async (m: VesselCountMode) => {
    if (m === mode || saving) return;
    setSaving(true);
    try { await setVesselCountMode(m); setMode(m); toast.success(`تسوية الوعاء: ${MODES.find((x) => x.value === m)!.title}`); }
    catch (e: any) { toast.error(rpcErrorText(e, "إعداد تسوية الوعاء")); }
    finally { setSaving(false); }
  };
  return (
    <div className="card-elevated p-6 space-y-3 max-w-2xl mx-auto" data-testid="vessel-count-setting">
      <div className="font-bold">تسوية الوعاء — مين يعدّ الفلوس الفعلية؟</div>
      <p className="text-xs text-muted-foreground">
        التسوية بتخلّي رصيد الوعاء في السيستم (الكاش، فودافون، إنستاباي…) زي الفلوس اللي معاك فعلاً. العجز أو الزيادة إنت اللي بتختار يتسجلوا إزاي كل مرة.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((m) => (
          <button key={m.value} type="button" disabled={saving || mode === null} onClick={() => choose(m.value)} data-testid={`vc-mode-${m.value}`}
            className={cn("rounded-lg border p-3 text-right", mode === m.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-background hover:bg-muted/50")}>
            <div className="font-semibold text-sm">{m.title}{mode === m.value ? " ✓" : ""}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-5">{m.text}</div>
          </button>
        ))}
      </div>
      {mode === "approval" && <p className="text-xs text-muted-foreground">الصلاحية بتتفتح لكل موظف من الإعدادات ← الموظفين ← «تسوية الوعاء». مدير الفرع معاه افتراضياً.</p>}
    </div>
  );
}
