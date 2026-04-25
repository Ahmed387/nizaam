import { ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty = "لا توجد بيانات",
  onRowClick,
}: {
  columns: { key: string; header: string; render?: (row: T) => ReactNode; className?: string }[];
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
  return (
    <div className="card-elevated overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 border-b border-border">
              {columns.map((c) => (
                <th key={c.key} className={`px-4 py-3 text-right font-semibold text-muted-foreground ${c.className ?? ""}`}>
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
                className={`border-b border-border last:border-0 table-row-hover ${onRowClick ? "cursor-pointer" : ""} ${i % 2 === 1 ? "bg-surface/30" : ""}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 ${c.className ?? ""}`}>
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
