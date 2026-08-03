import { useEffect, useRef, useState } from "react";

const PREFIX = "nizam:draft:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

interface Stored<T> {
  savedAt: number;
  data: T;
}

export interface FormDraft<T> {
  /** Draft found in storage on mount (null when none / expired). */
  draft: { data: T; savedAt: number } | null;
  /** Hide the restore bar without touching storage. */
  dismiss: () => void;
  /** Hide the bar and delete the stored draft (call after a successful save). */
  clear: () => void;
}

/**
 * Autosaves an arbitrary form snapshot to localStorage so an accidental reload,
 * tab close or crash never loses a half-filled invoice.
 *
 * - Key is scoped per page + user + branch, so drafts never leak between users.
 * - Nothing is written while `enabled` is false (e.g. empty form / still loading).
 * - Silently no-ops when localStorage is unavailable or full.
 */
export function useFormDraft<T>(
  page: string,
  scope: (string | null | undefined)[],
  value: T,
  enabled: boolean,
): FormDraft<T> {
  const key = `${PREFIX}${page}:${scope.map((s) => s ?? "-").join(":")}`;
  const [draft, setDraft] = useState<FormDraft<T>["draft"]>(null);
  const loadedRef = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  // Load once per key
  useEffect(() => {
    loadedRef.current = false;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) { loadedRef.current = true; return; }
      const parsed = JSON.parse(raw) as Stored<T>;
      if (!parsed?.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) {
        localStorage.removeItem(key);
      } else {
        setDraft({ data: parsed.data, savedAt: parsed.savedAt });
      }
    } catch { /* ignore */ }
    loadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Debounced autosave
  useEffect(() => {
    if (!enabled || !loadedRef.current) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(keyRef.current, JSON.stringify({ savedAt: Date.now(), data: value } as Stored<T>));
      } catch { /* quota / private mode — ignore */ }
    }, 500);
    return () => clearTimeout(id);
  }, [value, enabled]);

  return {
    draft,
    dismiss: () => setDraft(null),
    clear: () => {
      setDraft(null);
      try { localStorage.removeItem(keyRef.current); } catch { /* ignore */ }
    },
  };
}
