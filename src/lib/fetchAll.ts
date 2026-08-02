/**
 * PostgREST بيرجّع 1000 صف كحد أقصى افتراضيًا.
 * الدالة دي بتجيب كل الصفوف على دفعات عشان التقارير ما تتقصّش من غير ما حد ياخد باله.
 *
 * الاستخدام:
 *   const rows = await fetchAllRows(() => supabase.from("invoices").select("*").eq("tenant_id", t));
 */
export async function fetchAllRows<T = any>(
  build: () => any,
  pageSize = 1000,
  maxRows = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < pageSize || out.length >= maxRows) break;
    from += pageSize;
  }
  return out;
}
