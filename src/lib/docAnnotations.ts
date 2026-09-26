import { supabase } from "@/integrations/supabase/client";

export type AnnotationKind = "invoice" | "shipment" | "sale_return" | "purchase_return" | "voucher" | "stock_transfer";

/** Saves «المستلم» and «الملاحظات» only — never touches amounts, dates or entries. */
export async function saveDocAnnotations(kind: AnnotationKind, id: string, recipient: string, notes: string) {
  const { error } = await supabase.rpc("set_document_annotations" as any, {
    p_kind: kind, p_id: id, p_recipient: recipient ?? "", p_notes: notes ?? "",
  });
  if (error) throw error;
}
