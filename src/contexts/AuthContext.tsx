import { withAuthRetry } from "@/lib/authRetry";
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { AppRole, fetchUserContext, DEFAULT_ROLE_PERMISSIONS, checkPermission, branchKey, BranchRule } from "@/lib/roles";
import { CompanyRole, RoleSetting, roleName, tplRole, withCompanyRole } from "@/lib/companyRoles";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  is_suspended?: boolean;
  suspension_reason?: string | null;
  owner_user_id?: string | null;
  setup_completed?: boolean;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  profile: { id: string; name: string; username: string } | null;
  tenantId: string | null;
  tenant: Tenant | null;
  roles: AppRole[];
  branches: { id: string; name: string; code: string; access_level?: "manage" | "read"; full_access?: boolean; branch_role?: string | null; branch_template?: string | null }[];
  loading: boolean;
  ctxReady: boolean;
  /** Branch ids this user may see in admin pages; null = all branches. */
  branchScope: string[] | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** حساب مراقب — قراءة فقط لكل شاشات المالك */
  isViewer: boolean;
  isOwner: boolean;
  hasRole: (r: AppRole) => boolean;
  can: (key: string) => boolean;
  /** مستوى صلاحية المستخدم على فرع معيّن (إدارة كاملة / عرض فقط). */
  branchAccess: (branchId?: string | null) => "manage" | "read";
  /** هل الفرع مضبوط على «عرض فقط» لهذا المستخدم؟ */
  isBranchReadOnly: (branchId?: string | null) => boolean;
  /** فحص صلاحية داخل فرع محدد (يطبّق سقف الحظر النهائي). */
  canInBranch: (key: string, branchId?: string | null) => boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** The company role this user is on («مندوب مبيعات», migration 0115), if any. */
  companyRole: CompanyRole | null;
  /** Ready roles hidden / renamed in this company. */
  roleSettings: RoleSetting[];
  /** A role's name in this company (renamed ready role, or the usual label). */
  roleLabel: (role: string) => string;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthCtx["profile"]>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [branches, setBranches] = useState<AuthCtx["branches"]>([]);
  const [loading, setLoading] = useState(true);
  const [ctxReady, setCtxReady] = useState(false);
  const [permsByRole, setPermsByRole] = useState<Record<string, Record<string, boolean>>>({});
  const [userPerms, setUserPerms] = useState<Record<string, boolean>>({});
  const [companyRole, setCompanyRole] = useState<CompanyRole | null>(null);
  const [roleSettings, setRoleSettings] = useState<RoleSetting[]>([]);
  // company roles chosen as the template of one of his branches (migration 0122)
  const [branchTemplates, setBranchTemplates] = useState<CompanyRole[]>([]);
  const currentUserIdRef = useRef<string | null>(null);

  const loadPerms = async (tid: string | null) => {
    if (!tid) { setPermsByRole({}); return; }
    const { data } = await supabase.from("role_permissions" as any).select("role, permission_key, allowed").eq("tenant_id", tid);
    const map: Record<string, Record<string, boolean>> = {};
    (data ?? []).forEach((r: any) => {
      map[r.role] = map[r.role] ?? {};
      map[r.role][r.permission_key] = !!r.allowed;
    });
    // Merge defaults for any role not yet customised
    Object.entries(DEFAULT_ROLE_PERMISSIONS).forEach(([role, defaults]) => {
      if (!map[role]) map[role] = { ...defaults };
    });
    setPermsByRole(map);
  };

  const [connError, setConnError] = useState(false);
  const withTimeout = <T,>(p: PromiseLike<T>, ms = 45000): Promise<T> =>
    Promise.race([
      Promise.resolve(p),
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
    ]);

  const loadCtxInner = async (uid: string) => {
    // Speed (login): the user's own permission overrides don't depend on the context — fetch them alongside it.
    const overridesP = supabase.from("user_permissions" as any).select("permission_key, allowed, branch_id").eq("user_id", uid);
    // his company role and the company's role names (migration 0115); a database without 0115 just has none
    const companyRoleP = supabase.from("user_company_roles" as any).select("template_id, permission_templates(id, name, base_role, perms)").eq("user_id", uid).maybeSingle();
    const ctx = await fetchUserContext(uid);
    const settingsP = ctx.tenantId
      ? supabase.from("tenant_role_settings" as any).select("role, hidden, label").eq("tenant_id", ctx.tenantId)
      : Promise.resolve({ data: [] as any[] });
    const [, { data: overrides }, cr, rs] = await Promise.all([loadPerms(ctx.tenantId), overridesP, companyRoleP, settingsP]);
    const tpl = (cr as any)?.data?.permission_templates;
    setCompanyRole(tpl ? { id: tpl.id, name: tpl.name, base_role: tpl.base_role, perms: tpl.perms ?? {} } : null);
    setRoleSettings((((rs as any)?.data ?? []) as any[]).map((x) => ({ role: x.role, hidden: !!x.hidden, label: x.label ?? null })));
    setProfile(ctx.profile as any);
    setTenantId(ctx.tenantId);
    setTenant(ctx.tenant);
    const tplIds = Array.from(new Set((ctx.branches as any[]).map((b) => b?.branch_template).filter(Boolean)));
    if (tplIds.length) {
      const { data: bt } = await supabase.from("permission_templates" as any).select("id, name, base_role, perms").in("id", tplIds);
      setBranchTemplates(((bt ?? []) as any[]).map((t) => ({ id: t.id, name: t.name, base_role: t.base_role, perms: t.perms ?? {} })));
    } else setBranchTemplates([]);
    setRoles(ctx.roles);
    // الأوعية المالية النظامية ليست فروعًا تشغيلية، فتُستبعد من قوائم الفروع في الواجهة.
    setBranches((ctx.branches as any[]).filter((b) => !b?.is_system) as any);
    // per-branch overrides (migration 0114) are kept as «key@branch»; the plain key is the base for every branch
    setUserPerms(Object.fromEntries((overrides ?? []).map((r: any) => [r.branch_id ? branchKey(r.permission_key, r.branch_id) : r.permission_key, !!r.allowed])));
  };

  // On start-up both getSession() and onAuthStateChange(INITIAL_SESSION) ask for the same context:
  // share one in-flight load per user instead of running the whole round-trip chain twice.
  const inflightRef = useRef<{ uid: string; p: Promise<void> } | null>(null);
  const lastLoadRef = useRef<{ uid: string; at: number } | null>(null);
  const loadCtx = async (uid: string) => {
    try {
      let job = inflightRef.current?.uid === uid ? inflightRef.current.p : null;
      if (!job) {
        job = loadCtxInner(uid).finally(() => { if (inflightRef.current?.p === job) inflightRef.current = null; });
        inflightRef.current = { uid, p: job };
      }
      await withTimeout(job);
      lastLoadRef.current = { uid, at: Date.now() };
      setConnError(false);
      setCtxReady(true);
    } catch (e) {
      console.error("Auth context load failed", e);
      setConnError(true);
    }
  };

  const retryConnection = () => {
    setConnError(false);
    setLoading(true);
    withTimeout(supabase.auth.getSession())
      .then(async ({ data }) => {
        if (data.session?.user) await loadCtx(data.session.user.id);
        else setCtxReady(true);
      })
      .catch(() => setConnError(true))
      .finally(() => setLoading(false));
  };


  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      const nextUserId = sess?.user?.id ?? null;
      setSession(sess);
      setUser(sess?.user ?? null);
      if (nextUserId) {
        // Same user (TOKEN_REFRESHED / tab re-focus / repeated SIGNED_IN):
        // refresh context silently so ProtectedRoute never unmounts the page
        // and in-progress forms (sales, purchases, returns) keep their state.
        const sameUser = currentUserIdRef.current === nextUserId;
        currentUserIdRef.current = nextUserId;
        if (!sameUser) setCtxReady(false);
        // Speed: a token refresh / tab focus fires this again for the same user; the context (roles,
        // branches, permissions) was just loaded and realtime reloads it on any real change — skip.
        if (sameUser && lastLoadRef.current?.uid === nextUserId && Date.now() - lastLoadRef.current.at < 10 * 60_000) return;
        setTimeout(() => loadCtx(nextUserId), 0);
      } else {
        currentUserIdRef.current = null;
        setProfile(null);
        setTenantId(null);
        setTenant(null);
        setRoles([]);
        setBranches([]);
        setUserPerms({});
        setCtxReady(false);
      }
    });

    withTimeout(supabase.auth.getSession()).then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        currentUserIdRef.current = data.session.user.id;
        await loadCtx(data.session.user.id);
      } else setCtxReady(true);
    }).catch(() => setConnError(true))
      .finally(() => setLoading(false));

    // Session resiliency: when the network comes back or the tab regains focus,
    // refresh the token proactively (with backoff) so users are not logged out.
    const refreshIfNeeded = async () => {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (!s?.expires_at) return;
      const secsLeft = s.expires_at - Math.floor(Date.now() / 1000);
      if (secsLeft < 300) {
        await withAuthRetry(() => supabase.auth.refreshSession()).catch(() => undefined);
      }
    };
    const onOnline = () => {
      supabase.auth.startAutoRefresh();
      refreshIfNeeded();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onOnline();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);


  // Realtime: re-fetch context (and force re-login) if this user's roles or branches change
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`user-ctx-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${user.id}` },
        async () => {
          await loadCtx(user.id);
          // Force re-login so JWT/session reflects role change everywhere
          if (typeof window !== "undefined") {
            await supabase.auth.signOut();
            window.location.href = "/login";
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "branch_users", filter: `user_id=eq.${user.id}` },
        () => loadCtx(user.id)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_permissions", filter: `user_id=eq.${user.id}` },
        () => loadCtx(user.id)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Realtime: role permission matrix changes apply instantly (no refresh / re-login needed)
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`role-perms-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_permissions", filter: `tenant_id=eq.${tenantId}` },
        () => loadPerms(tenantId),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  // ===== Hybrid branch access (manage | read) =====
  const isFullAccess =
    roles.includes("admin") ||
    roles.includes("super_admin") ||
    roles.includes("owner") ||
    (!!user?.id && !!tenant?.owner_user_id && user.id === tenant.owner_user_id);

  /** Branch currently open in the URL (/branch/:id/...), if any. */
  const activeBranchId = (): string | null => {
    if (typeof window === "undefined") return null;
    const m = window.location.pathname.match(/^\/branch\/([^/]+)/);
    return m ? m[1] : null;
  };

  const branchLevel = (branchId?: string | null): "manage" | "read" => {
    if (isFullAccess || !branchId) return "manage";
    const b = branches.find((x) => x.id === branchId) as any;
    return b?.access_level === "read" ? "read" : "manage";
  };

  const readOnlyBranch = (branchId?: string | null) => !isFullAccess && branchLevel(branchId) === "read";

  /** How he works in this branch (migration 0122): read / full / its template — same as perm_resolve. */
  const ruleFor = (branchId?: string | null): BranchRule | null => {
    if (isFullAccess || !branchId) return null;
    const b = branches.find((x) => x.id === branchId);
    if (!b) return null;
    return { read: b.access_level === "read", full: !!b.full_access, role: b.branch_template ? tplRole(b.branch_template) : b.branch_role ?? null };
  };

  /** Any permission action that is not a plain view/read. */
  const isWriteKey = (key: string) => {
    const action = key.split(".").pop() ?? "";
    return !["view", "read"].includes(action);
  };

  // a person on a company role is resolved as «tpl:<id>» (its differences over his ready role) — same order as perm_resolve
  const eff0 = withCompanyRole(roles, permsByRole, companyRole);
  // the company roles of his branches as pseudo roles «tpl:<id>» (their ready role's map + their differences)
  const eff = branchTemplates.length
    ? { roles: eff0.roles, permsByRole: branchTemplates.reduce((m, t) => ({ ...m, [tplRole(t.id)]: { ...(m[t.base_role] ?? {}), ...t.perms } }), eff0.permsByRole) }
    : eff0;
  const isFullOwner = roles.includes("owner") || roles.includes("super_admin") || (!!user?.id && !!tenant?.owner_user_id && user.id === tenant.owner_user_id);

  // stable while the roles don't change, so effects that depend on it don't re-run on every auth render
  const hasRole = useCallback((r: AppRole) => roles.includes(r), [roles]);

  const value: AuthCtx = {
    user,
    session,
    profile,
    tenantId,
    tenant,
    roles,
    branches,
    loading,
    ctxReady,
    branchScope:
      roles.includes("admin") || roles.includes("super_admin") || roles.includes("owner") || roles.includes("viewer") || roles.includes("partner") || (!!user?.id && user.id === tenant?.owner_user_id)
        ? null
        : branches.map((b) => b.id),
    isAdmin: roles.includes("admin") || roles.includes("super_admin") || roles.includes("owner"),
    isSuperAdmin: roles.includes("super_admin"),
    // الشريك = رؤية مركزية لكل الفروع بصلاحية قراءة فقط (نفس حدود المراقب).
    isViewer: roles.includes("viewer") || roles.includes("partner"),
    isOwner: roles.includes("owner") || (!!user?.id && !!tenant?.owner_user_id && user.id === tenant.owner_user_id),
    hasRole,
    can: (key) => {
      // the company owner is never restricted (migration 0114)
      if (isFullOwner) return true;
      if (!checkPermission(eff.roles as AppRole[], eff.permsByRole, key, userPerms, activeBranchId(), ruleFor(activeBranchId()))) return false;
      // Hard cap: inside a branch marked "read", every write permission is dropped
      // regardless of role matrix or per-user overrides.
      return !isWriteKey(key) || !readOnlyBranch(activeBranchId());
    },
    branchAccess: (branchId) => (isFullAccess ? "manage" : branchLevel(branchId)),
    isBranchReadOnly: (branchId) => readOnlyBranch(branchId),
    canInBranch: (key, branchId) => {
      if (isFullOwner) return true;
      if (!checkPermission(eff.roles as AppRole[], eff.permsByRole, key, userPerms, branchId, ruleFor(branchId))) return false;
      return !isWriteKey(key) || !readOnlyBranch(branchId);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refresh: async () => {
      if (user) await loadCtx(user.id);
    },
    companyRole,
    roleSettings,
    roleLabel: (r) => roleName(r, roleSettings),
  };

  return (
    <Ctx.Provider value={value}>
      {connError && (
        <div dir="rtl" role="status" className="fixed top-2 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-3 rounded-md border border-warning/40 bg-card px-4 py-2 text-sm shadow-lg">
          <span className="text-foreground">الاتصال بطيء — جاري المحاولة</span>
          <button className="font-semibold text-primary" onClick={retryConnection}>إعادة المحاولة</button>
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) {
    // قد يحدث أثناء Hot Module Reload — أعد تحميل الصفحة
    if (typeof window !== "undefined") window.location.reload();
    throw new Error("useAuth must be inside AuthProvider");
  }
  return c;
};
