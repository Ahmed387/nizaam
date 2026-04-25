import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { AppRole, fetchUserContext } from "@/lib/roles";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  profile: { id: string; name: string; username: string } | null;
  roles: AppRole[];
  branches: { id: string; name: string; code: string }[];
  loading: boolean;
  isAdmin: boolean;
  hasRole: (r: AppRole) => boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthCtx["profile"]>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [branches, setBranches] = useState<AuthCtx["branches"]>([]);
  const [loading, setLoading] = useState(true);

  const loadCtx = async (uid: string) => {
    const ctx = await fetchUserContext(uid);
    setProfile(ctx.profile as any);
    setRoles(ctx.roles);
    setBranches(ctx.branches as any);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadCtx(sess.user.id), 0);
      } else {
        setProfile(null);
        setRoles([]);
        setBranches([]);
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) await loadCtx(data.session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    user,
    session,
    profile,
    roles,
    branches,
    loading,
    isAdmin: roles.includes("admin"),
    hasRole: (r) => roles.includes(r),
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
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
};
