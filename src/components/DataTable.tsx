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

  const isActionsColumn = (c: { key: string; header: string }) =>
    c.key === "actions" || c.header.includes("إجراءات");

  return (
    <div className="card-elevated overflow-hidden">
      <div className="w-full">
        <table className="w-full text-xs md:text-sm border-collapse table-fixed">
          <thead>
            <tr className="bg-surface-2 border-b border-border">
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : isActionsColumn(c) ? { width: "7.25rem" } : undefined}
                  className={`px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-[10px] md:text-xs uppercase tracking-wider text-muted-foreground break-words whitespace-normal ${alignClass(c.align)} ${c.className ?? ""}`}
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
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-1.5 md:px-2 py-2 md:py-2.5 align-middle break-words whitespace-normal min-w-0 ${isActionsColumn(c) ? "[&>div]:flex-wrap [&>div]:justify-end [&_button]:h-7 [&_button]:w-7 [&_button]:p-0" : ""} ${alignClass(c.align)} ${c.className ?? ""}`}
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
