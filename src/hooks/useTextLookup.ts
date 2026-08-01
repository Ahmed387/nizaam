import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface LookupItem {
  id: string;
  name: string;
}

/**
 * Generic hook for simple {id, name} lookup tables scoped per tenant.
 * Mirrors the shape of useColors but without the `hex` column.
 * Used by product_types, capacities, sizes, brands.
 */
export type LookupTableName = "product_types" | "capacities" | "sizes" | "brands";

export function useTextLookup(table: LookupTableName) {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.from(table as any).select("id,name").order("name");
    setItems((data ?? []) as any);
    setLoading(false);
  }, [table]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`${table}-${Math.random().toString(36).slice(2, 7)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, table]);

  const add = async (name: string) => {
    if (!tenantId) throw new Error("no tenant");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("الاسم مطلوب");
    const { data, error } = await supabase
      .from(table as any)
      .insert({ tenant_id: tenantId, name: trimmed } as any)
      .select("id,name")
      .single();
    if (error) throw error;
    return data as unknown as LookupItem;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from(table as any).delete().eq("id", id);
    if (error) throw error;
  };

  const update = async (id: string, name: string) => {
    const { error } = await supabase.from(table as any).update({ name: name.trim() } as any).eq("id", id);
    if (error) throw error;
  };

  return { items, loading, add, remove, update, reload: load };
}

export const useProductTypes = () => useTextLookup("product_types");
export const useCapacities   = () => useTextLookup("capacities");
export const useSizes        = () => useTextLookup("sizes");
export const useBrands       = () => useTextLookup("brands");
