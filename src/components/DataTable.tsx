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
    /** Hide this column on mobile card view */
    hideOnMobile?: boolean;
    /** Render as card title (large, bold) instead of label/value row */
    primary?: boolean;
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

  const renderCell = (c: typeof columns[number], row: T) =>
    c.render ? c.render(row) : ((row as any)[c.key] ?? "—");

  return (
    <>
      {/* Desktop / tablet: classic table */}
      <div className="card-elevated overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={`px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap ${alignClass(c.align)} ${c.className ?? ""}`}
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
                  className={`border-b border-border last:border-0 transition-colors hover:bg-muted/40 ${onRowClick ? "cursor-pointer" : ""} ${i % 2 === 1 ? "bg-surface/20" : ""}`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-3 align-middle ${alignClass(c.align)} ${c.className ?? ""}`}
                    >
                      {renderCell(c, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: stacked cards */}
      <div className="md:hidden space-y-2">
        {rows.map((row, i) => {
          const primaryCols = columns.filter((c) => c.primary);
          const visibleCols = columns.filter((c) => !c.hideOnMobile && !c.primary);
          return (
            <div
              key={i}
              onClick={() => onRowClick?.(row)}
              className={`card-elevated p-3 ${onRowClick ? "cursor-pointer active:bg-muted/40" : ""}`}
            >
              {primaryCols.length > 0 && (
                <div className="mb-2 pb-2 border-b border-border">
                  {primaryCols.map((c) => (
                    <div key={c.key} className="font-bold text-base">
                      {renderCell(c, row)}
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-1.5 text-sm">
                {visibleCols.map((c) => (
                  <div key={c.key} className="flex items-start justify-between gap-3">
                    <span className="text-xs text-muted-foreground shrink-0">{c.header}</span>
                    <span className="text-left flex-1 min-w-0 truncate">
                      {renderCell(c, row)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
