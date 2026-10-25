import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Search, MousePointerClick, RotateCcw, CheckCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ACTION_LABELS, CatalogPage, CatalogSection, PERMISSION_CATALOG, SectionId, searchCatalog } from "@/lib/permissionCatalog";
import { pageKeys } from "@/lib/permissionModel";

export interface EditorBinding {
  get: (key: string) => boolean;
  /** true when the key differs from the template (person mode) / the role default (template mode) */
  changed: (key: string) => boolean;
  set: (key: string, value: boolean) => void;
  resetPage: (page: CatalogPage) => void;
  allowAll: (page: CatalogPage) => void;
  /** «افتح الصفحة وظبطها» link (the real page with show / hide on every box), when the page can be opened */
  customizeHref?: (page: CatalogPage) => string | null;
  /** word used on the «back to …» buttons: «القالب» (person) or «الافتراضي» (template) */
  resetWord: string;
  /** shown on top of the list, e.g. «في فرع سكة تلة بس» */
  scopeNote?: string;
  /** a key that can't be opened here and why (e.g. «الشريك عرض بس»), shown locked and off */
  locked?: (key: string) => string | null;
}

export const pageOnKey = (p: CatalogPage) => `${p.key}.${p.actions.includes("view") ? "view" : p.actions[0]}`;

export function PermissionEditor({ bind, personalNote }: { bind: EditorBinding; personalNote?: React.ReactNode }) {
  const [tab, setTab] = useState<SectionId>("general");
  const [q, setQ] = useState("");
  const results = useMemo(() => searchCatalog(q), [q]);

  const countOn = (s: CatalogSection) => s.pages.filter((p) => bind.get(pageOnKey(p))).length;
  const section = PERMISSION_CATALOG.find((s) => s.id === tab)!;
  const pages = q.trim() ? results.map((r) => r.page) : section.pages;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute top-3 right-3 text-muted-foreground" aria-hidden="true" />
        <label htmlFor="perm-search" className="sr-only">بحث في الصلاحيات</label>
        <Input id="perm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن صفحة… (مثلاً: الخزنة، صافي الربح)" className="pr-9" />
      </div>

      {!q.trim() && (
        <div role="tablist" aria-label="أقسام القايمة الجانبية" className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {PERMISSION_CATALOG.map((s) => {
            const sel = s.id === tab;
            return (
              <button key={s.id} type="button" role="tab" aria-selected={sel} onClick={() => setTab(s.id)}
                className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 min-h-[60px] transition-colors ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:border-primary/50"}`}>
                <span className="font-extrabold">{s.label}</span>
                <span className="text-xs opacity-85">{s.id === "personal" ? "بتاعتك انت بس" : `${countOn(s)} من ${s.pages.length} ظاهرين`}</span>
              </button>
            );
          })}
        </div>
      )}

      <section aria-label="الصفحات" className="rounded-xl border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-muted/40 border-b text-sm">
          <span className="font-extrabold">{q.trim() ? `نتايج البحث (${pages.length})` : `صفحات «${section.label}»`}</span>
          {bind.scopeNote && <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-bold">{bind.scopeNote}</span>}
          <span className="text-muted-foreground">المفتاح يظهر الصفحة أو يخفيها · الأزرار الصغيرة هو يقدر يعمل إيه · «افتح الصفحة وظبطها» تشوف جواها وتخفي أي بوكس</span>
        </div>

        {!q.trim() && tab === "personal" && (
          <div className="p-5 flex items-start gap-3">
            <Lock className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <div className="font-extrabold">المصاريف الشخصية بتاعتك انت بس</div>
              <div className="text-sm text-muted-foreground leading-relaxed">{personalNote ?? "مش بتتفتح من هنا. بتختار مين يشوفها من تاب «المصاريف الشخصية» زي ما هي دلوقتي."}</div>
            </div>
          </div>
        )}
        {q.trim() && !pages.length && <div className="p-6 text-sm text-muted-foreground text-center">مفيش صفحة بالاسم ده.</div>}

        {pages.map((p) => {
          const onKey = pageOnKey(p);
          const on = bind.get(onKey);
          const changed = pageKeys(p).some((k) => bind.changed(k));
          const href = bind.customizeHref?.(p);
          return (
            <div key={p.key} className="border-b last:border-b-0">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Switch checked={on} onCheckedChange={(v) => bind.set(onKey, v)} aria-label={`${on ? "إخفاء" : "إظهار"} ${p.label}`} />
                <div className="flex-1 min-w-[200px]">
                  <div className="flex flex-wrap items-center gap-2 font-extrabold">
                    {p.label}
                    {changed && <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-warning/15 text-warning">متعدّل عن {bind.resetWord}</span>}
                    {p.scope === "branch" && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-muted text-muted-foreground">صفحة فرع</span>}
                  </div>
                  {p.help && <div className="text-xs text-muted-foreground leading-relaxed">{p.help}</div>}
                </div>
                {on && p.actions.some((a) => `${p.key}.${a}` !== onKey) && (
                  <div role="group" aria-label="يقدر يعمل إيه" className="flex flex-wrap gap-1.5">
                    {p.actions.filter((a) => `${p.key}.${a}` !== onKey).map((a) => {
                      const k = `${p.key}.${a}`;
                      const why = bind.locked?.(k) ?? null;
                      const v = !why && bind.get(k);
                      return (
                        <button key={a} type="button" aria-pressed={v} disabled={!!why} title={why ?? undefined}
                          aria-label={why ? `${ACTION_LABELS[a]} — ${why}` : undefined} onClick={() => bind.set(k, !v)}
                          className={`min-h-[36px] rounded-full px-3 text-xs font-bold border transition-colors ${why ? "bg-muted text-muted-foreground border-dashed opacity-70 cursor-not-allowed" : v ? "bg-primary/10 text-primary border-primary/40" : "bg-background text-muted-foreground border-dashed line-through"}`}>
                          {why && <Lock className="w-3 h-3 inline ml-1" aria-hidden="true" />}{ACTION_LABELS[a]}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {changed && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => bind.resetPage(p)} className="h-9 text-xs">
                      <RotateCcw className="w-3.5 h-3.5 ml-1" /> رجّعها لـ{bind.resetWord}
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => bind.allowAll(p)} className="h-9 text-xs">
                    <CheckCheck className="w-3.5 h-3.5 ml-1" /> الكل مسموح
                  </Button>
                  {on && href && (
                    <Button asChild size="sm" className="h-9 text-xs">
                      <Link to={href}><MousePointerClick className="w-3.5 h-3.5 ml-1" /> افتح الصفحة وظبطها</Link>
                    </Button>
                  )}
                </div>
              </div>
              {on && p.children.length > 0 && (
                <div role="group" aria-label={`التابات جوه ${p.label}`} className="px-4 pb-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground ml-1">التابات جوه الصفحة:</span>
                  {p.children.map((c) => {
                    const k = `${c.key}.view`;
                    const v = bind.get(k);
                    return (
                      <button key={c.key} type="button" aria-pressed={v} onClick={() => bind.set(k, !v)} title={c.help}
                        className={`min-h-[32px] rounded-full px-3 text-xs font-bold border ${v ? "bg-primary/10 text-primary border-primary/40" : "bg-background text-muted-foreground border-dashed line-through"} ${bind.changed(k) ? "ring-2 ring-warning/40" : ""}`}>
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
