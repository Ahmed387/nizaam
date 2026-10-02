// Retries an auth call on transient network failures with exponential backoff.
// Wrong-password and other definitive errors are returned immediately.
export function isNetworkError(err: any): boolean {
  if (!err) return false;
  const name = String(err.name ?? "");
  const msg = String(err.message ?? "").toLowerCase();
  return (
    name === "AuthRetryableFetchError" ||
    err.status === 0 ||
    (typeof err.status === "number" && err.status >= 500) ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("load failed")
  );
}

export async function withAuthRetry<T extends { error: any }>(
  fn: () => Promise<T>,
  { attempts = 4, baseMs = 600 }: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fn();
      if (!last.error || !isNetworkError(last.error)) return last;
    } catch (e: any) {
      if (!isNetworkError(e) || i === attempts - 1) throw e;
    }
    if (i < attempts - 1) {
      const delay = baseMs * 2 ** i + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return last as T;
}
