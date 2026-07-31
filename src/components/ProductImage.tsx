import { useEffect, useState } from "react";
import { getSignedProductImageUrl } from "@/lib/productImage";

/** هوك يرجّع لينك مؤقت (Signed URL) لصورة منتج مخزّنة في bucket خاص. */
export function useSignedImage(value: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!value) { setUrl(null); return; }
    getSignedProductImageUrl(value).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [value]);

  return url;
}

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  /** القيمة المخزّنة في قاعدة البيانات (لينك قديم أو مسار) */
  src: string | null | undefined;
  /** بديل يظهر لحد ما اللينك يجهز أو لو الصورة مش موجودة */
  fallback?: React.ReactNode;
}

/** صورة منتج بتتحمّل عن طريق Signed URL مؤقت بدل اللينك العام. */
export function ProductImage({ src, fallback = null, alt = "", className, ...rest }: Props) {
  const signed = useSignedImage(src);
  if (!src) return <>{fallback}</>;
  if (!signed) return <>{fallback ?? <div className={className} />}</>;
  return <img src={signed} alt={alt} className={className} {...rest} />;
}

export default ProductImage;
