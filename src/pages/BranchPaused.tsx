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
    supabase
      .from("branch_users")
      .select("branches(name, platform_paused)")
      .eq("user_id", user.id)
      .then(({ data }) => {
        const names = (data ?? [])
          .map((r: any) => r.branches)
          .filter((b: any) => b?.platform_paused)
          .map((b: any) => b.name as string);
        setPaused(names);
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
