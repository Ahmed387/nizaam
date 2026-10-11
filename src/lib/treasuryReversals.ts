/** Till rows that only undo another row (voucher cancel, cancelled returns, money back on a cancelled
 *  invoice, payment voids / edits and their fee, reversing corrections). The treasury tables list them in
 *  their own tab; balances and period cards keep every row. */
export const REVERSAL_CATEGORIES = [
  "إلغاء سند", "return_cancel", "purchase_return_cancel", "sales_refund",
  "payment_edit_reversal", "payment_in_void", "payment_out_void", "fee_void", "تصحيح قيد عكسي",
];
