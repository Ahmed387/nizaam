/**
 * The company's subscription plan in the app (migration 0239). `tenant_plan_state()` gives the catalogue pages / tabs
 * that are NOT in the plan; every permission key of such a page is closed for everybody (the company owner too).
 * After the grace days the company is read-only. No subscription = nothing closed.
 */
import { SUBSECTION_PARENT } from "@/lib/roles";

export type PlanStatus = "active" | "ending" | "grace" | "expired" | "none";

export interface PlanState {
  has_plan: boolean;
  plan?: string;
  cycle?: "monthly" | "yearly" | "unlimited";
  unlimited?: boolean;
  starts_on?: string;
  ends_on?: string | null;
  grace_days?: number;
  paid?: boolean;
  days_left?: number | null;
  status?: PlanStatus;
  disabled?: string[];
  limits?: { branches: number | null; users: number | null; invoices_month: number | null };
  usage?: { branches: number; users: number; invoices_month: number };
}

/** «sales.create» → sales, «part.dashboard.sales_today.view» → dashboard, «admin_eta.view» → admin_eta. */
export function featureOfKey(key: string): string {
  if (key.startsWith("part.")) return key.split(".")[1] ?? key;
  return key.split(".")[0] ?? key;
}

export function planAllows(disabled: ReadonlySet<string>, key: string): boolean {
  if (disabled.size === 0) return true;
  const page = featureOfKey(key);
  if (disabled.has(page)) return false;
  const parent = SUBSECTION_PARENT[page];
  return !(parent && disabled.has(parent));
}

export const planReadOnly = (s: PlanState | null) => !!s?.has_plan && s.status === "expired";

/** The banner line for the owner / admin, or null when nothing needs saying. */
export function planBanner(s: PlanState | null): { tone: "warn" | "bad"; text: string } | null {
  if (!s?.has_plan || s.unlimited) return null;
  const d = s.days_left ?? null;
  switch (s.status) {
    case "ending":
      return { tone: "warn", text: d === 0 ? `اشتراك باقة «${s.plan}» بيخلص النهارده — كلّم إدارة المنصة للتجديد` : `اشتراك باقة «${s.plan}» هيخلص بعد ${d} يوم — كلّم إدارة المنصة للتجديد` };
    case "grace": {
      const left = d != null && s.grace_days != null ? s.grace_days + d : null;
      return { tone: "bad", text: `اشتراك باقة «${s.plan}» خلص${left != null ? ` — باقي ${left} يوم وبعدها السيستم يبقى للعرض بس` : ""}` };
    }
    case "expired":
      return { tone: "bad", text: "الاشتراك خلص — السيستم دلوقتي للعرض بس (مفيش حفظ ولا تعديل) لحد التجديد. كلّم إدارة المنصة." };
    default:
      return null;
  }
}
