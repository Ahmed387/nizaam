/**
 * PostgREST بيرجّع 1000 صف كحد أقصى افتراضيًا.
 * الدالة دي بتجيب كل الصفوف على دفعات عشان التقارير ما تتقصّش من غير ما حد ياخد باله.
 *
 * Speed: the first page is read alone (most lists fit in it). When it comes back full, the next pages
 * are read FOUR AT A TIME instead of one after another — every round trip from Egypt to the database
 * costs ~0.5 s, so a 3-page list used to wait ~1.5 s+ just in network time. Order is kept (pages are
 * joined in page order), so the builder must still have a stable `.order(...)`.
 *
 * الاستخدام:
 *   const rows = await fetchAllRows(() => supabase.from("invoices").select("*").eq("tenant_id", t).order("id"));
 */
export async function fetchAllRows<T = any>(
  build: () => any,
  pageSize = 1000,
  maxRows = 100_000,
  parallel = 4,
): Promise<T[]> {
  const page = async (n: number): Promise<T[]> => {
    const from = n * pageSize;
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    return (data ?? []) as T[];
  };

  const out: T[] = [];
  const first = await page(0);
  out.push(...first);
  if (first.length < pageSize) return out;

  let next = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await Promise.all(Array.from({ length: parallel }, (_, i) => page(next + i)));
    next += parallel;
    let done = false;
    for (const rows of batch) {
      out.push(...rows);
      if (rows.length < pageSize) { done = true; break; }
    }
    if (done) break;
    if (out.length >= maxRows) {
      console.error(
        `[fetchAllRows] Safety cutoff reached: ${maxRows} rows loaded; remaining rows were NOT fetched. Results may be incomplete.`,
      );
      break;
    }
  }
  return out;
}
