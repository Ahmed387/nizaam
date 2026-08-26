/**
 * Extract the real error message from a Supabase Edge Function call.
 * For non-2xx responses supabase-js returns a generic FunctionsHttpError
 * ("Edge Function returned a non-2xx status code"); the useful message lives
 * in the JSON body, so we read error.context (a Response) when available.
 */
export async function getFnErrorMessage(error: unknown, data?: unknown): Promise<string | null> {
  const dataMsg = (data as { error?: unknown } | null)?.error;
  if (typeof dataMsg === "string" && dataMsg) return dataMsg;
  if (!error) return null;
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      const msg = (body as { error?: unknown; message?: unknown })?.error
        ?? (body as { message?: unknown })?.message;
      if (typeof msg === "string" && msg) return msg;
    } catch {
      /* body wasn't JSON — fall through */
    }
  }
  const msg = (error as { message?: unknown }).message;
  return typeof msg === "string" && msg ? msg : null;
}
