import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppRole, DEFAULT_ROLE_PERMISSIONS, ROLE_LABELS } from "@/lib/roles";
import { PERMISSION_CATALOG, PagePart, pageForPath, partKey } from "@/lib/permissionCatalog";
import { Overrides, RolePerms, effective, fromRows, setOverride, toRows } from "@/lib/permissionModel";
import { rpcErrorText } from "@/lib/rpcError";
import { withCompanyRole } from "@/lib/companyRoles";

/**
 * «افتح الصفحة وظبطها» (owner decision 2026-10-24): any page opened with `?perm_for=<user id>` shows, on every
 * <PermPart>, a «ظاهر / مخفي» button for THAT person. On a branch page the change is for that branch only
 * («الفرع ده بس») or for every branch («كل الفروع»). «شوفها بعينه» shows the page as he will see it.
 * Owner / manager only; saving goes through save_user_permissions (migration 0114).
 */
type Meta = { page: string; part: string; info?: PagePart; label?: string };
interface Customize {
  active: boolean;
  preview: boolean;
  targetName: string;
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  register: (key: string, meta: Meta) => () => void;
}

const Ctx = createContext<Customize>({ active: false, preview: false, targetName: "", isVisible: () => true, toggle: () => {}, register: () => () => {} });
export const usePermCustomize = () => useContext(Ctx);

const partInfo = (page: string, part: string) =>
  PERMISSION_CATALOG.flatMap((s) => s.pages).find((p) => p.key === page)?.parts.find((x) => x.id === part);

export function PermCustomizeProvider({ children }: { children: ReactNode }) {
  const { isAdmin, isOwner, tenantId, roleLabel } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const qs = new URLSearchParams(loc.search);
  const target = qs.get("perm_for");
  const allowed = !!target && (isAdmin || isOwner);
  const urlBranch = /^\/branch\/([^/]+)/.exec(loc.pathname)?.[1] ?? null;
  const [scopeBranch, setScopeBranch] = useState(qs.get("perm_scope") === "branch");
  // the provider lives above the routes: follow «perm_scope» each time a page is opened from the permissions screen
  const urlScope = qs.get("perm_scope") === "branch";
  useEffect(() => { setScopeBranch(urlScope); }, [urlScope, loc.pathname]);
  const [state, setState] = useState<{ uid: string; name: string; roles: string[]; roleNames: string[]; rolePerms: RolePerms; saved: Overrides; draft: Overrides } | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const registry = useRef(new Map<string, Meta>());
  const [, bump] = useState(0);

  useEffect(() => {
    if (!allowed || !tenantId || state?.uid === target) return;
    (async () => {
      const [prof, roles, rp, ups, cr] = await Promise.all([
        supabase.from("profiles").select("name, username").eq("id", target!).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", target!),
        supabase.from("role_permissions" as any).select("role, permission_key, allowed").eq("tenant_id", tenantId),
        supabase.from("user_permissions" as any).select("permission_key, allowed, branch_id").eq("user_id", target!),
        supabase.from("user_company_roles" as any).select("permission_templates(id, name, base_role, perms)").eq("user_id", target!).maybeSingle(),
      ]);
      const pmap: RolePerms = {};
      ((rp.data ?? []) as any[]).forEach((r) => ((pmap[r.role] = pmap[r.role] ?? {})[r.permission_key] = !!r.allowed));
      Object.entries(DEFAULT_ROLE_PERMISSIONS).forEach(([r, d]) => { if (!pmap[r]) pmap[r] = { ...d }; });
      const rs0 = ((roles.data ?? []) as any[]).map((r) => r.role as string).filter((r) => r !== "owner");
      // on a company role (migration 0115): resolve like the server — his role's differences over its ready role
      const tpl = (cr as any)?.data?.permission_templates;
      const eff = withCompanyRole(rs0, pmap, tpl ? { id: tpl.id, name: tpl.name, base_role: tpl.base_role, perms: tpl.perms ?? {} } : null);
      const o = fromRows((ups.data ?? []) as any[]);
      setState({ uid: target!, name: (prof.data as any)?.name || (prof.data as any)?.username || "الموظف", roles: eff.roles, rolePerms: eff.permsByRole, roleNames: tpl ? [tpl.name] : rs0, saved: o, draft: o });
    })();
  }, [allowed, target, tenantId, state?.uid]);

  const active = allowed && !!state && state.uid === target;
  const writeBranch = scopeBranch && urlBranch ? urlBranch : null;
  const isVisible = useCallback((key: string) => (state ? effective(state.roles, state.rolePerms, state.draft, key, urlBranch) : true), [state, urlBranch]);
  const toggle = useCallback((key: string) => setState((s) => {
    if (!s) return s;
    const now = effective(s.roles, s.rolePerms, s.draft, key, urlBranch);
    let d = setOverride(s.roles, s.rolePerms, s.draft, key, !now, writeBranch);
    // «كل الفروع» on a branch page: a branch-only rule for this box would still win here, so it goes
    if (!writeBranch && urlBranch) { d = { ...d }; delete d[`${key}@${urlBranch}`]; }
    return { ...s, draft: d };
  }), [urlBranch, writeBranch]);
  const register = useCallback((key: string, meta: Meta) => {
    registry.current.set(key, meta);
    bump((n) => n + 1);
    return () => { registry.current.delete(key); bump((n) => n + 1); };
  }, []);

  const parts = Array.from(registry.current.entries());
  const hiddenCount = parts.filter(([k]) => !isVisible(k)).length;
  const dirty = !!state && JSON.stringify(state.draft) !== JSON.stringify(state.saved);

  const exit = () => nav(`/admin/settings?tab=user-permissions&user=${target}${writeBranch ? `&branch=${writeBranch}` : ""}`);
  const save = async (andExit: boolean) => {
    if (!state) return;
    setSaving(true);
    const { error } = await supabase.rpc("save_user_permissions" as any, { p_user: state.uid, p_rows: toRows(state.draft) } as any);
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error, "حفظ الصلاحيات"));
    toast.success(`اتحفظ اللي يظهر لـ ${state.name}`);
    setState({ ...state, saved: state.draft });
    if (andExit) exit();
  };
  const setAll = (visible: boolean | null) => setState((s) => {
    if (!s) return s;
    let d = { ...s.draft };
    parts.forEach(([k]) => {
      if (visible === null) { delete d[k]; if (urlBranch) delete d[`${k}@${urlBranch}`]; }
      else d = setOverride(s.roles, s.rolePerms, d, k, visible, writeBranch);
    });
    return { ...s, draft: d };
  });

  const value = useMemo<Customize>(() => ({ active, preview, targetName: state?.name ?? "", isVisible, toggle, register }), [active, preview, state?.name, isVisible, toggle, register]);
  const pages = PERMISSION_CATALOG.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.label }))).filter((p) => p.route);
  const goTo = (key: string) => {
    const p = pages.find((x) => x.key === key);
    if (!p) return;
    const to = p.route!.includes(":branch") ? (urlBranch ? p.route!.replace(":branch", urlBranch) : null) : p.route!;
    if (!to) return toast.message("الصفحة دي صفحة فرع — افتحها من صفحة فرع");
    nav(`${to}?perm_for=${target}${scopeBranch ? "&perm_scope=branch" : ""}`);
  };
  const offscreen = parts.filter(([, m]) => m.info?.offscreen);

  return (
    <Ctx.Provider value={value}>
      {active && (
        <div dir="rtl" role="region" aria-label="شريط تظبيط الصفحة" className="sticky top-0 z-[60] bg-slate-900 text-white">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 font-extrabold"><Eye className="w-4 h-4" aria-hidden="true" /> بتظبط اللي يظهر لـ {state!.name} ({state!.roleNames.map((r) => roleLabel(r)).join("، ") || "بدون دور"})</span>
            <span className="text-slate-300">{parts.length ? `${hiddenCount} مخفي من ${parts.length} في الصفحة دي` : "الصفحة دي لسه مفيهاش بوكسات بتتظبط"}</span>
            {urlBranch && (
              <span role="radiogroup" aria-label="التغيير لمين" className="flex rounded-lg border border-slate-500 overflow-hidden">
                <button type="button" role="radio" aria-checked={scopeBranch} onClick={() => setScopeBranch(true)} className={`min-h-[34px] px-3 font-bold ${scopeBranch ? "bg-white text-slate-900" : ""}`}>الفرع ده بس</button>
                <button type="button" role="radio" aria-checked={!scopeBranch} onClick={() => setScopeBranch(false)} className={`min-h-[34px] px-3 font-bold ${!scopeBranch ? "bg-white text-slate-900" : ""}`}>كل الفروع</button>
              </span>
            )}
            <label className="sr-only" htmlFor="perm-page">صفحة تانية</label>
            <select id="perm-page" value="" onChange={(e) => goTo(e.target.value)} className="min-h-[34px] rounded-lg bg-slate-800 border border-slate-500 px-2 text-white">
              <option value="">روح لصفحة تانية…</option>
              {pages.map((p) => <option key={p.key} value={p.key}>{p.section} ← {p.label}</option>)}
            </select>
            <span className="flex-1" />
            <button type="button" aria-pressed={preview} onClick={() => setPreview((v) => !v)} className="min-h-[34px] rounded-lg border border-slate-500 px-3 font-bold hover:bg-slate-800">{preview ? "رجّع الأزرار" : "شوفها بعينه"}</button>
            <button type="button" onClick={() => setAll(true)} className="min-h-[34px] rounded-lg border border-slate-500 px-3 font-bold hover:bg-slate-800">أظهر الكل</button>
            <button type="button" onClick={() => setAll(null)} className="min-h-[34px] rounded-lg border border-slate-500 px-3 font-bold hover:bg-slate-800"><RotateCcw className="w-3.5 h-3.5 inline ml-1" aria-hidden="true" />رجّعه للقالب</button>
            <button type="button" disabled={saving || !dirty} onClick={() => save(false)} className="min-h-[34px] rounded-lg border border-slate-500 px-3 font-bold hover:bg-slate-800 disabled:opacity-50">حفظ</button>
            <button type="button" disabled={saving} onClick={() => (dirty ? save(true) : exit())} className="min-h-[34px] rounded-lg bg-white text-slate-900 px-3 font-extrabold disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : <Save className="w-4 h-4 inline ml-1" aria-hidden="true" />} {dirty ? "حفظ وخروج" : "خروج"}
            </button>
          </div>
          {!preview && offscreen.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 text-xs">
              <span className="text-slate-300">أجزاء مش باينة دلوقتي:</span>
              {offscreen.map(([k, m]) => {
                const v = isVisible(k);
                return (
                  <button key={k} type="button" aria-pressed={v} onClick={() => toggle(k)}
                    className={`min-h-[32px] rounded-full px-3 font-bold border ${v ? "bg-emerald-500/20 border-emerald-400 text-emerald-100" : "bg-transparent border-rose-400 text-rose-200"}`}>
                    {m.info ? `${m.info.kind}: ${m.info.label}` : (m.label ?? m.part)} — {v ? "ظاهر ✓" : "مخفي"}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

/**
 * A box of a page (card, table, column, button, dialog) the owner can show or hide per person and per branch.
 * Normal use: renders the children only when `can("part.<page>.<part>.view")` (follows the page when unset).
 * In customize mode: adds a «ظاهر / مخفي» button for the person being set up. Every PermPart must be listed in
 * PAGE_PARTS (permissionCatalog.ts) — a test fails otherwise.
 */
/** true inside a PermPart, so a card / table that tags itself automatically doesn't get a second switch. */
const InPart = createContext(false);

export function PermPart({ page, part, label, auto, group, children, className }: { page: string; part: string; label?: string; auto?: boolean; group?: boolean; children: ReactNode; className?: string }) {
  const { can } = useAuth();
  // a hand-tagged box covers the cards inside it; an automatic one (a Card by its title) lets them keep their own switch
  const parentInside = useContext(InPart);
  // `group`: a box of several cards — the box has a switch AND every card inside keeps its own
  const inside = auto || group ? parentInside : true;
  const c = usePermCustomize();
  const key = partKey(page, part);
  const info = partInfo(page, part);
  const name = info?.label ?? label ?? part;
  const { register, active } = c;
  useEffect(() => (active ? register(key, { page, part, info, label }) : undefined), [active, register, key, page, part, info, label]);
  if (!c.active) return can(key) ? <InPart.Provider value={inside}>{children}</InPart.Provider> : null;
  const visible = c.isVisible(key);
  if (c.preview || info?.offscreen) return visible ? <InPart.Provider value={inside}>{children}</InPart.Provider> : null;
  return (
    <div className={`relative rounded-xl ${visible ? "ring-2 ring-emerald-400/60" : "ring-2 ring-dashed ring-rose-400/70"} ${className ?? ""}`} data-perm-part={key}>
      <div className={visible ? "" : "opacity-40 pointer-events-none select-none"} aria-hidden={!visible}><InPart.Provider value={inside}>{children}</InPart.Provider></div>
      <button type="button" aria-pressed={visible} aria-label={`${visible ? "إخفاء" : "إظهار"} ${name} عن ${c.targetName}`} onClick={() => c.toggle(key)}
        className={`absolute -top-3 left-3 z-10 flex items-center gap-1 min-h-[32px] rounded-full px-3 text-xs font-extrabold shadow ${visible ? "bg-emerald-50 text-emerald-800 border border-emerald-300" : "bg-white text-rose-700 border border-rose-300"}`}>
        {visible ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
        {visible ? "ظاهر" : "مخفي — أظهره"}
        {info?.sensitive && <Lock className="w-3 h-3" aria-label="رقم حساس" />}
      </button>
      {!visible && <span className="absolute bottom-2 left-2 z-10 rounded-full bg-rose-600 text-white text-[11px] font-extrabold px-2 py-0.5">مخفي عن {c.targetName}</span>}
    </div>
  );
}

/**
 * For things that must not carry their own overlay (a tab button whose content is already a PermPart):
 * normal mode → can(part key); customize mode → always shown, the toggle lives on the content.
 * Returns a checker for one page: `const on = usePartVisible("reports"); on("tab_charts")`.
 */
export function usePartVisible(page: string): (part: string) => boolean {
  const { can } = useAuth();
  const c = usePermCustomize();
  return (part: string) => (c.active ? true : can(partKey(page, part)));
}

/** Short stable id from a label: «صافي الربح» → «a1b2c3» (djb2, base 36) — part ids must be [a-z0-9_]. */
export function autoPartId(prefix: string, label: string): string {
  let h = 5381;
  for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) >>> 0;
  return `${prefix}_${h.toString(36)}`;
}

/** The catalogue page of the current route (null outside a router or on a page that isn't in the catalogue). */
const RoutePage = createContext<string | null>(null);
const PAGE_KEYS = new Set(PERMISSION_CATALOG.flatMap((s) => s.pages.map((p) => p.key)));
/** Set by ProtectedRoute from its `perm` («sales.view» → «sales») when that page is in the catalogue. */
export function PermRoutePage({ perm, children }: { perm?: string; children: ReactNode }) {
  const page = perm ? perm.replace(/\.[^.]+$/, "") : null;
  return <RoutePage.Provider value={page && PAGE_KEYS.has(page) ? page : null}>{children}</RoutePage.Provider>;
}

export function useCurrentPermPage(): string | null {
  const fromRoute = useContext(RoutePage);
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- inRouter never changes for a mounted tree
  const path = inRouter ? useLocation().pathname : null;
  return (path ? pageForPath(path)?.key ?? null : null) ?? fromRoute;
}

/**
 * Every card (StatCard / MetricCardWithHint) tags itself: on a catalogue page, outside any PermPart, it becomes the part
 * «card_<hash of its label>» — so «افتح الصفحة وظبطها» can hide any card on any page without hand-tagging it.
 */
export function AutoPart({ prefix, label, children }: { prefix: string; label: unknown; children: ReactNode }) {
  return <AutoPartInner prefix={prefix} label={label} kind="كارت">{children}</AutoPartInner>;
}

/** Any custom card markup: `<PermCard label="رصيد الخزنة دلوقتي">…</PermCard>` — its own switch on any catalogue page. */
export function PermCard({ label, children }: { label: string; children: ReactNode }) {
  return <AutoPartInner prefix="card" label={label} kind="كارت">{children}</AutoPartInner>;
}

function AutoPartInner({ prefix, label, kind, children }: { prefix: string; label: unknown; kind: string; children: ReactNode }) {
  const inside = useContext(InPart);
  const page = useCurrentPermPage();
  const text = typeof label === "string" || typeof label === "number" ? String(label) : null;
  if (inside || !page || !text) return <>{children}</>;
  return <PermPart page={page} part={autoPartId(prefix, text)} label={`${kind} «${text}»`} auto>{children}</PermPart>;
}

const tabPartId = (value: string) => `tab_${value.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;

/**
 * Every <TabsTrigger> / <TabsContent> on a catalogue page is the part «tab_<value>»: hidden → the tab button and its
 * content both disappear. In «افتح الصفحة وظبطها» the switch sits on the tab button (the content is only shown).
 */
export function AutoTab({ value, label, as, children }: { value: string; label?: unknown; as: "trigger" | "content"; children: ReactNode }) {
  const page = useCurrentPermPage();
  if (!page || !value) return <>{children}</>;
  return <AutoTabInner page={page} value={value} label={label} as={as}>{children}</AutoTabInner>;
}

function AutoTabInner({ page, value, label, as, children }: { page: string; value: string; label?: unknown; as: "trigger" | "content"; children: ReactNode }) {
  const { can } = useAuth();
  const c = usePermCustomize();
  const part = tabPartId(value);
  const key = partKey(page, part);
  const text = typeof label === "string" ? label : value;
  const visible = c.active ? c.isVisible(key) : can(key);
  const { register, active } = c;
  const info = partInfo(page, part);
  const name = info?.label ?? `تاب «${text}»`;
  useEffect(() => (active && as === "trigger" ? register(key, { page, part, info, label: name }) : undefined), [active, as, register, key, page, part, info, name]);
  if (as === "trigger" && c.active && !c.preview) {
    // the switch sits NEXT to the tab (not on it), so the owner can still open the tab to set what is inside
    return (
      <span className={`inline-flex items-center gap-0.5 rounded-md ${visible ? "" : "ring-2 ring-dashed ring-rose-400/70"}`} data-perm-part={key}>
        <span className={visible ? "" : "opacity-40"}>{children}</span>
        <button type="button" aria-pressed={visible} aria-label={`${visible ? "إخفاء" : "إظهار"} ${name} عن ${c.targetName}`} onClick={() => c.toggle(key)}
          className={`inline-flex items-center justify-center w-7 h-7 rounded-full border ${visible ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-white text-rose-600 border-rose-300"}`}>
          {visible ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      </span>
    );
  }
  return visible || (as === "content" && c.active && !c.preview) ? <>{children}</> : null;
}
