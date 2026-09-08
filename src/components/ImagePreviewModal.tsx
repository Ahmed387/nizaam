import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ProductImage } from "@/components/ProductImage";
import { PRODUCT_BUCKET } from "@/lib/productImage";

interface ImagePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string | null | undefined;
  title?: string;
  alt?: string;
  bucket?: string;
}

export function ImagePreviewModal({
  open,
  onOpenChange,
  src,
  title = "معاينة الصورة",
  alt = "",
  bucket = PRODUCT_BUCKET,
}: ImagePreviewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        overlayClassName="backdrop-blur-sm"
        className="max-w-[90vw] w-auto max-h-[92vh] border-0 bg-background/95 p-3 shadow-2xl"
      >
        <DialogTitle className="pe-10 text-sm">{title}</DialogTitle>
        <div className="flex min-h-40 items-center justify-center overflow-auto rounded-lg bg-muted/20 p-2">
          <ProductImage
            src={src}
            bucket={bucket}
            alt={alt || title}
            className="max-h-[85vh] max-w-[86vw] rounded-lg object-contain shadow-2xl"
            fallback={<div className="px-8 py-16 text-sm text-muted-foreground">تعذّر عرض الصورة</div>}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ImagePreviewModal;