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
    for (const p of pending) {
      const { error } = await supabase.rpc("process_sale", p.payload as any);
      if (error) { fail++; continue; }
      if (p.id != null) await removePending(p.id);
      ok++;
    }
    if (ok > 0) toast.success(`تمت مزامنة ${ok} فاتورة محفوظة محلياً`);
    if (fail > 0) toast.error(`فشل مزامنة ${fail} فاتورة — راجع المخزون`);
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
