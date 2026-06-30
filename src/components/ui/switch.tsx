import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

export type SwitchVariant = "default" | "premium";

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  variant?: SwitchVariant;
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, variant = "default", ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      variant === "default" && "h-6 w-11 overflow-hidden data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      variant === "premium" && "h-7 w-14 overflow-hidden border border-border bg-muted data-[state=checked]:bg-success/20 data-[state=checked]:border-success/40",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform",
        variant === "default" && "h-5 w-5 ltr:data-[state=checked]:translate-x-5 ltr:data-[state=unchecked]:translate-x-0 rtl:data-[state=checked]:-translate-x-5 rtl:data-[state=unchecked]:translate-x-0",
        variant === "premium" && "h-5 w-5 data-[state=checked]:-translate-x-7 data-[state=unchecked]:-translate-x-1 data-[state=checked]:bg-success data-[state=checked]:shadow-[0_0_8px_hsl(var(--success)/0.45)]",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

