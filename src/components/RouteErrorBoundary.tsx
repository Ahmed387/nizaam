import { Component, type ReactNode } from "react";

/**
 * Never a white page (owner 2026-11-12 «لما بنقل من صفحة للتانية الصفحة بتكون بيضاء ولازم اعمل Refresh»): a page that throws
 * while rendering used to unmount the whole app. Two cases:
 *   - the page's file is gone after a new publish (stale tab) → reload by itself, at most 3 times a minute;
 *   - any other error → a small card with the message and «إعادة تحميل», so the person is never stuck and we can see what broke.
 * `resetKey` (the path) clears the error when the person moves to another page.
 */
const CHUNK = /dynamically imported module|Importing a module script failed|Loading chunk|reading 'default'|search for 'default'|Element type is invalid/i;
const KEY = "nizam-boundary-reloads";

export class RouteErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: Error) {
    console.error("[route error]", error);
    if (!CHUNK.test(String(error?.message ?? error))) return;
    try {
      const now = Date.now();
      const times = (JSON.parse(sessionStorage.getItem(KEY) || "[]") as number[]).filter((t) => now - t < 60_000);
      if (times.length >= 3) return;
      sessionStorage.setItem(KEY, JSON.stringify([...times, now]));
    } catch { /* storage blocked: reload anyway */ }
    window.location.reload();
  }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = CHUNK.test(String(this.state.error?.message ?? ""));
    return (
      <div dir="rtl" className="min-h-[50vh] flex items-center justify-center p-6" data-testid="route-error">
        <div className="card-elevated max-w-md p-6 text-center space-y-3">
          <div className="text-lg font-bold">{stale ? "فيه نسخة جديدة من السيستم" : "الصفحة دي فيها مشكلة"}</div>
          <p className="text-sm text-muted-foreground">{stale ? "الصفحة بتتحمل من جديد… لو ما اتحملتش دوس الزرار." : "باقي السيستم شغال. دوس إعادة تحميل، ولو اتكررت ابعت الرسالة دي."}</p>
          {!stale && <pre dir="ltr" className="text-xs text-destructive whitespace-pre-wrap break-words">{String(this.state.error?.message ?? this.state.error)}</pre>}
          <button type="button" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm" onClick={() => window.location.reload()}>إعادة تحميل</button>
        </div>
      </div>
    );
  }
}
