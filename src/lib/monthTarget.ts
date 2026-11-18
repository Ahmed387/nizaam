/** One monthly target card (sales or net profit): how far, what is left, on track (≥ 80 %). */
export interface TargetView { pct: number; remaining: number; onTrack: boolean; reached: boolean }

export function targetView(achieved: number, target: number): TargetView | null {
  if (!(target > 0)) return null;
  const got = Math.max(0, Number.isFinite(achieved) ? achieved : 0);
  const pct = Math.min(100, (got / target) * 100);
  const remaining = Math.max(0, target - got);
  return { pct, remaining, onTrack: pct >= 80, reached: remaining === 0 };
}
