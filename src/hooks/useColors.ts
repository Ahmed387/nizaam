import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ColorItem {
  id: string;
  name: string;
  hex: string;
}

export function useColors() {
  const { tenantId } = useAuth();
  const [colors, setColors] = useState<ColorItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("colors" as any)
      .select("id,name,hex")
      .order("name");
    setColors((data ?? []) as any);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`colors-${Math.random().toString(36).slice(2, 7)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "colors" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const addColor = async (name: string, hex: string) => {
    if (!tenantId) throw new Error("no tenant");
    const { data, error } = await supabase
      .from("colors" as any)
      .insert({ tenant_id: tenantId, name: name.trim(), hex } as any)
      .select("id,name,hex")
      .single();
    if (error) throw error;
    return data as unknown as ColorItem;
  };

  const removeColor = async (id: string) => {
    // Optimistic: remove from local state instantly, roll back on server failure.
    const removed = colors.find((c) => c.id === id);
    setColors((prev) => prev.filter((c) => c.id !== id));
    const { error } = await supabase.from("colors" as any).delete().eq("id", id);
    if (error) {
      if (removed) setColors((prev) => [...prev, removed].sort((a, b) => a.name.localeCompare(b.name, "ar")));
      throw error;
    }
  };

  const updateColor = async (id: string, patch: Partial<Pick<ColorItem, "name" | "hex">>) => {
    const previous = colors.find((c) => c.id === id);
    setColors((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from("colors" as any).update(patch as any).eq("id", id);
    if (error) {
      if (previous) setColors((prev) => prev.map((c) => (c.id === id ? previous : c)));
      throw error;
    }
  };

  const hexFor = (name?: string | null) => {
    if (!name) return null;
    return colors.find((c) => c.name === name)?.hex ?? null;
  };

  return { colors, loading, addColor, removeColor, updateColor, hexFor, reload: load };
}
