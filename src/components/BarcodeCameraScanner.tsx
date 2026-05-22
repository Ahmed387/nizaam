import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Camera, X, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onScan: (code: string) => void;
  continuous?: boolean; // keep scanning after a hit
}

export function BarcodeCameraScanner({ open, onOpenChange, onScan, continuous = true }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const lastEmittedRef = useRef<{ code: string; at: number } | null>(null);

  // Enumerate cameras
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        // Need a permission grant first to get labels
        await navigator.mediaDevices.getUserMedia({ video: true });
        const list = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(list);
        // prefer back camera if labeled
        const back = list.find((d) => /back|rear|environment/i.test(d.label));
        setDeviceId((prev) => prev ?? back?.deviceId ?? list[0]?.deviceId);
      } catch (e: any) {
        setError(e?.message ?? "تعذر فتح الكاميرا");
      }
    })();
  }, [open]);

  // Start scanning
  useEffect(() => {
    if (!open) return;
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;
    (async () => {
      try {
        const constraints: MediaStreamConstraints = deviceId
          ? { video: { deviceId: { exact: deviceId } } }
          : { video: { facingMode: { ideal: "environment" } } };
        const ctrl = await reader.decodeFromConstraints(constraints, videoRef.current!, (result, err) => {
          if (cancelled) return;
          if (result) {
            const code = result.getText();
            const now = Date.now();
            // debounce duplicate scans within 1.5s
            if (lastEmittedRef.current && lastEmittedRef.current.code === code && now - lastEmittedRef.current.at < 1500) return;
            lastEmittedRef.current = { code, at: now };
            setLastCode(code);
            onScan(code);
            if (!continuous) {
              onOpenChange(false);
            }
          }
        });
        controlsRef.current = ctrl;
      } catch (e: any) {
        setError(e?.message ?? "تعذر بدء المسح");
      }
    })();
    return () => {
      cancelled = true;
      try { controlsRef.current?.stop(); } catch {}
      controlsRef.current = null;
    };
  }, [open, deviceId, continuous, onOpenChange, onScan]);

  const switchCamera = () => {
    if (devices.length < 2) return toast.info("لا توجد كاميرات إضافية");
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(idx + 1) % devices.length];
    setDeviceId(next.deviceId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" /> مسح الباركود بالكاميرا
          </DialogTitle>
        </DialogHeader>

        <div className="relative bg-black aspect-[3/4]">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
          {/* Aiming frame */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-4/5 h-1/3 border-2 border-primary/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-destructive-foreground bg-destructive/80 text-sm">
              {error}
            </div>
          )}
          {lastCode && (
            <div className="absolute bottom-2 inset-x-2 bg-success/90 text-success-foreground text-xs font-mono p-2 rounded text-center" dir="ltr">
              ✓ {lastCode}
            </div>
          )}
        </div>

        <div className="p-3 flex items-center justify-between gap-2 bg-card">
          <Button variant="outline" size="sm" onClick={switchCamera} disabled={devices.length < 2} className="gap-1">
            <RotateCcw className="w-4 h-4" /> تبديل الكاميرا
          </Button>
          <div className="text-xs text-muted-foreground text-center flex-1">
            {continuous ? "وجّه الكاميرا للباركود — مسح متتالي" : "وجّه الكاميرا للباركود"}
          </div>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} className="gap-1">
            <X className="w-4 h-4" /> إغلاق
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
