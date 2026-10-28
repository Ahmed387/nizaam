import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { canEditReturn } from "@/lib/returnEdit";

/**
 * «تعديل المرتجع» — لكل اللي معاه صلاحية «returns.update» (مفتوحة للكل، المالك يقفلها من الصلاحيات — 0132). بيفتح شاشة المرتجع بالبيانات القديمة؛ عند الحفظ السيرفر بيلغي القديم
 * ويسجّل الجديد بنفس تاريخه (المرتجع القديم بيفضل في القايمة ملغي ومربوط بالجديد).
 */
export function EditReturnButton({ kind, branchId, ret }: { kind: "sale" | "purchase"; branchId: string; ret: any }) {
  const { canInBranch } = useAuth();
  const nav = useNavigate();
  if (!canEditReturn(ret, canInBranch("returns.update", ret?.branch_id ?? branchId))) return null;
  const path = kind === "sale" ? "sale-returns" : "purchase-returns";
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2"
      title="تعديل المرتجع — يلغي القديم ويسجّل الجديد بنفس التاريخ"
      onClick={() => nav(`/branch/${branchId}/${path}/new?edit=${ret.id}`)}
    >
      <PencilLine className="w-4 h-4" /> تعديل المرتجع
    </Button>
  );
}

/** «ده تعديل لـ …» / «اتعدل ← …» تحت رأس المرتجع. */
export function ReturnEditLinks({ kind, branchId, ret }: { kind: "sale" | "purchase"; branchId: string; ret: any }) {
  const table = kind === "sale" ? "returns" : "purchase_returns";
  const path = kind === "sale" ? "sale-returns" : "purchase-returns";
  const [prev, setPrev] = useState<{ id: string; return_number: string } | null>(null);
  const [next, setNext] = useState<{ id: string; return_number: string } | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const prevId = ret?.replaces_return_id;
      if (prevId) {
        const { data } = await (supabase.from(table as any) as any).select("id, return_number").eq("id", prevId).maybeSingle();
        if (!off) setPrev(data ?? null);
      } else setPrev(null);
      if (ret?.id) {
        const { data } = await (supabase.from(table as any) as any).select("id, return_number").eq("replaces_return_id", ret.id).maybeSingle();
        if (!off) setNext(data ?? null);
      }
    })();
    return () => { off = true; };
  }, [ret?.id, ret?.replaces_return_id, table]);

  if (!prev && !next) return null;
  return (
    <div dir="rtl" className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm font-medium flex flex-wrap gap-x-4 gap-y-1">
      {prev && (
        <span>
          ✏️ ده تعديل للمرتجع{" "}
          <Link className="font-mono font-bold text-primary underline" to={`/branch/${branchId}/${path}/${prev.id}`}>{prev.return_number}</Link>
          {" "}(القديم اتلغى بنفس التاريخ)
        </span>
      )}
      {next && (
        <span>
          ✏️ المرتجع ده اتعدل ← الجديد{" "}
          <Link className="font-mono font-bold text-primary underline" to={`/branch/${branchId}/${path}/${next.id}`}>{next.return_number}</Link>
        </span>
      )}
    </div>
  );
}
