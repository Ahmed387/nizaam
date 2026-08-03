/**
 * منطق عرض أقسام الفواتير (أكورديون مرن):
 * - كل الأقسام مفتوحة في البداية.
 * - الضغط على هيدر قسم مفتوح (وفيه أقسام تانية مفتوحة) = تركيز عليه وقفل الباقي.
 * - الضغط على هيدر قسم مقفول = يفتحه من غير ما يقفل حاجة (يعني تقدر تفتح أكتر من واحد).
 * - الضغط على القسم المفتوح الوحيد = يقفله.
 * لا يغيّر أي منطق حسابي — عرض فقط.
 */
export function focusSection<T extends Record<string, boolean>>(state: T, key: keyof T): T {
  const openKeys = (Object.keys(state) as (keyof T)[]).filter((k) => state[k]);

  // القسم مقفول → افتحه وسيب الباقي زي ما هو
  if (!state[key]) return { ...state, [key]: true };

  // مفتوح ومعاه غيره → ركّز عليه واقفل الباقي
  if (openKeys.length > 1) {
    const next = { ...state } as T;
    for (const k of Object.keys(state) as (keyof T)[]) {
      (next as Record<keyof T, boolean>)[k] = k === key;
    }
    return next;
  }

  // مفتوح لوحده → اقفله
  return { ...state, [key]: false };
}
