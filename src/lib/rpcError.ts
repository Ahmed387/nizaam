/**
 * A function the screen calls doesn't exist in the database the site is connected to
 * (PostgREST PGRST202 "Could not find the function … in the schema cache"): the site's code is newer
 * than that database's migrations. Show the owner what it means instead of the raw message.
 */
export function isMissingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /Could not find the function/i.test(error.message ?? "");
}

export function rpcErrorText(error: { code?: string; message?: string } | null | undefined, what = "التقرير ده"): string {
  if (!error) return "";
  if (isMissingRpc(error)) {
    return `${what} لسه مش متفعّل في قاعدة البيانات اللي الموقع متوصل بيها — تحديثات قاعدة البيانات (migrations) الجديدة محتاجة تتطبّق عليها الأول. باقي السيستم شغال عادي.`;
  }
  return error.message ?? "حصل خطأ";
}
