// Reading of one «سهل» report sheet (rows from SheetJS, header: 1) — see index.ts.
export type Branch = "shalaby" | "abdelmonem" | "sekka";
export const KNOWN: Record<string, [Branch, string]> = {
  "90807502a38a425b94c20981718bf053ecb914b63358dc92cbabd8f2d8a9f183": ["abdelmonem", "مرتجع شراء"],
  "6aafc9547a944122728ae7706375e142f948fe74cf5c73abeb34660596a85396": ["abdelmonem", "مرتجع بيع"],
  "58c6892e1ae486b398ebe44d8a567698ab17f4f77a15d4f12f93ea6abe228817": ["abdelmonem", "تقرير بضاعة مخزن"],
  "f518d982d15ec3bb9d1ef696c9791ae56971ec717b26991dff6343a5eaa74860": ["abdelmonem", "صرف"],
  "4ae762fe82acc0aaa14f97fe8f776136ec76ab249e4390d157c37d3a90faf84f": ["abdelmonem", "قبض"],
  "85ab3565c4a9a34650c139f29b8c697f221ad113b91156cb8b9d20c8829c81d5": ["abdelmonem", "شراء"],
  "4f3ad52e7bf1cfd1775f9e19c123be613e008d27f150f4be9584741e2750bc3f": ["abdelmonem", "بيع"],
  "936233ea5fc89c8ec53f3a4e57bc259d381a125bc33f47a0e168f20c8b31adc5": ["abdelmonem", "أرصدة الحسابات بتاريخ سابق"],
  "afa87b382694d861f92513ad7abce2429fa429493968d671cb29655f81f0e8e4": ["shalaby", "شراء"],
  "529d7e7f19a782f3add0b2f59c6f77485215c29274523d09298a9fc51dc97564": ["shalaby", "مرتجع شراء"],
  "ecab9d46dfebdc67e2c5ef3350b08045a72e6f2b2c4f9a92eb6163596efdd045": ["shalaby", "صرف"],
  "c8c979fdcba3d52b89628056292b7c62b1a808f9fee8c461e29539b64cdaa2d7": ["shalaby", "بيع"],
  "7a293f1ddb91575eb0d935c13aa50a28c9d1bf5b9b10deddda27e0e05a7a896e": ["shalaby", "مرتجع بيع"],
  "f688ea33df7c3fb2d59ca87707ee8051ea654ff095584bc240a29a31fc5e6875": ["shalaby", "قبض"],
  "03cbb2e4ef2f59b2cf346d3e8557853e4ca4dca40e0a93302b16864b384b6270": ["shalaby", "تقرير بضاعة مخزن"],
  "36a5dfa1d143e28c3d56302d214810eee939f2278f7847ca40d7963baf0a14b8": ["shalaby", "أرصدة الحسابات بتاريخ سابق"],
  "fb4b4ff35f5c7608b677e7277cc7889cf96ca12f7703fce432effe8ae8f81a3e": ["sekka", "قبض"],
  "4f395ee95728960fd26ef86f4d5bec1d33f66b0986325bb34cc7c205c05ce3af": ["sekka", "شراء"],
  "f54a46d2823f8319cb4f52dd7f60b88b606e819153040881d9ae85cbd91a15d9": ["sekka", "مرتجع شراء"],
  "fa8396bfdf9a6571002e2e211fa694469ac3c5cf4d77e311e7ddd771dda500f6": ["sekka", "صرف"],
  "67b7cfeca062294f57248dac484b6dad5ba4ea3abf1b679299a9c256ebbcffbc": ["sekka", "مرتجع بيع"],
  "d80465be30ae1899fa10d0e0769b831fd47df1fa21b7290a0a033d1f0408662d": ["sekka", "بيع"],
};
export const STOCK = "تقرير بضاعة مخزن";
export const BALANCES = "أرصدة الحسابات بتاريخ سابق";

const pad = (n: number) => String(n).padStart(2, "0");
const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());
export function norm(v: unknown): unknown {
  if (!isDate(v)) return v ?? null;
  v = new Date(Math.round(v.getTime() / 1000) * 1000); // nearest second, like the analysis (openpyxl)
  // a time-only cell comes back as a day in 1899 (Excel day 0): keep the time, like the analysis did
  const t = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  if (v.getUTCFullYear() < 1901) return t;
  return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${t}`;
}
const isNum = (v: unknown) => typeof v === "number" && isFinite(v);
export const str = (v: unknown) => (typeof v === "string" ? v.trim() : v);

export function parse(rows: unknown[][], kind: string): Record<string, unknown>[] {
  if (kind === BALANCES) {
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      if (r && isNum(r[0]) && isNum(r[1]) && r[2] != null) {
        out.push({
          no: r[1], name: String(r[2]).trim(), od: r[3] ?? 0, oc: r[4] ?? 0, cd: r[5] ?? 0, cc: r[6] ?? 0,
          nature: r[7] ?? null, cls: r[8] ?? null,
        });
      }
    }
    return out;
  }
  const hi = rows.slice(0, 6).findIndex((r) => r && r.some((c) => c === "التاريخ" || c === "رقم الصنف"));
  if (hi < 0) throw new Error("header row not found");
  const hdr = rows[hi];
  const hmap = new Map<number, string>();
  const seen = new Map<string, number>();
  hdr.forEach((h, i) => {
    if (h == null) return;
    const name = String(str(h));
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    hmap.set(i, n === 1 ? name : `${name}#${n}`);
  });
  const pick = (r: unknown[]) => {
    const o: Record<string, unknown> = {};
    for (const [i, h] of hmap) if (i < r.length) o[h] = norm(r[i]);
    return o;
  };
  const recs: Record<string, unknown>[] = [];
  if (kind === STOCK) {
    for (const r of rows.slice(hi + 1)) if (r && isNum(r[0]) && r[1] != null) recs.push(pick(r));
    return recs;
  }
  let cur: Record<string, any> | null = null;
  let imap: Map<number, string> | null = null;
  for (const r of rows.slice(hi + 1)) {
    if (!r || r.every((c) => c == null)) continue;
    if (isNum(r[0]) && isDate(r[1])) {
      cur = pick(r);
      cur._extra = r.map((c, i) => (i > 0 && !hmap.has(i) && c != null ? norm(c) : undefined)).filter((c) => c !== undefined);
      cur.items = [];
      recs.push(cur);
      imap = null;
    } else if (r[1] === "رقم الصنف") {
      imap = new Map();
      r.forEach((h, i) => { if (typeof h === "string") imap!.set(i, h.trim()); });
    } else if (cur && imap && isNum(r[1]) && typeof r[2] === "string") {
      const it: Record<string, unknown> = {};
      for (const [i, h] of imap) if (i < r.length) it[h] = norm(r[i]);
      cur.items.push(it);
    }
  }
  return recs;
}

