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

export function etaTotals(docs: EtaDoc[]) {
  const valid = docs.filter(d => d.status === "Valid");
  const sum = (xs: EtaDoc[], f: (d: EtaDoc) => number) => Math.round(xs.reduce((s, d) => s + f(d), 0) * 100) / 100;
  const byState = (s: EtaState) => valid.filter(d => etaState(d) === s);
  const notIn = valid.filter(d => ["missing", "unlinked"].includes(etaState(d)));
  return {
    count: valid.length,
    total: sum(valid, d => etaSign(d.type_name) * Number(d.total || 0)),
    vat: sum(valid, d => etaSign(d.type_name) * Number(d.vat ?? (Number(d.total || 0) - Number(d.net_amount || 0)))),
    suppliers: new Set(valid.map(d => d.issuer_id)).size,
    recorded: { count: byState("recorded").length, total: sum(byState("recorded"), d => Number(d.total || 0)) },
    notRecorded: { count: notIn.length, total: sum(notIn, d => Number(d.total || 0)) },
    unlinkedSuppliers: new Set(byState("unlinked").map(d => d.issuer_id)).size,
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
