import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PauseCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

/** Shown to an employee whose branches are all paused by the platform owner (migration 0109). */
export default function BranchPaused() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [paused, setPaused] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    // The paused branch row is hidden from employees (0109/0113), so its name comes from this RPC.
    supabase
      .rpc("my_paused_branches" as any)
      .then(({ data }) => {
        setPaused(((data ?? []) as any[]).map((b) => b.name as string));
      });
  }, [user]);

  const leave = async () => {
    await signOut();
    nav("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6" dir="rtl">
      <div className="card-elevated max-w-lg w-full p-8 flex flex-col items-start gap-4">
        <PauseCircle className="w-10 h-10 text-destructive" aria-hidden="true" />
        <h1 className="text-2xl font-extrabold">
          {paused.length ? `فرع ${paused.join(" و ")} موقوف مؤقتاً` : "مفيش فرع شغال على حسابك"}
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          {paused.length
            ? "مش هتقدر تدخل الفرع لحد ما إدارة المنصة تشغّله تاني. بيانات الفرع كلها محفوظة."
            : "حسابك مش مربوط بأي فرع شغال دلوقتي. كلّم صاحب الشركة."}
        </p>
        <Button variant="outline" onClick={leave}>تسجيل خروج</Button>
      </div>
    </div>
  );
}
