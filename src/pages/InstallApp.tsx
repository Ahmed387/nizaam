import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Smartphone, Apple, Share, Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallApp() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Already installed (running standalone)
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-ignore iOS
      window.navigator.standalone === true;
    if (standalone) setInstalled(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      toast.success("تم تثبيت التطبيق بنجاح");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) {
      toast.info("افتح قائمة المتصفح واختار «تثبيت التطبيق» أو «إضافة للشاشة الرئيسية»");
      return;
    }
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferred(null);
  };

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isAndroid = /Android/.test(ua);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
      <div className="max-w-lg w-full card-elevated p-8 space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Smartphone className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">تثبيت تطبيق Nexa Store</h1>
          <p className="text-muted-foreground text-sm mt-2">
            ثبّت التطبيق على هاتفك أو جهازك علشان تشتغل أسرع وزي التطبيق الأصلي
          </p>
        </div>

        {installed ? (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-success/10 text-success border border-success/30">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-semibold">التطبيق مُثبّت بالفعل على هذا الجهاز</span>
          </div>
        ) : (
          <>
            {deferred && (
              <Button onClick={install} className="w-full gap-2 btn-gradient" size="lg">
                <Download className="w-5 h-5" />
                تثبيت الآن
              </Button>
            )}

            {isIOS && (
              <div className="space-y-3 p-4 rounded-lg bg-surface-2 border">
                <div className="flex items-center gap-2 font-semibold">
                  <Apple className="w-5 h-5" /> على iPhone / iPad (Safari)
                </div>
                <ol className="space-y-2 text-sm list-decimal pr-5">
                  <li>اضغط زرار المشاركة <Share className="w-4 h-4 inline" /> أسفل المتصفح</li>
                  <li>اختار «إضافة إلى الشاشة الرئيسية» <Plus className="w-4 h-4 inline" /></li>
                  <li>اضغط «إضافة» — هتلاقي الأيقونة على الشاشة الرئيسية</li>
                </ol>
              </div>
            )}

            {isAndroid && (
              <div className="space-y-3 p-4 rounded-lg bg-surface-2 border">
                <div className="flex items-center gap-2 font-semibold">
                  <Smartphone className="w-5 h-5" /> على Android (Chrome)
                </div>
                <ol className="space-y-2 text-sm list-decimal pr-5">
                  <li>افتح قائمة المتصفح ⋮ أعلى يمين الصفحة</li>
                  <li>اختار «تثبيت التطبيق» أو «إضافة للشاشة الرئيسية»</li>
                  <li>أكد التثبيت — التطبيق هيظهر زي أي تطبيق عادي</li>
                </ol>
              </div>
            )}

            {!isIOS && !isAndroid && !deferred && (
              <div className="p-4 rounded-lg bg-surface-2 border text-sm">
                افتح الصفحة على الموبايل (Android / iPhone) للتثبيت، أو من قائمة Chrome على الديسكتوب اختار «تثبيت Nexa Store».
              </div>
            )}
          </>
        )}

        <div className="text-xs text-muted-foreground text-center pt-4 border-t">
          المميزات بعد التثبيت: فتح أسرع · يعمل بدون شريط المتصفح · يظهر زي تطبيق أصلي على الشاشة الرئيسية
        </div>
      </div>
    </div>
  );
}
