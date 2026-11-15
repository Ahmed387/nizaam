import { Checkbox } from "@/components/ui/checkbox";

/** «استبعاد الصفر» checkbox (owner 2026-11-15) — state from `useHideZero` (src/lib/hideZero.ts). */
export function HideZeroToggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none whitespace-nowrap rounded-md border px-3 h-9 bg-background">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}
