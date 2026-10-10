import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/** Per-branch switch: may the branch sell a product it does not have yet (negative stock, 0066)? */
export function NegativeStockSetting() {
  const [rows, setRows] = useState<{ id: string; name: string; allow_negative_stock: boolean }[]>([]);
  useEffect(() => {
    supabase.from("branches").select("id, name, allow_negative_stock").eq("is_system", false).order("name")
      .then(({ data }) => setRows((data as any) ?? []));
  }, []);
  const toggle = async (id: string, v: boolean) => {
    const { error } = await supabase.from("branches").update({ allow_negative_stock: v } as any).eq("id", id);
    if (error) return toast.error(error.message);
    setRows((r) => r.map((x) => (x.id === id ? { ...x, allow_negative_stock: v } : x)));
    toast.success(v ? "مسموح البيع بالسالب في الفرع ده" : "البيع بالسالب اتقفل في الفرع ده");
  };
  return (
    <div className="space-y-2">
      <div className="font-bold">البيع بالسالب (من بضاعة مورد مجاور لحد ما بضاعة الفرع توصل)</div>
      <p className="text-xs text-muted-foreground">
        لو مسموح: الفاتورة بتتعمل والكمية بتبقى بالسالب، والتكلفة بتتحسب مؤقتاً بآخر سعر شراء للصنف.
        أول ما البضاعة توصل (فاتورة شراء أو تحويل)، السالب بيتسوّى لوحده والتكلفة والربح بيتصححوا على سعر الشراء الفعلي.
      </p>
      {rows.map((b) => (
        <label key={b.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span>{b.name}</span>
          <Switch checked={!!b.allow_negative_stock} onCheckedChange={(v) => toggle(b.id, v)} />
        </label>
      ))}
    </div>
  );
}
