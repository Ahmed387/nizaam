import { ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Align = "right" | "left" | "center";

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty = "لا توجد بيانات",
  onRowClick,
}: {
  columns: {
    key: string;
    header: string;
    render?: (row: T) => ReactNode;
    className?: string;
    align?: Align;
    width?: string;
    /** Keep this column visible (sticky) while scrolling horizontally on mobile. Defaults to the first column. */
    sticky?: boolean;
  }[];
  rows: T[];
  loading?: boolean;
  empty?: string;
  onRowClick?: (row: T) => void;
}) {
  if (loading) {
    return (
      <div className="card-elevated p-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!rows.length) {
    return <div className="card-elevated p-12 text-center text-muted-foreground">{empty}</div>;
  }

  const alignClass = (a?: Align) =>
    a === "center" ? "text-center" : a === "left" ? "text-left" : "text-right";

  // Determine sticky column (explicit prop, or first column by default)
  const stickyIndex = (() => {
    const explicit = columns.findIndex((c) => c.sticky);
    return explicit >= 0 ? explicit : 0;
  })();

  // RTL layout: first column is on the right edge → use `right-0`
  const stickyCls =
    "sticky right-0 z-10 bg-card md:bg-transparent before:absolute before:inset-y-0 before:left-0 before:w-2 before:bg-gradient-to-l before:from-black/10 before:to-transparent md:before:hidden";
  const stickyHeadCls =
    "sticky right-0 z-20 bg-surface-2 before:absolute before:inset-y-0 before:left-0 before:w-2 before:bg-gradient-to-l before:from-black/10 before:to-transparent md:before:hidden";

  return (
    <div className="card-elevated overflow-hidden">
      <div className="overflow-x-auto scroll-smooth">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface-2 border-b border-border">
              {columns.map((c, idx) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={`px-3 md:px-4 py-2.5 md:py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap ${alignClass(c.align)} ${idx === stickyIndex ? stickyHeadCls : ""} ${c.className ?? ""}`}
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
                className={`border-b border-border last:border-0 transition-colors hover:bg-muted/40 group ${onRowClick ? "cursor-pointer" : ""} ${i % 2 === 1 ? "bg-surface/20" : "bg-card"}`}
              >
                {columns.map((c, idx) => (
                  <td
                    key={c.key}
                    className={`px-3 md:px-4 py-2.5 md:py-3 align-middle whitespace-nowrap ${alignClass(c.align)} ${idx === stickyIndex ? stickyCls + (i % 2 === 1 ? " !bg-surface" : " !bg-card") + " group-hover:!bg-muted/60" : ""} ${c.className ?? ""}`}
                  >
                    {c.render ? c.render(row) : ((row as any)[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
