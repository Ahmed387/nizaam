import { useEffect, useState } from "react";
import { getSignedUrl } from "@/lib/storageImage";
import { PRODUCT_BUCKET } from "@/lib/productImage";
import { ImageOff } from "lucide-react";

/** هوك يرجّع لينك مؤقت (Signed URL) لصورة مخزّنة في bucket خاص، مع تجديد تلقائي. */
export function useSignedImage(value: string | null | undefined, bucket: string = PRODUCT_BUCKET) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (!value) { setUrl(null); return; }
    // no link = the file isn't there: show the «no image» box instead of a loading box forever
    getSignedUrl(bucket, value).then((u) => { if (alive) { setUrl(u); if (!u) setFailed(true); } });
    return () => { alive = false; };
  }, [value, bucket]);

  /** يعيد التوقيع فوراً عند انتهاء صلاحية الرابط أو فشل التحميل. */
  const refresh = async () => {
    const u = await getSignedUrl(bucket, value, { force: true });
    if (u) { setUrl(u); setFailed(false); } else { setFailed(true); }
    return u;
  };

  return { url, failed, refresh, setFailed };
}

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
  bucket?: string;
  fallback?: React.ReactNode;
}

/** صورة بتتحمّل عن طريق Signed URL مؤقت مع إعادة توقيع تلقائية عند الفشل. */
export function ProductImage({ src, bucket = PRODUCT_BUCKET, fallback, alt = "", className, ...rest }: Props) {
  const { url, failed, refresh, setFailed } = useSignedImage(src, bucket);
  const [retried, setRetried] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setRetried(false); setLoaded(false); }, [src]);

  const errorBox = fallback ?? (
    <div className={`${className ?? ""} bg-muted/40 border border-dashed flex items-center justify-center text-muted-foreground`}>
      <ImageOff className="w-4 h-4" />
    </div>
  );

  if (!src) return <>{fallback ?? null}</>;
  if (failed) return <>{errorBox}</>;

  // هيكل تحميل ناعم بدون إخفاء العنصر (display:none يمنع التحميل الكسول من العمل)
  if (!url) return <div className={`${className ?? ""} bg-muted/40 animate-pulse`} aria-hidden />;

  return (
    <img
      src={url}
      alt={alt}
      className={`${className ?? ""} ${loaded ? "" : "bg-muted/40 animate-pulse"}`}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (retried) { setFailed(true); return; }
        setRetried(true);
        setLoaded(false);
        refresh();
      }}
      {...rest}
    />
  );

}

export default ProductImage;
