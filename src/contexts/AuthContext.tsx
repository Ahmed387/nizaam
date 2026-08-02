import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { AppRole, fetchUserContext, DEFAULT_ROLE_PERMISSIONS, checkPermission } from "@/lib/roles";

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
  branches: { id: string; name: string; code: string }[];
  loading: boolean;
  ctxReady: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isOwner: boolean;
  hasRole: (r: AppRole) => boolean;
  can: (key: string) => boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
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

  const loadCtx = async (uid: string) => {
    const ctx = await fetchUserContext(uid);
    setProfile(ctx.profile as any);
    setTenantId(ctx.tenantId);
    setTenant(ctx.tenant);
    setRoles(ctx.roles);
    setBranches(ctx.branches as any);
    await loadPerms(ctx.tenantId);
    setCtxReady(true);
  };


  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setCtxReady(false);
        setTimeout(() => loadCtx(sess.user.id), 0);
      } else {
        setProfile(null);
        setTenantId(null);
        setTenant(null);
        setRoles([]);
        setBranches([]);
        setCtxReady(false);
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) await loadCtx(data.session.user.id);
      else setCtxReady(true);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

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
    isAdmin: roles.includes("admin") || roles.includes("super_admin"),
    isSuperAdmin: roles.includes("super_admin"),
    isOwner: !!user?.id && !!tenant?.owner_user_id && user.id === tenant.owner_user_id,
    hasRole: (r) => roles.includes(r),
    can: (key) => checkPermission(roles, permsByRole, key),
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refresh: async () => {
      if (user) await loadCtx(user.id);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
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
