import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertOctagon, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function Suspended() {
  const [params] = useSearchParams();
  const [name, setName] = useState<string>(params.get("name") ?? "");
  const [reason, setReason] = useState<string>("");

  useEffect(() => {
    const slug = params.get("slug");
    if (!slug) return;
    supabase
      .from("tenants")
      .select("name, suspension_reason")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setName((d) => data.name ?? d);
          setReason(data.suspension_reason ?? "");
        }
      });
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-warning/5 via-background to-destructive/5 p-6" dir="rtl">
      <div className="card-elevated max-w-lg w-full p-8 text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-warning/15 flex items-center justify-center mb-5">
          <AlertOctagon className="w-12 h-12 text-warning" />
        </div>
        <h1 className="text-2xl font-extrabold mb-2">تم إيقاف اشتراك شركتك مؤقتاً</h1>
        {name && <div className="text-lg font-semibold text-primary mb-3">{name}</div>}
        <p className="text-muted-foreground mb-2">
          للاستمرار في استخدام النظام، يرجى سداد قيمة الاشتراك والتواصل مع الإدارة.
        </p>
        {reason && (
          <div className="mt-4 p-3 rounded-lg bg-muted text-sm text-right">
            <b>سبب الإيقاف: </b>{reason}
          </div>
        )}
        <Button asChild className="mt-6 gap-2">
          <a href="https://wa.me/201000000000" target="_blank" rel="noreferrer">
            <Phone className="w-4 h-4" /> تواصل مع الدعم
          </a>
        </Button>
      </div>
    </div>
  );
}
