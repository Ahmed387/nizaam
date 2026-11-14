// Step logic of «الربط مع منظومة الفاتورة الإلكترونية» (EtaConnectionWizard, migrations 0220 / 0221).
export type EtaSettings = {
  client_id: string | null; has_secret: boolean; env: "prod" | "preprod"; enabled: boolean;
  last_sync_at: string | null; synced_until: string | null; last_error: string | null;
  connection_ok_at: string | null; connection_checked_at: string | null; connection_error: string | null;
  is_owner: boolean; unseen: number; documents: number;
};

export const ETA_PORTAL = {
  prod: "https://invoicing.eta.gov.eg",
  preprod: "https://preprod.invoicing.eta.gov.eg",
} as const;

/** Which steps are done and which one the owner is on. Steps 1–2 happen on the ETA portal, so they count as done once he
 *  says so — or once credentials are saved (he obviously did them). */
export function etaStepState(s: Pick<EtaSettings, "client_id" | "has_secret" | "connection_ok_at" | "enabled">,
                             local: { portalOpened: boolean; erpDone: boolean }) {
  const saved = !!s.client_id && s.has_secret;
  const done: Record<1 | 2 | 3 | 4 | 5, boolean> = {
    1: local.portalOpened || local.erpDone || saved,
    2: local.erpDone || saved,
    3: saved,
    4: saved && !!s.connection_ok_at,
    5: saved && !!s.connection_ok_at && s.enabled,
  };
  const current = ([1, 2, 3, 4, 5] as const).find(n => !done[n]) ?? 5;
  return { done, current };
}
