import { forwardRef, Ref, TableHTMLAttributes, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { autoPartId, useCurrentPermPage, usePermCustomize } from "@/contexts/PermCustomize";
import { partKey } from "@/lib/permissionCatalog";

/**
 * A plain <table> whose columns the owner can show / hide per person and per branch (permissions 0114), like the
 * columns of DataTable. Drop-in: `<table …>` → `<PermTable …>`. Each header cell of the LAST header row is a part
 * «col_[<permTable>_]<hash of its text>» of the current catalogue page; a hidden column is removed with CSS
 * (header, body cells and <col>), cells with a colspan are never touched. In «افتح الصفحة وظبطها» every header
 * gets an eye button. Off a catalogue page it is an ordinary <table>.
 */
type Props = TableHTMLAttributes<HTMLTableElement> & { permTable?: string };

export const PermTable = forwardRef<HTMLTableElement, Props>(function PermTable({ permTable, ...props }, ref) {
  const page = useCurrentPermPage();
  if (!page) return <table ref={ref} {...props} />;
  return <PermTableInner page={page} permTable={permTable} tableRef={ref} {...props} />;
});

type Head = { el: HTMLTableCellElement; idx: number; label: string; key: string };
const FIXED = /^(#|✓|☑|)$/;

function PermTableInner({ page, permTable, tableRef, children, ...props }: Props & { page: string; tableRef: Ref<HTMLTableElement> }) {
  const { can } = useAuth();
  const c = usePermCustomize();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const own = useRef<HTMLTableElement | null>(null);
  const [heads, setHeads] = useState<Head[]>([]);
  const setRef = useCallback((el: HTMLTableElement | null) => {
    own.current = el;
    if (typeof tableRef === "function") tableRef(el);
    else if (tableRef) (tableRef as any).current = el;
  }, [tableRef]);

  // read the header after every render; update only when it really changed
  useLayoutEffect(() => {
    const t = own.current;
    if (!t) return;
    const rows = t.querySelectorAll(":scope > thead > tr");
    const row = rows[rows.length - 1];
    const next: Head[] = [];
    if (row) {
      let idx = 0;
      Array.from(row.children).forEach((cell) => {
        const th = cell as HTMLTableCellElement;
        idx += 1;
        const span = th.colSpan || 1;
        const label = (th.querySelector("[data-perm-label]")?.textContent ?? th.textContent ?? "").replace(/\s+/g, " ").trim();
        if (span === 1 && !FIXED.test(label)) {
          next.push({ el: th, idx, label, key: partKey(page, autoPartId(permTable ? `col_${permTable.toLowerCase().replace(/[^a-z0-9_]/g, "_")}` : "col", label)) });
        }
        idx += span - 1;
      });
    }
    const same = next.length === heads.length && next.every((h, i) => h.el === heads[i].el && h.key === heads[i].key);
    if (!same) setHeads(next);
  });

  const { active, register } = c;
  const sig = heads.map((h) => h.key).join("|");
  useEffect(() => {
    if (!active) return;
    const offs = heads.map((h) => register(h.key, { page, part: h.key.split(".")[2], label: `عمود «${h.label}»` }));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, register, sig, page]);

  const shown = (k: string) => (active ? c.isVisible(k) : can(k));
  const off = heads.filter((h) => !shown(h.key));
  const hide = !active || c.preview;
  const css = off.map((h) => {
    const cells = `[data-pt="${uid}"] > * > tr > :nth-child(${h.idx}):not([colspan])`;
    const col = `[data-pt="${uid}"] > colgroup > col:nth-child(${h.idx})`;
    const body = `[data-pt="${uid}"] > tbody > tr > :nth-child(${h.idx}):not([colspan])`;
    return hide ? `${cells}, ${col} { display: none; }` : `${body} { opacity: .3; }`;
  }).join("\n");

  return (
    <>
      {css && <style>{css}</style>}
      <table ref={setRef} data-pt={uid} {...props}>{children}</table>
      {active && !c.preview && heads.map((h) => {
        const v = c.isVisible(h.key);
        return createPortal(
          <button type="button" aria-pressed={v} aria-label={`${v ? "إخفاء" : "إظهار"} عمود ${h.label} عن ${c.targetName}`}
            onClick={(e) => { e.stopPropagation(); c.toggle(h.key); }}
            className={`mr-1 inline-flex align-middle items-center justify-center w-7 h-7 rounded-full border ${v ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-white text-rose-600 border-rose-300"}`}
            style={{ opacity: 1 }}>
            {v ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>,
          h.el,
          h.key,
        );
      })}
    </>
  );
}
