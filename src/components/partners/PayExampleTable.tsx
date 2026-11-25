import { PermTable } from "@/components/PermTable";
import { formatEGP } from "@/lib/format";
import type { payExample } from "@/lib/partners";

/** The split of one month, step by step: fixed → % → by capital → what each one takes. */
export function PayExampleTable({ example, profit }: { example: ReturnType<typeof payExample>; profit: number }) {
  const ids = Object.keys(example.byId);
  if (!ids.length) return <div className="text-sm text-muted-foreground">مفيش شركاء.</div>;
  return (
    <div className="space-y-2" data-testid="pay-example">
      <PermTable className="w-full text-sm" noFilter>
        <thead className="bg-muted/40">
          <tr className="text-right">
            <th className="p-2">الشريك</th><th className="p-2">مرتب ثابت</th><th className="p-2">نسبة من الربح</th>
            <th className="p-2">من رأس المال</th><th className="p-2">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const r = example.byId[id];
            return (
              <tr key={id} className="border-t">
                <td className="p-2 font-semibold">{r.name}</td>
                <td className="p-2 tabular-nums">{r.fixed ? formatEGP(r.fixed) : "—"}</td>
                <td className="p-2 tabular-nums">{r.percent ? formatEGP(r.percent) : "—"}</td>
                <td className={`p-2 tabular-nums ${r.capital < 0 ? "text-destructive" : ""}`}>{formatEGP(r.capital)}</td>
                <td className={`p-2 tabular-nums font-extrabold ${r.total < 0 ? "text-destructive" : "text-primary"}`}>{formatEGP(r.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </PermTable>
      <p className="text-xs text-muted-foreground">
        الربح {formatEGP(profit)} − مرتبات ثابتة {formatEGP(example.fixedAll)} − نسب {formatEGP(example.pctAll)} = <b>{formatEGP(example.left)}</b> يتقسم على رأس المال.
      </p>
    </div>
  );
}
