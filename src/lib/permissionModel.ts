/**
 * Pure helpers behind the permissions screens (no React, no Supabase) — unit-tested in permissionModel.test.ts.
 *
 * An employee = one template (his role) + his own overrides. A value that equals the template is never stored
 * as an override, so «متعدّل» always means a real difference and «رجّعه للقالب» is just «no overrides».
 */
import { checkPermission } from "@/lib/roles";
import { CatalogPage, CatalogSection, PERMISSION_CATALOG, partKey } from "@/lib/permissionCatalog";

export type Overrides = Record<string, boolean>;
export type RolePerms = Record<string, Record<string, boolean>>;

/** Effective value for one key: template (role) + overrides, parts follow their page. */
export function effective(role: string, rolePerms: RolePerms, overrides: Overrides, key: string): boolean {
  return checkPermission(role ? [role as any] : [], rolePerms, key, overrides);
}

/** What the template alone gives for this key, keeping the other overrides (a part follows an overridden page). */
export function templateValue(role: string, rolePerms: RolePerms, overrides: Overrides, key: string): boolean {
  const rest = { ...overrides };
  delete rest[key];
  return effective(role, rolePerms, rest, key);
}

/** Set a key; drop the override when the value is what the template already gives. */
export function setOverride(role: string, rolePerms: RolePerms, overrides: Overrides, key: string, value: boolean): Overrides {
  const next = { ...overrides };
  if (templateValue(role, rolePerms, overrides, key) === value) delete next[key];
  else next[key] = value;
  return next;
}

/** All keys a page owns: its actions, its tabs, its parts. */
export function pageKeys(page: CatalogPage): string[] {
  return [
    ...page.actions.map((a) => `${page.key}.${a}`),
    ...page.children.map((c) => `${c.key}.view`),
    ...page.parts.map((x) => partKey(page.key, x.id)),
  ];
}

export const pageChanged = (page: CatalogPage, overrides: Overrides) => pageKeys(page).some((k) => k in overrides);

export function resetPage(page: CatalogPage, overrides: Overrides): Overrides {
  const next = { ...overrides };
  pageKeys(page).forEach((k) => delete next[k]);
  return next;
}

/** «الكل مسموح» for one page: the page, every action, every tab and every part on. */
export function allowAllPage(role: string, rolePerms: RolePerms, page: CatalogPage, overrides: Overrides): Overrides {
  let next = { ...overrides };
  pageKeys(page).forEach((k) => { next = setOverride(role, rolePerms, next, k, true); });
  return next;
}

/** Overrides compared with the template: extra = allowed beyond it, revoked = taken away. */
export function diffOverrides(role: string, rolePerms: RolePerms, overrides: Overrides) {
  const extra: string[] = [];
  const revoked: string[] = [];
  Object.entries(overrides).forEach(([k, v]) => {
    const t = templateValue(role, rolePerms, overrides, k);
    if (v && !t) extra.push(k);
    else if (!v && t) revoked.push(k);
  });
  return { extra, revoked };
}

/** «شيل الصلاحيات الزيادة بس»: keep the restrictions, drop the extra grants. */
export function clearExtras(role: string, rolePerms: RolePerms, overrides: Overrides): Overrides {
  const { extra } = diffOverrides(role, rolePerms, overrides);
  const next = { ...overrides };
  extra.forEach((k) => delete next[k]);
  return next;
}

/** Readable label for any key (page action, tab, part). */
export function keyLabel(key: string): string {
  const ACT: Record<string, string> = { view: "يشوف", create: "يضيف", update: "يعدل", delete: "يلغي" };
  for (const s of PERMISSION_CATALOG) for (const p of s.pages) {
    for (const a of p.actions) if (key === `${p.key}.${a}`) return `${p.label} — ${ACT[a]}`;
    for (const c of p.children) if (key === `${c.key}.view`) return `${p.label} ← ${c.label}`;
    for (const x of p.parts) if (key === partKey(p.key, x.id)) return `${p.label} ← ${x.label}`;
  }
  return key;
}

/** Sidebar as the employee will see it: the pages he can view, per section. */
export function sidebarPreview(role: string, rolePerms: RolePerms, overrides: Overrides, sections: CatalogSection[] = PERMISSION_CATALOG) {
  return sections
    .filter((s) => s.id !== "personal")
    .map((s) => ({
      id: s.id,
      label: s.label,
      items: s.pages.filter((p) => p.scope !== "data" && p.actions.includes("view") && effective(role, rolePerms, overrides, `${p.key}.view`)).map((p) => p.label),
    }));
}

/** Overrides → rows for save_user_permissions. */
export const toRows = (overrides: Overrides) => Object.entries(overrides).map(([key, allowed]) => ({ key, allowed }));
