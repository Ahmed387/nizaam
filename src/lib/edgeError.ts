/**
 * supabase.functions.invoke returns a generic
 * "Edge Function returned a non-2xx status code" message and hides the body.
 * This helper reads the real error message the function returned.
 */
export async function edgeErrorMessage(error: any, data?: any): Promise<string | null> {
  const fromData = data && typeof data === "object" ? (data as any).error : null;
  if (fromData) return String(fromData);
  if (!error) return null;

  const res = (error as any)?.context;
  if (res && typeof res.text === "function") {
    try {
      const raw = await res.clone().text();
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.error) return String(parsed.error);
        if (parsed?.message) return String(parsed.message);
      } catch {
        if (raw?.trim()) return raw.trim().slice(0, 300);
      }
    } catch {
      /* ignore */
    }
  }
  return error?.message ?? "حدث خطأ غير متوقع";
}
