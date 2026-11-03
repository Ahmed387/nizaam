import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * «فرع داخلي» (migration 0144): this account is really one of our branches (e.g. «المخزن الرئيسي» = شلبى). No document
 * or branch figure changes; company-wide reports show it apart («منها بين الفروع»). Owner / admin set it; others see it.
 */
export function InternalBranchTag({ contactId }: { contactId: string }) {
  const { isOwner, isAdmin, branches } = useAuth();
  const [value, setValue] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const canSet = isOwner || isAdmin;

  useEffect(() => {
    let off = false;
    supabase.from("contacts" as any).select("internal_branch_id").eq("id", contactId).maybeSingle()
      .then(({ data }) => { if (!off) { setValue((data as any)?.internal_branch_id ?? null); setLoaded(true); } });
    return () => { off = true; };
  }, [contactId]);

  const list = (branches ?? []).filter((b: any) => !b.is_system);
  const name = list.find((b: any) => b.id === value)?.name;
  if (!loaded || (!canSet && !value)) return null;

  const save = async (v: string) => {
    const next = v === "none" ? null : v;
    const { error } = await (supabase.rpc as any)("set_contact_internal_branch", { p_contact: contactId, p_branch: next });
    if (error) return toast.error(error.message);
    setValue(next);
    toast.success(next ? `اتعلّم «فرع داخلي» (${list.find((b: any) => b.id === next)?.name ?? ""})` : "اتشال «فرع داخلي»");
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      {canSet ? (
        <>
          <span className="text-muted-foreground">الحساب ده فرع من فروعنا؟</span>
          <Select value={value ?? "none"} onValueChange={save}>
            <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">لأ — عميل / مورد من بره</SelectItem>
              {list.map((b: any) => <SelectItem key={b.id} value={b.id}>فرع داخلي: {b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">مش بيغيّر أي مستند — بيفصله بس في تقارير الشركة كلها</span>
        </>
      ) : (
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">فرع داخلي: {name}</span>
      )}
    </div>
  );
}
