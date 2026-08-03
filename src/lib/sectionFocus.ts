/**
 * منطق عرض أقسام الفواتير:
 * - كل الأقسام مفتوحة في البداية.
 * - الضغط على هيدر أي قسم يفتحه/يقفله لوحده من غير ما يأثر على باقي الأقسام.
 * لا يغيّر أي منطق حسابي — عرض فقط.
 */
export function focusSection<T extends Record<string, boolean>>(state: T, key: keyof T): T {
  return { ...state, [key]: !state[key] };
}
