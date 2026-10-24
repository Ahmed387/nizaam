import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppRole, DEFAULT_ROLE_PERMISSIONS, MANAGED_ROLES, ROLE_LABELS } from "@/lib/roles";
import { PERMISSION_CATALOG, pageForPath, partKey } from "@/lib/permissionCatalog";
import { Overrides, RolePerms, effective, setOverride, toRows } from "@/lib/permissionModel";
import { rpcErrorText } from "@/lib/rpcError";

/**
 * «ظبطها على الصفحة نفسها» (owner idea 2026-10-24): open any page that has parts with `?perm_for=<user id>`.
 * Every <PermPart> on it gets a «ظاهر / مخفي» button for THAT employee; «شوفها بعينه» shows the page as he will
 * see it. Only an owner / admin gets the mode; saving goes through save_user_permissions (migration 0114).
 */
interface Customize {
  active: boolean;
  preview: boolean;
  targetName: string;
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
}

const Ctx = createContext<Customize>({ active: false, preview: false, targetName: "", isVisible: () => true, toggle: () => {} });
export const usePermCustomize = () => useContext(Ctx);

export function PermCustomizeProvider({ children }: { children: ReactNode }) {
  const { isAdmin, isOwner, tenantId } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const target = new URLSearchParams(loc.search).get("perm_for");
  const allowed = !!target && (isAdmin || isOwner);
  const [state, setState] = useState<{ uid: string; name: string; role: string; rolePerms: RolePerms; saved: Overrides; draft: Overrides } | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!allowed || !tenantId || state?.uid === target) return;
    (async () => {
      const [prof, roles, rp, ups] = await Promise.all([
        supabase.from("profiles").select("name, username").eq("id", target!).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", target!),
        supabase.from("role_permissions" as any).select("role, permission_key, allowed").eq("tenant_id", tenantId),
        supabase.from("user_permissions" as any).select("permission_key, allowed").eq("user_id", target!),
      ]);
      const pmap: RolePerms = {};
      ((rp.data ?? []) as any[]).forEach((r) => ((pmap[r.role] = pmap[r.role] ?? {})[r.permission_key] = !!r.allowed));
      Object.entries(DEFAULT_ROLE_PERMISSIONS).forEach(([r, d]) => { if (!pmap[r]) pmap[r] = { ...d }; });
      const role = ((roles.data ?? []) as any[]).map((r) => r.role).find((r) => MANAGED_ROLES.includes(r)) ?? "";
      const o: Overrides = Object.fromEntries(((ups.data ?? []) as any[]).map((r) => [r.permission_key, !!r.allowed]));
      setState({ uid: target!, name: (prof.data as any)?.name || (prof.data as any)?.username || "الموظف", role, rolePerms: pmap, saved: o, draft: o });
    })();
  }, [allowed, target, tenantId, state?.uid]);

  const active = allowed && !!state && state.uid === target;
  const isVisible = useCallback((key: string) => (state ? effective(state.role, state.rolePerms, state.draft, key) : true), [state]);
  const toggle = useCallback((key: string) => setState((s) => (s ? { ...s, draft: setOverride(s.role, s.rolePerms, s.draft, key, !effective(s.role, s.rolePerms, s.draft, key)) } : s)), []);

  const page = pageForPath(loc.pathname);
  const parts = page?.parts ?? [];
  const hiddenCount = state ? parts.filter((p) => !isVisible(partKey(page!.key, p.id))).length : 0;
  const dirty = !!state && JSON.stringify(state.draft) !== JSON.stringify(state.saved);

  const exit = () => nav(`/admin/settings?tab=user-permissions&user=${target}`);
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
  const resetParts = () => setState((s) => {
    if (!s || !page) return s;
    const d = { ...s.draft };
    parts.forEach((p) => delete d[partKey(page.key, p.id)]);
    return { ...s, draft: d };
  });
  const showAll = () => setState((s) => {
    if (!s || !page) return s;
    let d = { ...s.draft };
    parts.forEach((p) => { d = setOverride(s.role, s.rolePerms, d, partKey(page.key, p.id), true); });
    return { ...s, draft: d };
  });

  const value = useMemo<Customize>(() => ({ active, preview, targetName: state?.name ?? "", isVisible, toggle }), [active, preview, state?.name, isVisible, toggle]);
  const otherPages = PERMISSION_CATALOG.flatMap((s) => s.pages).filter((p) => p.route && p.key !== page?.key);
  const branchId = /^\/branch\/([^/]+)/.exec(loc.pathname)?.[1];

  return (
    <Ctx.Provider value={value}>
      {active && (
        <div dir="rtl" role="region" aria-label="شريط تظبيط الصفحة" className="sticky top-0 z-[60] bg-slate-900 text-white">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 font-extrabold"><Eye className="w-4 h-4" aria-hidden="true" /> بتظبط اللي يظهر لـ {state!.name} ({ROLE_LABELS[state!.role as AppRole] ?? "بدون دور"})</span>
            <span className="text-slate-300">{page ? `${page.label}: ${hiddenCount} مخفي من ${parts.length}` : "الصفحة دي لسه مفيهاش أجزاء بتتظبط"}</span>
            {otherPages.map((p) => {
              const to = p.route!.includes(":branch") ? (branchId ? p.route!.replace(":branch", branchId) : null) : p.route!;
              return to ? <Link key={p.key} to={`${to}?perm_for=${target}`} className="text-slate-200 underline underline-offset-2 hover:text-white">{p.label}</Link> : null;
            })}
            <span className="flex-1" />
            <button type="button" aria-pressed={preview} onClick={() => setPreview((v) => !v)} className="min-h-[36px] rounded-lg border border-slate-500 px-3 font-bold hover:bg-slate-800">
              {preview ? "رجّع الأزرار" : "شوفها بعينه"}
            </button>
            <button type="button" onClick={showAll} className="min-h-[36px] rounded-lg border border-slate-500 px-3 font-bold hover:bg-slate-800">أظهر الكل</button>
            <button type="button" onClick={resetParts} className="min-h-[36px] rounded-lg border border-slate-500 px-3 font-bold hover:bg-slate-800"><RotateCcw className="w-3.5 h-3.5 inline ml-1" aria-hidden="true" />رجّعه للقالب</button>
            <button type="button" disabled={saving || !dirty} onClick={() => save(false)} className="min-h-[36px] rounded-lg border border-slate-500 px-3 font-bold hover:bg-slate-800 disabled:opacity-50">حفظ</button>
            <button type="button" disabled={saving} onClick={() => (dirty ? save(true) : exit())} className="min-h-[36px] rounded-lg bg-white text-slate-900 px-3 font-extrabold disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : <Save className="w-4 h-4 inline ml-1" aria-hidden="true" />} {dirty ? "حفظ وخروج" : "خروج"}
            </button>
          </div>
          {page && !preview && parts.some((p) => p.offscreen) && (
            <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 text-xs">
              <span className="text-slate-300">أجزاء مش باينة دلوقتي:</span>
              {parts.filter((p) => p.offscreen).map((p) => {
                const k = partKey(page.key, p.id);
                const v = isVisible(k);
                return (
                  <button key={p.id} type="button" aria-pressed={v} onClick={() => toggle(k)}
                    className={`min-h-[32px] rounded-full px-3 font-bold border ${v ? "bg-emerald-500/20 border-emerald-400 text-emerald-100" : "bg-transparent border-rose-400 text-rose-200"}`}>
                    {p.kind}: {p.label} — {v ? "ظاهر ✓" : "مخفي"}
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
 * A card / box / column of a page that the owner can show or hide per employee.
 * Normal use: renders the children only when `can("part.<page>.<part>.view")` (the part follows its page when
 * nobody set it). In customize mode: wraps them with a «ظاهر / مخفي» button for the employee being set up.
 */
export function PermPart({ page, part, children, className }: { page: string; part: string; children: ReactNode; className?: string }) {
  const { can } = useAuth();
  const c = usePermCustomize();
  const key = partKey(page, part);
  const meta = PERMISSION_CATALOG.flatMap((s) => s.pages).find((p) => p.key === page)?.parts.find((x) => x.id === part);
  if (!c.active) return can(key) ? <>{children}</> : null;
  const visible = c.isVisible(key);
  // a dialog / alert is not on the screen: it is switched from the bar's «أجزاء مش باينة دلوقتي» list
  if (c.preview || meta?.offscreen) return visible ? <>{children}</> : null;
  return (
    <div className={`relative rounded-xl ${visible ? "ring-2 ring-emerald-400/60" : "ring-2 ring-dashed ring-rose-400/70"} ${className ?? ""}`} data-perm-part={key}>
      <div className={visible ? "" : "opacity-40 pointer-events-none select-none"} aria-hidden={!visible}>{children}</div>
      <button type="button" aria-pressed={visible} aria-label={`${visible ? "إخفاء" : "إظهار"} ${meta?.label ?? part} عن ${c.targetName}`} onClick={() => c.toggle(key)}
        className={`absolute top-2 left-2 z-10 flex items-center gap-1 min-h-[36px] rounded-full px-3 text-xs font-extrabold shadow ${visible ? "bg-emerald-50 text-emerald-800 border border-emerald-300" : "bg-white text-rose-700 border border-rose-300"}`}>
        {visible ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
        {visible ? "ظاهر" : "مخفي — أظهره"}
        {meta?.sensitive && <Lock className="w-3 h-3" aria-label="رقم حساس" />}
      </button>
      {!visible && <span className="absolute bottom-2 left-2 z-10 rounded-full bg-rose-600 text-white text-[11px] font-extrabold px-2 py-0.5">مخفي عن {c.targetName}</span>}
    </div>
  );
}

