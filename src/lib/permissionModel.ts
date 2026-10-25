/**
 * Pure helpers behind the permissions screens (no React, no Supabase) — unit-tested in permissionModel.test.ts.
 *
 * A person = his roles (the template) + his own overrides. Overrides are keyed «key» (every branch, the base)
 * or «key@<branch id>» (that branch only, migration 0114). A value that equals what he would get anyway is
 * never stored, so «متعدّل» always means a real difference and «رجّعه للقالب» is just «no overrides».
 */
import { BranchRule, branchKey, checkPermission } from "@/lib/roles";
import { CatalogPage, PERMISSION_CATALOG, partKey } from "@/lib/permissionCatalog";

export type Overrides = Record<string, boolean>;
export type RolePerms = Record<string, Record<string, boolean>>;
export type Roles = string[];
/** How he works in each branch (migration 0122): read / full / that branch's template. */
export type BranchRules = Record<string, BranchRule>;

const scoped = (key: string, branch?: string | null) => (branch ? branchKey(key, branch) : key);

/** «sales.create@b1» → { key: "sales.create", branch: "b1" } */
export function parseKey(k: string): { key: string; branch: string | null } {
  const i = k.indexOf("@");
  return i < 0 ? { key: k, branch: null } : { key: k.slice(0, i), branch: k.slice(i + 1) };
}

/** Effective value of one key for these roles + overrides, in one branch (or the base when no branch). */
export function effective(roles: Roles, rolePerms: RolePerms, overrides: Overrides, key: string, branch?: string | null, rules?: BranchRules): boolean {
  return checkPermission(roles as any, rolePerms, key, overrides, branch ?? null, branch ? rules?.[branch] ?? null : null);
}

/** What he would get for this key (in this branch) without this very override. */
export function templateValue(roles: Roles, rolePerms: RolePerms, overrides: Overrides, key: string, branch?: string | null, rules?: BranchRules): boolean {
  const rest = { ...overrides };
  delete rest[scoped(key, branch)];
  return effective(roles, rolePerms, rest, key, branch, rules);
}

/** Set a key (for every branch, or one branch); drop the override when it changes nothing. */
export function setOverride(roles: Roles, rolePerms: RolePerms, overrides: Overrides, key: string, value: boolean, branch?: string | null, rules?: BranchRules): Overrides {
  const next = { ...overrides };
  if (templateValue(roles, rolePerms, overrides, key, branch, rules) === value) delete next[scoped(key, branch)];
  else next[scoped(key, branch)] = value;
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

export const pageChanged = (page: CatalogPage, overrides: Overrides, branch?: string | null) =>
  pageKeys(page).some((k) => scoped(k, branch) in overrides);

export function resetPage(page: CatalogPage, overrides: Overrides, branch?: string | null): Overrides {
  const next = { ...overrides };
  pageKeys(page).forEach((k) => delete next[scoped(k, branch)]);
  return next;
}

/** «الكل مسموح» for one page: the page, every action, every tab and every part on. */
export function allowAllPage(roles: Roles, rolePerms: RolePerms, page: CatalogPage, overrides: Overrides, branch?: string | null, rules?: BranchRules): Overrides {
  let next = { ...overrides };
  pageKeys(page).forEach((k) => { next = setOverride(roles, rolePerms, next, k, true, branch, rules); });
  return next;
}

/** Overrides compared with the template: extra = allowed beyond it, revoked = taken away (each with its branch). */
export function diffOverrides(roles: Roles, rolePerms: RolePerms, overrides: Overrides, rules?: BranchRules) {
  const extra: string[] = [];
  const revoked: string[] = [];
  Object.entries(overrides).forEach(([k, v]) => {
    const { key, branch } = parseKey(k);
    const t = templateValue(roles, rolePerms, overrides, key, branch, rules);
    if (v && !t) extra.push(k);
    else if (!v && t) revoked.push(k);
  });
  return { extra, revoked };
}

/** «شيل الصلاحيات الزيادة بس»: keep the restrictions, drop the extra grants. */
export function clearExtras(roles: Roles, rolePerms: RolePerms, overrides: Overrides, rules?: BranchRules): Overrides {
  const { extra } = diffOverrides(roles, rolePerms, overrides, rules);
  const next = { ...overrides };
  extra.forEach((k) => delete next[k]);
  return next;
}

/** Overrides of one branch only / of the base only. */
export const branchOverrides = (overrides: Overrides, branch: string | null) =>
  Object.keys(overrides).filter((k) => parseKey(k).branch === branch);

/** Readable label for any key (page action, tab, part); the branch name is added by the caller. */
export function keyLabel(k: string): string {
  const { key } = parseKey(k);
  const ACT: Record<string, string> = { view: "يشوف", create: "يضيف", update: "يعدل", delete: "يلغي" };
  for (const s of PERMISSION_CATALOG) for (const p of s.pages) {
    for (const a of p.actions) if (key === `${p.key}.${a}`) return `${p.label} — ${ACT[a]}`;
    for (const c of p.children) if (key === `${c.key}.view`) return `${p.label} ← ${c.label}`;
    for (const x of p.parts) if (key === partKey(p.key, x.id)) return `${p.label} ← ${x.label}`;
  }
  return key;
}

/** Overrides → rows for save_user_permissions. */
export const toRows = (overrides: Overrides) =>
  Object.entries(overrides).map(([k, allowed]) => {
    const { key, branch } = parseKey(k);
    return branch ? { key, allowed, branch } : { key, allowed };
  });

/** DB rows → overrides map. */
export const fromRows = (rows: { permission_key: string; allowed: boolean; branch_id?: string | null }[]): Overrides =>
  Object.fromEntries(rows.map((r) => [r.branch_id ? branchKey(r.permission_key, r.branch_id) : r.permission_key, !!r.allowed]));
