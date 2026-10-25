import * as React from "react";

import { cn } from "@/lib/utils";
import { AutoPart } from "@/contexts/PermCustomize";

/** The text of the first <CardTitle> inside (permissions 0114: a Card on a catalogue page is switchable by its title). */
function titleOf(node: React.ReactNode, depth = 0): string | null {
  if (depth > 5 || node == null || typeof node === "boolean") return null;
  if (Array.isArray(node)) {
    for (const n of node) { const t = titleOf(n, depth + 1); if (t) return t; }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const el = node as React.ReactElement<any>;
  if (el.type === CardTitle) {
    const flat = (n: React.ReactNode): string =>
      typeof n === "string" || typeof n === "number" ? String(n)
        : Array.isArray(n) ? n.map(flat).join("")
        : React.isValidElement(n) ? flat((n.props as any).children) : "";
    return flat(el.props.children).replace(/\s+/g, " ").trim() || null;
  }
  return titleOf(el.props?.children, depth + 1);
}

/** A KPI card without <CardTitle>: its first small label line («إجمالي العجز/الزيادة» …). */
function labelOf(children: React.ReactNode): string | null {
  const first = React.Children.toArray(children).find((c) => React.isValidElement(c)) as React.ReactElement<any> | undefined;
  const cls = String(first?.props?.className ?? "");
  if (!first || !/\btext-(xs|sm)\b/.test(cls)) return null;
  const flat = (n: React.ReactNode): string =>
    typeof n === "string" || typeof n === "number" ? String(n)
      : Array.isArray(n) ? n.map(flat).join("")
      : React.isValidElement(n) ? flat((n.props as any).children) : "";
  const t = flat(first.props.children).replace(/\s+/g, " ").trim();
  return t && t.length <= 60 ? t : null;
}

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <AutoPart prefix="card" label={titleOf(props.children) ?? labelOf(props.children)}>
    <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
  </AutoPart>
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
