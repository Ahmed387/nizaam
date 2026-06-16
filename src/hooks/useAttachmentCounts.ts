import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RecordType =
  | "voucher"
  | "invoice"
  | "shipment"
  | "sale_return"
  | "purchase_return"
  | "stock_transfer"
  | "inventory_adjustment";

/**
 * Returns a map of record_id → attachment count for the given record_type, filtered
 * to the supplied ids. Subscribes to realtime changes scoped to that record_type so
 * paperclip indicators in list screens stay live without manual refresh.
 */
export function useAttachmentCounts(recordType: RecordType, ids: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = ids.join(",");

  useEffect(() => {
    if (ids.length === 0) {
      setCounts({});
      return;
    }
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("attachments" as any)
        .select("record_id")
        .eq("record_type", recordType)
        .in("record_id", ids);
      if (error || cancelled) return;
      const map: Record<string, number> = {};
      (data as any[] | null)?.forEach((r) => {
        map[r.record_id] = (map[r.record_id] ?? 0) + 1;
      });
      setCounts(map);
    };
    load();

    const ch = supabase
      .channel(`att-list-${recordType}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attachments", filter: `record_type=eq.${recordType}` },
        (payload: any) => {
          const row = (payload.new ?? payload.old) as { record_id?: string } | undefined;
          if (!row?.record_id || !ids.includes(row.record_id)) return;
          load();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordType, key]);

  return counts;
}
