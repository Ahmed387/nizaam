import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { CheckCircle2, AlertTriangle, XCircle, Info, Loader2 } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * تنبيهات ملوّنة وشفافة (مش Solid) — خلفية زجاجية بـ blur،
 * وبوردر جانبي بلون النوع، وأيقونة واضحة، وحركة دخول ناعمة.
 */
const base =
  "group toast pointer-events-auto flex items-center gap-3 w-full rounded-2xl border backdrop-blur-xl " +
  "shadow-[0_10px_40px_-12px_hsl(var(--foreground)/0.35)] px-4 py-3 text-sm font-medium " +
  "border-r-4 data-[mounted=true]:animate-enter";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      duration={4500}
      gap={10}
      offset={16}
      visibleToasts={4}
      icons={{
        success: <CheckCircle2 className="w-5 h-5 text-success" />,
        error: <XCircle className="w-5 h-5 text-destructive" />,
        warning: <AlertTriangle className="w-5 h-5 text-warning" />,
        info: <Info className="w-5 h-5 text-primary" />,
        loading: <Loader2 className="w-5 h-5 text-primary animate-spin" />,
      }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast: `${base} group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border`,
          success:
            "group-[.toaster]:bg-success/20 group-[.toaster]:border-success/50 group-[.toaster]:border-r-success group-[.toaster]:text-foreground",
          error:
            "group-[.toaster]:bg-destructive/20 group-[.toaster]:border-destructive/50 group-[.toaster]:border-r-destructive group-[.toaster]:text-foreground",
          warning:
            "group-[.toaster]:bg-warning/20 group-[.toaster]:border-warning/50 group-[.toaster]:border-r-warning group-[.toaster]:text-foreground",
          info:
            "group-[.toaster]:bg-primary/15 group-[.toaster]:border-primary/50 group-[.toaster]:border-r-primary group-[.toaster]:text-foreground",
          title: "group-[.toast]:font-bold group-[.toast]:leading-6 group-[.toast]:text-foreground",
          description: "group-[.toast]:text-foreground/80 group-[.toast]:text-xs group-[.toast]:leading-5",
          icon: "group-[.toast]:shrink-0",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-lg group-[.toast]:font-bold",
          cancelButton:
            "group-[.toast]:bg-muted/70 group-[.toast]:text-muted-foreground group-[.toast]:rounded-lg",
          closeButton:
            "group-[.toast]:bg-background/80 group-[.toast]:border-border/60 group-[.toast]:backdrop-blur",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
