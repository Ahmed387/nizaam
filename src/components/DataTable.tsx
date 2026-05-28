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

  return (
    <div className="card-elevated overflow-hidden">
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
                    {c.render ? c.render(row) : (row as any)[c.key]}
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
