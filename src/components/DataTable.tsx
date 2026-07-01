import { ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Align = "right" | "left" | "center";

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty = "لا توجد بيانات",
  onRowClick,
  title,
  description,
  footer,
}: {
  columns: {
    key: string;
    header: string;
    render?: (row: T) => ReactNode;
    className?: string;
    align?: Align;
    width?: string;
    /** Mark numeric columns: applies tabular-nums + bolder typography. */
    numeric?: boolean;
    /** Keep this column visible (sticky) while scrolling horizontally on mobile. Defaults to the first column. */
    sticky?: boolean;
  }[];
  rows: T[];
  loading?: boolean;
  empty?: string;
  onRowClick?: (row: T) => void;
  /** Optional card header — title at top, description centered below. */
  title?: ReactNode;
  description?: ReactNode;
  /** Optional footer row (totals, etc). */
  footer?: ReactNode;
}) {
  const alignClass = (a?: Align) =>
    a === "right" ? "text-right" : a === "left" ? "text-left" : "text-center";

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
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm md:text-base border-collapse table-fixed">
          <thead>
            <tr className="bg-surface-2 border-b-2 border-border">
              {columns.map((c, idx) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : isActionsColumn(c) ? { width: "10rem" } : undefined}
                  className={`px-2 md:px-3 py-3.5 font-extrabold text-xs md:text-sm uppercase tracking-wider text-foreground break-words whitespace-normal ${idx > 0 ? "border-r border-border/60" : ""} ${alignClass(c.align)} ${c.className ?? ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-border/60 last:border-0 transition-colors hover:bg-primary/5 group ${onRowClick ? "cursor-pointer" : ""} ${i % 2 === 1 ? "bg-surface-2/30" : "bg-card"}`}
              >
                {columns.map((c, idx) => (
                  <td
                    key={c.key}
                    className={`px-2 md:px-3 py-3 md:py-3.5 align-middle break-words whitespace-normal min-w-0 ${idx > 0 ? "border-r border-border/40" : ""} ${c.numeric ? "tabular-nums font-semibold whitespace-nowrap" : ""} ${isActionsColumn(c) ? "[&>div]:flex-nowrap [&>div]:justify-center [&_button]:h-8 [&_button]:w-8 [&_button]:p-0" : ""} ${alignClass(c.align)} ${c.className ?? ""}`}
                  >
                    {c.render ? c.render(row) : ((row as any)[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot className="bg-surface-2 border-t-2 border-border font-extrabold">
              {footer}
            </tfoot>
          )}
        </table>
      </div>
    );
  })();

  return (
    <div className="card-elevated overflow-hidden">
      {Header}
      {Body}
    </div>
  );
}
