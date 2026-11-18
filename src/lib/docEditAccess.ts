/** 0257: who may ASK to edit a document (every edit still waits for the owner's approval). Owner-granted only. */
export type DocEditEntity = "invoice" | "shipment" | "sale_return" | "purchase_return" | "voucher";

export const DOC_EDIT_KEY: Record<DocEditEntity, string> = {
  invoice: "doc_edit_sales.update",
  shipment: "doc_edit_purchases.update",
  sale_return: "doc_edit_returns.update",
  purchase_return: "doc_edit_returns.update",
  voucher: "doc_edit_vouchers.update",
};

/** `canInBranch` from useAuth: true for the owner, else only the employee's own rule in that branch / every branch. */
export const canEditDoc = (canInBranch: (key: string, branchId?: string | null) => boolean, entity: DocEditEntity, branchId?: string | null) =>
  canInBranch(DOC_EDIT_KEY[entity], branchId ?? null);
