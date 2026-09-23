/** Operational (accounting) date of a document: invoice_date, falling back to created_at for legacy rows. */
export function docDate(row: { invoice_date?: string | null; created_at?: string | null } | null | undefined): string {
  return (row?.invoice_date || row?.created_at || "") as string;
}
/** YYYY-MM-DD of the operational date. */
export const docDay = (row: Parameters<typeof docDate>[0]) => docDate(row).slice(0, 10);
/** Column name to filter/sort documents by for period attribution. */
export const DOC_DATE_COL = "invoice_date" as const;
