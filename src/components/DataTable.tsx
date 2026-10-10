import { Fragment, forwardRef, ReactNode, Ref, useEffect, useState, type CSSProperties } from "react";
import { Loader2 } from "lucide-react";

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
  }: DataTableProps<T>,
  ref: Ref<HTMLDivElement>
) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [rows.length]);
  const pageCount = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = pageSize ? rows.slice(safePage * pageSize, (safePage + 1) * pageSize) : rows;
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
      return <div className="p-12 text-center text-muted-foreground">{empty}</div>;
    }
    return (
      <>
      {/* Wide tables scroll inside a viewport-high box: the horizontal bar stays on screen and the header sticks. */}
      <div className={wide ? "w-full overflow-auto lg:overflow-x-hidden max-h-[calc(100vh-8rem)]" : "w-full overflow-x-auto"} data-wide={wide ? "" : undefined}>
        <table
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
                    <tr className="border-b border-border bg-muted/20">
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

export const DataTable = forwardRef(DataTableInner) as <T>(
  props: DataTableProps<T> & { ref?: Ref<HTMLDivElement> }
) => JSX.Element;
