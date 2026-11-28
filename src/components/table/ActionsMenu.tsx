import { useRef, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermCustomize } from "@/contexts/PermCustomize";
import { useActionMenu } from "@/components/table/RowActions";

/**
 * «⋮ إجراءات» for a page header (owner 2026-11-28 «اى اجراءات تكون فيها»): every button passed as children lives in ONE
 * menu, the same one the table rows use (`useActionMenu`). The buttons stay mounted and hidden, a menu item clicks the
 * real one — so permissions, owner-only buttons (they render nothing for others → no item) and their dialogs are
 * unchanged. A button whose own dialog asks for confirmation carries `data-own-confirm` (no second «تأكيد»).
 * In «افتح الصفحة وظبطها» mode the buttons show as they are, so each keeps its «ظاهر / مخفي» switch.
 */
export function ActionsMenu({ children, label = "إجراءات", testId = "page-actions" }: { children: ReactNode; label?: string; testId?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const menu = useActionMenu(`${testId}-menu`);
  const { active } = usePermCustomize();
  // customize mode, or a page / test that keeps buttons in place (`data-no-row-menu` on <html>, like the tables)
  const plain = active || (typeof document !== "undefined" && document.documentElement.hasAttribute("data-no-row-menu"));
  if (plain) return <div className="flex flex-wrap gap-2">{children}</div>;
  return (
    <div className="inline-flex items-center" data-am="">
      {/* the real buttons: hidden; shown for a moment only when one of them is a dropdown that needs a place */}
      <div ref={box} className="hidden flex-wrap gap-2 data-[ra-show]:flex" data-am-items="">{children}</div>
      <Button type="button" variant="outline" data-ra-button="" aria-haspopup="menu" aria-expanded={!!menu.open} data-testid={testId}
        onClick={(e) => { e.stopPropagation(); if (box.current) menu.toggle(box.current, e.currentTarget); }}>
        <MoreVertical className="w-4 h-4 ml-1" /> {label}
      </Button>
      {menu.panel}
    </div>
  );
}
