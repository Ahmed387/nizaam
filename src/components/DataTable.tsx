import { Fragment, forwardRef, ReactNode, Ref, useEffect, useRef, useState, type CSSProperties } from "react";
import { ExcelLayer, FilterBar, type ServerAdapter } from "@/components/table/ExcelFilter";
import { isActive, type CellKind } from "@/lib/tableFilter";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentPermPage, usePermCustomize } from "@/contexts/PermCustomize";
import { partKey } from "@/lib/permissionCatalog";

type Align = "right" | "left" | "center";

interface DataTableProps<T> {
  columns: {
    key: string;
    header: string;
    render?: (row: T) => ReactNode;
    className?: string;
    align?: Align;
    width?: string;
    numeric?: boolean;
    sticky?: boolean;
    /** Excel filter of this column: false = no arrow; a kind forces how its values are read */
    filter?: false | CellKind;
    /** totals row: true / false forces adding (or not) this column; by default number columns that are amounts */
    total?: boolean;
  }[];
  rows: T[];
  loading?: boolean;
  empty?: string;
  onRowClick?: (row: T) => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  getRowKey?: (row: T, index: number) => string;
  isRowExpanded?: (row: T) => boolean;
  renderExpandedRow?: (row: T) => ReactNode;
  /** Optional client-side pagination (rows per page). */
  pageSize?: number;
  /** Optional numeric index column, generated centrally from the visible row order. */
  indexColumn?: boolean | { offset?: number; width?: string };
  /** Optional table-level sizing for wide, column-dense tables. */
  tableClassName?: string;
  /** Floor width for column-dense tables: enables horizontal scroll, auto layout and one-line cells. */
  minTableWidth?: string;
  /**
   * Permissions page key (migration 0114): every column becomes a part «part.<page>.col_<column key>.view» the
   * owner can hide per person / per branch; in «افتح الصفحة وظبطها» each header gets a show / hide button.
   */
  permPage?: string;
  /** When one page has several tables, a short id per table so their columns don't share a switch («col_<table>_<key>»). */
  permTable?: string;
  /**
   * Excel-like filters (owner 2026-10-26): on by default for every table. `false` turns them off (forms, previews);
   * `server` when the table shows one page of a bigger list — the host filters in the database.
   */
  excel?: false | { id?: string; server?: ServerAdapter };
  /**
   * The rows the column filters leave, in the order shown (null = no column filter / sort): Excel / PDF / print of the
   * screen read them, so they export what the person sees (owner 2026-10-26).
   */
  onView?: (rows: T[] | null) => void;
}

function DataTableInner<T>(
  {
    columns,
    rows,
    loading,
    empty = "لا توجد بيانات",
    onRowClick,
    title,
    description,
    footer,
    getRowKey,
    isRowExpanded,
    renderExpandedRow,
    pageSize,
    indexColumn,
    tableClassName,
    minTableWidth,
    permTable,
    excel,
    onView,
  }: DataTableProps<T>,
  ref: Ref<HTMLDivElement>
) {
  const [page, setPage] = useState(0);
  const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null);
  const server = excel ? excel.server : undefined;
  useEffect(() => { setPage(0); }, [rows.length]);
  const pageCount = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = pageSize ? rows.slice(safePage * pageSize, (safePage + 1) * pageSize) : rows;
  // tell the host what the column filters leave (only when it changed, or the rows were reloaded)
  const viewRef = useRef<{ sig: string; rows: T[] | null }>({ sig: "", rows: null });
  const reportView = (nat: number[] | null) => {
    if (!onView) return;
    const sig = nat ? nat.join(",") : "-";
    if (viewRef.current.sig === sig && viewRef.current.rows === rows) return;
    viewRef.current = { sig, rows };
    onView(nat ? nat.filter((x) => x % 2 === 0).map((x) => visibleRows[x / 2]).filter((r): r is T => r !== undefined) : null);
  };
  useEffect(() => { if (!rows.length) reportView(null); });
  const indexOffset = typeof indexColumn === "object" ? (indexColumn.offset ?? 0) : 0;
  const indexWidth = typeof indexColumn === "object" ? (indexColumn.width ?? "4rem") : "4rem";
  const alignClass = (a?: Align) =>
    a === "right" ? "text-right" : a === "left" ? "text-left" : "text-center";

  /** Wide mode: content-driven columns inside a horizontal scroll region, never character-wrapped. */
  const wide = Boolean(minTableWidth);
  // On desktop (lg+) a wide table fits the page: compact padding and wrapped text, no horizontal bar.
  // Below lg it keeps its floor width and scrolls inside its own box.
  const headPad = wide ? "px-4 py-3 lg:px-2 lg:py-2.5" : "px-2 md:px-3 py-3.5";
  const cellPad = wide ? "px-4 py-3 lg:px-2 lg:py-2.5" : "px-2 md:px-3 py-3 md:py-3.5";
  const textMode = wide ? "whitespace-nowrap lg:whitespace-normal lg:break-words" : "break-words whitespace-normal";

  const isActionsColumn = (c: { key: string; header: any }) =>
    c.key === "actions" || (typeof c.header === "string" && c.header.includes("إجراءات"));

  const Header =
    title || description ? (
      <div className="px-5 py-4 border-b border-border bg-gradient-to-b from-surface-2/60 to-transparent text-center">
        {title && (
          <h3 className="font-extrabold text-base md:text-lg text-foreground tracking-tight">{title}</h3>
        )}
        {description && (
          <p className="mt-1 text-xs md:text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            {description}
          </p>
        )}
      </div>
    ) : null;

  const Body = (() => {
    if (loading) {
      return (
        <div className="p-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      );
    }
    if (!rows.length) {
      return (
        <>
          {server && isActive(server.state) && (
            <FilterBar state={server.state} labels={new Map([
              ...Object.entries(server.columns).map(([k, sc]) => [k, sc.label ?? k] as [string, string]),
              ...columns.filter((c) => !server.columns[c.key]?.label).map((c) => [c.key, typeof c.header === "string" ? c.header : c.key] as [string, string]),
            ])}
              shown={0} total={server.total} onChange={server.onChange} />
          )}
          <div className="p-12 text-center text-muted-foreground">{server && isActive(server.state) ? "مفيش صفوف بالفلاتر دي" : empty}</div>
        </>
      );
    }
    return (
      <>
      {excel !== false && <ExcelLayer table={tableEl} storageId={excel?.id ?? permTable} server={server} onVisibleChange={server ? undefined : reportView} />}
      {/* Wide tables scroll inside a viewport-high box: the horizontal bar stays on screen and the header sticks. */}
      <div className={wide ? "w-full overflow-auto lg:overflow-x-hidden max-h-[calc(100vh-8rem)]" : "w-full overflow-x-auto"} data-wide={wide ? "" : undefined}>
        <table
          ref={setTableEl}
          className={`w-full text-sm ${wide ? "lg:text-[13px]" : "md:text-base"} border-collapse ${wide ? "table-auto max-lg:[min-width:var(--dt-min-w)]" : "table-fixed"} ${tableClassName ?? ""}`}
          style={wide ? ({ ["--dt-min-w" as any]: minTableWidth } as CSSProperties) : undefined}
        >
          <thead>
            <tr className={`bg-surface-2 border-b-2 border-border ${wide ? "sticky top-0 z-20 shadow-sm" : ""}`}>
              {indexColumn && (
                <th style={{ width: indexWidth }} className="px-2 py-3.5 text-center text-xs font-extrabold text-foreground border-l border-border/60">#</th>
              )}
              {columns.map((c, idx) => (
                <th
                  key={c.key}
                  data-xf-col={c.key}
                  data-xf-kind={typeof c.filter === "string" ? c.filter : undefined}
                  data-xf-nofilter={c.filter === false || isActionsColumn(c) ? "" : undefined}
                  data-xf-sum={c.total === undefined ? undefined : c.total ? "1" : "0"}
                  style={c.width ? { width: c.width } : isActionsColumn(c) ? { width: "10rem" } : undefined}
                  className={`${headPad} font-extrabold text-xs md:text-sm uppercase tracking-wider text-foreground ${textMode} ${idx > 0 ? "border-r border-border/60" : ""} ${alignClass(c.align)} ${c.className ?? ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => {
              const rowKey = getRowKey?.(row, i) ?? String(i);
              const expanded = Boolean(isRowExpanded?.(row));
              return (
                <Fragment key={rowKey}>
                  <tr
                    data-xf-nat={2 * i}
                    onClick={() => onRowClick?.(row)}
                    aria-expanded={renderExpandedRow ? expanded : undefined}
                    className={`border-b border-border/60 transition-colors hover:bg-primary/5 group ${onRowClick ? "cursor-pointer" : ""} ${i % 2 === 1 ? "bg-surface-2/30" : "bg-card"}`}
                  >
                    {indexColumn && (
                      <td className="px-2 py-3 text-center align-middle font-semibold text-muted-foreground border-l border-border/40">
                        {indexOffset + safePage * (pageSize ?? rows.length) + i + 1}
                      </td>
                    )}
                    {columns.map((c, idx) => (
                      <td
                        key={c.key}
                        className={`${cellPad} align-middle ${textMode} ${idx > 0 ? "border-r border-border/40" : ""} ${c.numeric ? "tabular-nums font-semibold whitespace-nowrap" : ""} ${isActionsColumn(c) ? "[&>div]:flex-nowrap [&>div]:justify-center [&_button]:h-8 [&_button]:w-8 [&_button]:p-0" : ""} ${alignClass(c.align)} ${c.className ?? ""}`}
                      >
                        {c.render ? c.render(row) : ((row as any)[c.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                  {expanded && renderExpandedRow && (
                    <tr data-xf-detail="" data-xf-nat={2 * i + 1} className="border-b border-border bg-muted/20">
                      <td colSpan={columns.length + (indexColumn ? 1 : 0)} className="p-0">
                        {renderExpandedRow(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {footer && (
            <tfoot className="bg-surface-2 border-t-2 border-border font-extrabold">
              {footer}
            </tfoot>
          )}
        </table>
      </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-border p-3 text-sm">
            <button type="button" className="rounded-md border border-border px-3 py-1 disabled:opacity-40" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)}>السابق</button>
            <span className="tabular-nums text-muted-foreground">صفحة {safePage + 1} من {pageCount} ({rows.length})</span>
            <button type="button" className="rounded-md border border-border px-3 py-1 disabled:opacity-40" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>التالي</button>
          </div>
        )}
      </>
    );
  })();

  return (
    <div ref={ref} className="card-elevated overflow-hidden">
      {Header}
      {Body}
    </div>
  );
}

const DataTableBase = forwardRef(DataTableInner) as <T>(
  props: DataTableProps<T> & { ref?: Ref<HTMLDivElement> }
) => JSX.Element;

/** Columns as the signed-in user (or the person being set up) may see them. */
function PermColumnsTable<T>({ permPage, permTable, columns, ...rest }: DataTableProps<T> & { permPage: string; innerRef?: Ref<HTMLDivElement> }) {
  const { can } = useAuth();
  const c = usePermCustomize();
  // part ids must match the database rule [a-z0-9_] — column keys like «paidRemaining» are normalised
  const norm = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const pid = (k: string) => `col_${permTable ? `${norm(permTable)}_` : ""}${norm(k)}`;
  const text = (h: unknown) => (typeof h === "string" || typeof h === "number" ? String(h) : "بدون اسم");
  // «__sel» (the ✓ box) and friends are plumbing, not data: always shown
  const fixed = (k: string) => k.startsWith("__");
  const keys = columns.map((col) => (fixed(col.key) ? "" : partKey(permPage, pid(col.key))));
  const { active, register } = c;
  const sig = keys.join("|") + "|" + columns.map((col) => text(col.header)).join("|");
  useEffect(() => {
    if (!active) return;
    const offs = columns.map((col, i) => (keys[i] ? register(keys[i], { page: permPage, part: pid(col.key), label: `عمود «${text(col.header)}»` }) : () => {}));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, register, sig]);
  let cols = columns;
  if (!active) cols = columns.filter((_, i) => !keys[i] || can(keys[i]));
  else if (c.preview) cols = columns.filter((_, i) => !keys[i] || c.isVisible(keys[i]));
  else cols = columns.map((col, i) => {
    if (!keys[i]) return col;
    const v = c.isVisible(keys[i]);
    return {
      ...col,
      className: `${col.className ?? ""} ${v ? "" : "opacity-30"}`,
      header: (
        <span className="inline-flex items-center gap-1">
          {col.header}
          <button type="button" aria-pressed={v} aria-label={`${v ? "إخفاء" : "إظهار"} عمود ${text(col.header)} عن ${c.targetName}`}
            onClick={(e) => { e.stopPropagation(); c.toggle(keys[i]); }}
            className={`inline-flex items-center justify-center w-7 h-7 rounded-full border ${v ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-white text-rose-600 border-rose-300"}`}>
            {v ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
        </span>
      ) as any,
    };
  });
  const table = <DataTableBase {...(rest as any)} permTable={permTable} columns={cols} ref={(rest as any).innerRef} />;
  // an empty table shows no header — in «افتح الصفحة وظبطها» list its columns as chips so they can still be set
  if (active && !c.preview && !(rest as any).loading && !((rest as any).rows ?? []).length && keys.some(Boolean)) {
    return (
      <div className="space-y-2">
        <div role="group" aria-label="أعمدة الجدول" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed p-2 text-xs">
          <span className="text-muted-foreground ml-1">الجدول فاضي دلوقتي — أعمدته:</span>
          {columns.map((col, i) => {
            if (!keys[i]) return null;
            const v = c.isVisible(keys[i]);
            return (
              <button key={keys[i]} type="button" aria-pressed={v} aria-label={`${v ? "إخفاء" : "إظهار"} عمود ${text(col.header)} عن ${c.targetName}`} onClick={() => c.toggle(keys[i])}
                className={`inline-flex items-center gap-1 min-h-[32px] rounded-full px-3 font-bold border ${v ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-white text-rose-700 border-rose-300 line-through"}`}>
                {v ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />} {text(col.header)}
              </button>
            );
          })}
        </div>
        {table}
      </div>
    );
  }
  return table;
}

export const DataTable = forwardRef(function DataTable(props: any, ref: Ref<HTMLDivElement>) {
  // every table on a catalogue page gets switchable columns; `permPage` only forces / names it
  const autoPage = useCurrentPermPage();
  const permPage = props.permPage ?? autoPage;
  return permPage ? <PermColumnsTable {...props} permPage={permPage} innerRef={ref} /> : <DataTableBase {...props} ref={ref} />;
}) as <T>(props: DataTableProps<T> & { ref?: Ref<HTMLDivElement> }) => JSX.Element;
