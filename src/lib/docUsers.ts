import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DocUser { id: string; name: string }

const cache = new Map<string, Promise<DocUser[]>>();

/** Users who can make documents in a branch (`branch_doc_users`, 0258) — the «المستلم / البائع» list of the unified filter. */
export function loadDocUsers(branchId: string): Promise<DocUser[]> {
  if (!cache.has(branchId)) {
    cache.set(branchId, Promise.resolve(supabase.rpc("branch_doc_users" as any, { p_branch: branchId } as any)).then(({ data, error }: any) => {
      if (error) { cache.delete(branchId); return []; }
      return ((data ?? []) as DocUser[]).filter((u) => u?.id && u?.name);
    }));
  }
  return cache.get(branchId)!;
}

export function useDocUsers(branchId?: string | null): DocUser[] {
  const [users, setUsers] = useState<DocUser[]>([]);
  useEffect(() => {
    let off = false;
    if (!branchId) { setUsers([]); return; }
    loadDocUsers(branchId).then((u) => { if (!off) setUsers(u); });
    return () => { off = true; };
  }, [branchId]);
  return users;
}

/** Dropdown options: by name (documents store the name in received_by) or by id (till rows store created_by). */
export const docUserOptions = (users: DocUser[], by: "name" | "id" = "name") =>
  users.map((u) => ({ value: by === "name" ? u.name : u.id, label: u.name }));

/** the same list over several branches (company screens), one name each */
export function useDocUsersMany(branchIds: string[]): DocUser[] {
  const [users, setUsers] = useState<DocUser[]>([]);
  const key = branchIds.slice().sort().join(",");
  useEffect(() => {
    let off = false;
    if (!key) { setUsers([]); return; }
    Promise.all(key.split(",").map(loadDocUsers)).then((lists) => {
      if (off) return;
      const seen = new Map<string, DocUser>();
      lists.flat().forEach((u) => { if (!seen.has(u.id)) seen.set(u.id, u); });
      setUsers(Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, "ar")));
    });
    return () => { off = true; };
  }, [key]);
  return users;
}
