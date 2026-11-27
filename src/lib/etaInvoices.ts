// Shapes for «الفواتير الإلكترونية الواردة» (migrations 0220–0222). Pure functions, tested in etaInvoices.test.ts.
export type EtaMatch = {
  shipment_id: string; number: string; branch_id: string; branch: string; contact: string;
  date: string; total: number; status: string; diff: number; days: number;
};
export type EtaDoc = {
  id: string; eta_uuid: string; internal_id: string | null; type_name: string | null;
  issuer_id: string | null; issuer_name: string | null; date_issued: string | null; date_received: string | null;
  net_amount: number | null; total_discount: number | null; total: number | null; vat: number | null;
  status: string | null; status_reason: string | null; public_url: string | null; seen_at: string | null;
  cancel_requested: boolean; reject_requested: boolean; has_detail: boolean; linked: boolean;
  match_mode: "auto" | "manual" | "ignored" | null; match_note: string | null; match: EtaMatch | null;
};
export type EtaIssuer = {
  issuer_id: string; issuer_name: string; count: number; total: number; matched: number; ignored: number; open: number;
  links: { id: string; name: string }[]; suggest: { id: string; name: string }[];
};

export const ETA_TYPE: Record<string, string> = { I: "فاتورة", C: "إشعار دائن", D: "إشعار مدين" };
export const etaTypeLabel = (t: string | null) => ETA_TYPE[(t ?? "").toUpperCase()] ?? (t || "—");

/** + for an invoice / debit note, − for a credit note (it lowers what we owe the supplier). */
export const etaSign = (t: string | null) => ((t ?? "").toUpperCase() === "C" ? -1 : 1);

export type EtaState = "recorded" | "missing" | "unlinked" | "ignored" | "credit" | "void";
export const ETA_STATE: Record<EtaState, { label: string; tone: string }> = {
  recorded: { label: "متسجلة عندنا", tone: "bg-success/15 text-success" },
  missing: { label: "مش متسجلة عندنا", tone: "bg-destructive/15 text-destructive" },
  unlinked: { label: "المورد مش مربوط", tone: "bg-warning/15 text-warning" },
  ignored: { label: "مش فاتورة شراء", tone: "bg-muted text-muted-foreground" },
  credit: { label: "إشعار — راجعه", tone: "bg-primary/10 text-primary" },
  void: { label: "ملغاة / مرفوضة", tone: "bg-muted text-muted-foreground" },
};

/** Where an ETA document stands against our purchases. */
export function etaState(d: Pick<EtaDoc, "status" | "type_name" | "match_mode" | "match" | "linked">): EtaState {
  if (d.status && d.status !== "Valid") return "void";
  if (d.match_mode === "ignored") return "ignored";
  if (d.match) return "recorded";
  if ((d.type_name ?? "").toUpperCase() !== "I") return "credit";
  return d.linked ? "missing" : "unlinked";
}

/** What the list shows: one state, or the rows behind a top card (owner 2026-11-15 «لما ادوس علي اي كارت يظهرلي الفواتير
 *  المتعلقة بالكارت ده»). A card counts exactly the rows its view shows — `etaTotals` uses the same predicates. */
export type EtaView = EtaState | "all" | "valid" | "not_recorded";
export const ETA_VIEW_LABEL: Record<"valid" | "not_recorded", string> = {
  valid: "الفواتير الصحيحة",
  not_recorded: "مش متسجلة عندنا (ومنها المورد مش مربوط)",
};
export function etaInView(d: EtaDoc, v: EtaView): boolean {
  if (v === "all") return true;
  if (v === "valid") return d.status === "Valid";
  if (v === "not_recorded") return d.status === "Valid" && ["missing", "unlinked"].includes(etaState(d));
  return etaState(d) === v;
}

export function etaTotals(docs: EtaDoc[]) {
  const valid = docs.filter(d => etaInView(d, "valid"));
  const sum = (xs: EtaDoc[], f: (d: EtaDoc) => number) => Math.round(xs.reduce((s, d) => s + f(d), 0) * 100) / 100;
  const byState = (s: EtaState) => valid.filter(d => etaState(d) === s);
  const notIn = docs.filter(d => etaInView(d, "not_recorded"));
  return {
    count: valid.length,
    total: sum(valid, d => etaSign(d.type_name) * Number(d.total || 0)),
    vat: sum(valid, d => etaSign(d.type_name) * Number(d.vat ?? (Number(d.total || 0) - Number(d.net_amount || 0)))),
    net: sum(valid, d => etaSign(d.type_name) * Number(d.net_amount ?? (Number(d.total || 0) - Number(d.vat || 0)))),
    suppliers: new Set(valid.map(d => d.issuer_id)).size,
    recorded: { count: byState("recorded").length, total: sum(byState("recorded"), d => Number(d.total || 0)) },
    notRecorded: { count: notIn.length, total: sum(notIn, d => Number(d.total || 0)) },
    unlinkedSuppliers: new Set(byState("unlinked").map(d => d.issuer_id)).size,
    unlinked: { count: byState("unlinked").length, total: sum(byState("unlinked"), d => Number(d.total || 0)) },
    credit: { count: byState("credit").length, total: sum(byState("credit"), d => Number(d.total || 0)) },
  };
}

/** One line of an ETA document (detail.document.invoiceLines[i]) in plain numbers. */
export function etaLines(detail: any) {
  const lines: any[] = detail?.document?.invoiceLines ?? [];
  return lines.map((l) => {
    const vat = (l?.taxableItems ?? []).reduce((s: number, t: any) => s + Number(t?.amount || 0), 0);
    return {
      description: String(l?.description ?? ""),
      code: String(l?.internalCode || l?.itemCode || ""),
      quantity: Number(l?.quantity || 0),
      unit: String(l?.unitType ?? ""),
      price: Number(l?.unitValue?.amountEGP || 0),
      discount: Number(l?.discount?.amount || 0) + Number(l?.itemsDiscount || 0),
      net: Number(l?.netTotal || 0),
      vat: Math.round(vat * 100) / 100,
      total: Number(l?.total || 0),
    };
  });
}

// ── the filter box of the received-invoices table (owner 2026-11-27 «زي صفحة سند القبض والصرف والبيع والشراء») ──────────
export type EtaFilters = {
  /** invoice number, supplier name, tax id, our purchase number — every word, any order */
  q: string; amountMin: string; amountMax: string;
  /** ETA supplier (tax id) */ issuer: string;
  /** I / C / D */ type: string;
  /** Valid / Cancelled / Rejected … */ etaStatus: string;
};
export const EMPTY_ETA_FILTERS: EtaFilters = { q: "", amountMin: "", amountMax: "", issuer: "", type: "", etaStatus: "" };
const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
/** the rows the box leaves (the date is read on the server; the state chips / cards come on top through `etaInView`) */
export function etaFilter(docs: EtaDoc[], f: EtaFilters): EtaDoc[] {
  const words = norm(f.q.trim()).split(/\s+/).filter(Boolean).map((w) => (w.length > 3 ? w.replace(/^(ال|لل)/, "") : w));
  const min = f.amountMin === "" ? null : Number(f.amountMin);
  const max = f.amountMax === "" ? null : Number(f.amountMax);
  return docs.filter((d) => {
    if (f.issuer && d.issuer_id !== f.issuer) return false;
    if (f.type && (d.type_name ?? "").toUpperCase() !== f.type) return false;
    if (f.etaStatus && d.status !== f.etaStatus) return false;
    const total = Math.abs(Number(d.total) || 0);
    if (min != null && total < min - 0.005) return false;
    if (max != null && total > max + 0.005) return false;
    if (words.length) {
      const hay = norm([d.internal_id, d.issuer_name, d.issuer_id, d.match?.number].filter(Boolean).join(" "));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}
export const etaFilterCount = (f: EtaFilters) => Object.values(f).filter((v) => v !== "").length;
