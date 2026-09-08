import { useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/ProductImage";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { PRODUCT_BUCKET } from "@/lib/productImage";
import { cn } from "@/lib/utils";

interface ClickableImagePreviewProps {
  src: string | null | undefined;
  alt?: string;
  title?: string;
  bucket?: string;
  className?: string;
  buttonClassName?: string;
  fallback?: ReactNode;
}

export function ClickableImagePreview({
  src,
  alt = "",
  title,
  bucket = PRODUCT_BUCKET,
  className,
  buttonClassName,
  fallback,
}: ClickableImagePreviewProps) {
  const [open, setOpen] = useState(false);

  if (!src) return <>{fallback ?? null}</>;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={cn("group relative h-auto w-auto shrink-0 cursor-zoom-in overflow-hidden p-0 hover:bg-transparent", buttonClassName)}
        title={`تكبير صورة ${title || alt || "المنتج"}`}
        aria-label={`تكبير صورة ${title || alt || "المنتج"}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <ProductImage
          src={src}
          bucket={bucket}
          alt={alt || title || "صورة المنتج"}
          className={cn("cursor-zoom-in object-cover transition-opacity group-hover:opacity-90", className)}
        />
        <span className="pointer-events-none absolute bottom-1 start-1 rounded bg-background/80 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 className="h-3 w-3" />
        </span>
      </Button>
      <ImagePreviewModal open={open} onOpenChange={setOpen} src={src} bucket={bucket} title={title} alt={alt} />
    </>
  );
}

export default ClickableImagePreview;