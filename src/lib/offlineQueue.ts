// IndexedDB queue for offline POS sales
// Saves failed sales locally and replays them when back online.

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DB_NAME = "pos_offline";
const STORE = "pending_sales";
const VERSION = 1;

export const OFFLINE_QUEUE_EVENT = "offline-queue-change";
export const OFFLINE_SYNC_STATE_EVENT = "offline-sync-state";

function emitChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT));
}
function emitSync(state: "idle" | "syncing") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OFFLINE_SYNC_STATE_EVENT, { detail: state }));
}

export interface PendingSale {
  id?: number;
  created_at: number;
  payload: {
    p_branch_id: string;
    p_customer_id: string | null;
    p_subtotal: number;
    p_discount_amount: number;
    p_discount_percent: number;
    p_discount_reason: string | null;
    p_total: number;
    p_payment_method: string;
    p_items: any;
    p_payments?: any;
    p_vat_rate?: number;
    p_vat_amount?: number;
    p_invoice_date?: string | null;
  };
}

/** Cairo calendar day (YYYY-MM-DD) of a timestamp — the day the sale was actually made. */
function cairoDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/**
 * Replays through process_sale_full (shift gate, admin-only backdating, same rules as an online sale).
 * process_sale is no longer callable from the browser (SEC-001). Older queued rows may lack the
 * VAT/date/payments fields, so they are filled in: the invoice keeps the day it was made offline.
 */
function toFullPayload(p: PendingSale) {
  const x = p.payload;
  return {
    ...x,
    p_payments: Array.isArray(x.p_payments) ? x.p_payments : [],
    p_vat_rate: x.p_vat_rate ?? 0,
    p_vat_amount: x.p_vat_amount ?? 0,
    p_invoice_date: x.p_invoice_date ?? cairoDay(p.created_at),
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueSale(payload: PendingSale["payload"]) {
  const db = await openDB();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add({ created_at: Date.now(), payload });
    req.onsuccess = () => { emitChange(); resolve(req.result as number); };
    req.onerror = () => reject(req.error);
  });
}

export async function getPending(): Promise<PendingSale[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as PendingSale[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removePending(id: number) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { emitChange(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function countPending(): Promise<number> {
  const list = await getPending().catch(() => []);
  return list.length;
}

let syncing = false;

export async function syncPendingSales(silent = false) {
  if (syncing) return;
  if (!navigator.onLine) {
    if (!silent) toast.error("لا يوجد اتصال بالإنترنت");
    return;
  }
  syncing = true;
  emitSync("syncing");
  try {
    const pending = await getPending();
    if (!pending.length) return;
    let ok = 0;
    let fail = 0;
    let lastError = "";
    for (const p of pending) {
      const { error } = await supabase.rpc("process_sale_full" as any, toFullPayload(p) as any);
      // Failed rows stay queued (nothing is lost); a manager/admin can sync them later.
      if (error) { fail++; lastError = error.message; continue; }
      if (p.id != null) await removePending(p.id);
      ok++;
    }
    if (ok > 0) toast.success(`تمت مزامنة ${ok} فاتورة محفوظة محلياً`);
    if (fail > 0) toast.error(`فشل مزامنة ${fail} فاتورة — فضلت محفوظة على الجهاز. السبب: ${lastError}`);
    if (ok === 0 && fail === 0 && !silent) toast.info("لا توجد عمليات معلقة");
  } finally {
    syncing = false;
    emitSync("idle");
    emitChange();
  }
}

export function initOfflineSync() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => syncPendingSales());
  // attempt initial sync
  setTimeout(() => syncPendingSales(true), 2000);
}
