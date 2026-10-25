/**
 * Company roles (migration 0115, owner decision 2026-10-24): a company role («مندوب مبيعات») is a permission_templates row
 * (name + the ready role it is built on + its own differences), LINKED to its employees (user_company_roles).
 * In the app it is the pseudo role «tpl:<id>» whose map = the ready role's map with the company role's differences on top,
 * so `checkPermission` answers exactly like the server's `perm_resolve` (company role between manager and ready role).
 * Ready roles can be hidden / renamed per company (tenant_role_settings).
 */
import { AppRole, MANAGED_ROLES, ROLE_LABELS } from "@/lib/roles";

export type CompanyRole = { id: string; name: string; base_role: string; perms: Record<string, boolean> };
export type RoleSetting = { role: string; hidden: boolean; label: string | null };

export const tplRole = (id: string) => `tpl:${id}`;
export const isTplRole = (r: string) => r.startsWith("tpl:");
export const tplId = (r: string) => r.slice(4);

/** The roles + role maps the resolver uses for a person on a company role (unchanged when he is on none). */
export function withCompanyRole(
  roles: string[],
  permsByRole: Record<string, Record<string, boolean>>,
  role: CompanyRole | null | undefined,
): { roles: string[]; permsByRole: Record<string, Record<string, boolean>> } {
  if (!role) return { roles, permsByRole };
  const key = tplRole(role.id);
  return {
    roles: [key, ...roles.filter((r) => !MANAGED_ROLES.includes(r as AppRole))],
    permsByRole: { ...permsByRole, [key]: { ...(permsByRole[role.base_role] ?? {}), ...(role.perms ?? {}) } },
  };
}

/** Name of a role in this company: its own name if renamed, else the usual one. */
export function roleName(role: string, settings: RoleSetting[] | Record<string, RoleSetting>): string {
  const s = Array.isArray(settings) ? settings.find((x) => x.role === role) : settings[role];
  return s?.label || ROLE_LABELS[role as AppRole] || role;
}

export const hiddenRoles = (settings: RoleSetting[]) => new Set(settings.filter((s) => s.hidden).map((s) => s.role));
