import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePartnersData } from "@/components/partners/usePartnersData";
import { PartnersCapitalTab } from "@/components/partners/PartnersCapitalTab";
import { PartnersDistributionTab } from "@/components/partners/PartnersDistributionTab";
import PartnersList from "./PartnersList";
import PartnerTransactions from "./PartnerTransactions";
import FinancialStatements from "./FinancialStatements";

/** accounting page → its permission (App.tsx guards the same keys; the sidebar «المحاسبة» group uses them too) */
export const ACC_PAGE_PERM: Record<string, string> = {
  "/admin/accounting/chart": "admin_acc_books.view", "/admin/accounting/journal": "admin_acc_books.view",
  "/admin/accounting/ledger": "admin_acc_books.view", "/admin/accounting/trial-balance": "admin_acc_books.view",
  "/admin/accounting/balance-sheet": "admin_acc_statements.view", "/admin/accounting/income-statement": "admin_acc_statements.view",
  "/admin/accounting/cash-flow": "admin_acc_statements.view", "/admin/accounting/equity-changes": "admin_acc_statements.view",
  "/admin/accounting/cogs-statement": "admin_acc_statements.view", "/admin/financial-statements": "admin_acc_statements.view",
  "/admin/accounting/aging": "admin_acc_aging.view", "/admin/accounting/opening-balances": "admin_acc_opening.view",
  "/admin/accounting/bank-reconciliation": "admin_acc_bank.view", "/admin/accounting/fiscal-closing": "admin_acc_closing.view",
  "/admin/accounting/flexible-distribution": "admin_acc_closing.view", "/admin/accounting/fixed-assets": "admin_acc_assets.view",
  "/admin/accounting/branch-capital": "admin_acc_branch_capital.view",
};

const TABS = ["partners", "capital", "distribution", "transactions", "statements"] as const;
type Tab = (typeof TABS)[number];

/**
 * «الشركاء» (owner 2026-11-25 «صفحة الشركاء كلها عاوزه تتظبط من الاول»): five tabs — الشركاء (cards, % of the profit,
 * pay), رأس المال («موجود بالفعل» / into a till / out), توزيع الأرباح (pay per month → the rest by capital), الحركات,
 * القوائم المالية. The old «نظرة عامة» is gone: its accounting links are the sidebar «المحاسبة» group, its cash /
 * مدين / دائن cards are on «الخزينة».
 */
export default function FinancialPosition() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "partners";
  const data = usePartnersData();

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title="الشركاء" subtitle="رأس مال كل شريك ونسبته، ومرتبه، وتوزيع الأرباح — في مكان واحد" />
        <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="partners">الشركاء</TabsTrigger>
            <TabsTrigger value="capital">رأس المال</TabsTrigger>
            <TabsTrigger value="distribution">توزيع الأرباح</TabsTrigger>
            <TabsTrigger value="transactions">الحركات</TabsTrigger>
            <TabsTrigger value="statements">القوائم المالية</TabsTrigger>
          </TabsList>
          <TabsContent value="partners" className="mt-4"><PartnersList data={data} /></TabsContent>
          <TabsContent value="capital" className="mt-4"><PartnersCapitalTab data={data} /></TabsContent>
          <TabsContent value="distribution" className="mt-4"><PartnersDistributionTab data={data} /></TabsContent>
          <TabsContent value="transactions" className="mt-4"><PartnerTransactions embedded /></TabsContent>
          <TabsContent value="statements" className="mt-4"><FinancialStatements embedded /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
