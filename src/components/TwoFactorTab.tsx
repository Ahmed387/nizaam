import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Loader2, ShieldCheck, ShieldOff, KeyRound } from "lucide-react";

export function TwoFactorTab() {
  const [factors, setFactors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [factorId, setFactorId] = useState<string>("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const startEnroll = async () => {
    setEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setFactorId(data.id);
      setSecret(data.totp.secret);
      const url = await QRCode.toDataURL(data.totp.uri, { width: 220, margin: 1 });
      setQrDataUrl(url);
    } catch (e: any) {
      toast.error(e.message ?? "فشل بدء التفعيل");
    } finally {
      setEnrolling(false);
    }
  };

  const verify = async () => {
    if (!code || code.length < 6) return toast.error("اكتب الكود المكوّن من 6 أرقام");
    setVerifying(true);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const { error } = await supabase.auth.mfa.verify({
        factorId, challengeId: challenge.data.id, code,
      });
      if (error) throw error;
      toast.success("تم تفعيل المصادقة الثنائية ✅");
      setQrDataUrl(""); setSecret(""); setFactorId(""); setCode("");
      load();
    } catch (e: any) {
      toast.error(e.message ?? "كود غير صحيح");
    } finally {
      setVerifying(false);
    }
  };

  const removeFactor = async (id: string) => {
    if (!confirm("تأكيد إلغاء المصادقة الثنائية؟ ده هيقلل من حماية حسابك.")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء التفعيل");
    load();
  };

  const verifiedFactors = factors.filter((f) => f.status === "verified");

  if (loading) {
    return <div className="card-elevated p-6 max-w-2xl mx-auto flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <div>
          <h2 className="font-bold">المصادقة الثنائية (2FA)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            أضف طبقة حماية إضافية بكلمة مرور مؤقتة من تطبيق مثل Google Authenticator أو Microsoft Authenticator.
          </p>
        </div>
      </div>

      {verifiedFactors.length > 0 ? (
        <div className="space-y-3">
          <div className="p-4 rounded-lg bg-success/10 border border-success/30 flex items-center gap-2 text-success">
            <ShieldCheck className="w-5 h-5" />
            <span className="font-semibold">المصادقة الثنائية مُفعّلة على حسابك</span>
          </div>
          {verifiedFactors.map((f) => (
            <div key={f.id} className="flex items-center justify-between p-3 rounded border">
              <div className="text-sm">
                <div className="font-medium">{f.friendly_name || "Authenticator App"}</div>
                <div className="text-xs text-muted-foreground">مُفعّل منذ {new Date(f.created_at).toLocaleDateString("ar-EG")}</div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => removeFactor(f.id)} className="gap-1">
                <ShieldOff className="w-4 h-4" /> إلغاء
              </Button>
            </div>
          ))}
        </div>
      ) : qrDataUrl ? (
        <div className="space-y-4 p-4 rounded-lg bg-surface-2">
          <div className="text-center">
            <p className="text-sm mb-3">١) امسح الكود ده بتطبيق المصادقة على موبايلك:</p>
            <img src={qrDataUrl} alt="QR Code" className="mx-auto rounded bg-white p-2" />
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">أو اكتب المفتاح يدويًا</summary>
              <code className="block mt-2 p-2 bg-background rounded text-sm font-mono break-all" dir="ltr">{secret}</code>
            </details>
          </div>
          <div>
            <Label>٢) اكتب الكود اللي ظاهر في التطبيق</Label>
            <Input
              dir="ltr"
              maxLength={6}
              className="text-center text-2xl tracking-widest mt-1.5"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={verify} disabled={verifying} className="flex-1 gap-2">
              {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              تأكيد وتفعيل
            </Button>
            <Button variant="outline" onClick={() => { setQrDataUrl(""); setSecret(""); setFactorId(""); }}>إلغاء</Button>
          </div>
        </div>
      ) : (
        <Button onClick={startEnroll} disabled={enrolling} className="gap-2" size="lg">
          {enrolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          تفعيل المصادقة الثنائية
        </Button>
      )}
    </div>
  );
}
