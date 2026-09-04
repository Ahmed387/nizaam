import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";

function RedirectToTreasury() {
  const { id } = useParams();
  return <Navigate to={`/branch/${id}/treasury`} replace />;
}

function RedirectReturnsToInvoices() {
  const { id } = useParams();
  return <Navigate to={`/branch/${id}/invoices?tab=sale_return`} replace />;
}

function RedirectCustomerToContact() {
  const { id, contactId } = useParams();
  return <Navigate to={`/branch/${id}/contacts/${contactId}`} replace />;
}

function RedirectSupplierToContact() {
  const { id, contactId } = useParams();
  return <Navigate to={`/branch/${id}/contacts/${contactId}`} replace />;
}

function AdminRedirectToContact() {
  const { contactId } = useParams();
  return <Navigate to={`/admin/contacts/${contactId}`} replace />;
}

import { Toaster as Sonner } from "@/components/ui/sonner";
import { ConfirmDialogHost } from "@/components/ConfirmDialog";
import ShiftAlertBar from "@/components/ShiftAlertBar";
import DesktopNotifications from "@/components/DesktopNotifications";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { PaidCelebration } from "@/components/PaidCelebration";

function PresenceTracker() {
  usePresenceHeartbeat();
  return null;
}

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Setup from "./pages/Setup";
import SetupWizard from "./pages/SetupWizard";
import Signup from "./pages/Signup";
import Landing from "./pages/Landing";
import Profile from "./pages/Profile";
import Guide from "./pages/Guide";
import Suspended from "./pages/Suspended";


import AdminDashboard from "./pages/admin/Dashboard";
import Branches from "./pages/admin/Branches";
import BranchProfile from "./pages/admin/BranchProfile";

import Categories from "./pages/admin/Categories";
import PriceList from "./pages/admin/PriceList";
import AllPreOrders from "./pages/admin/AllPreOrders";

import AllInventory from "./pages/admin/AllInventory";
import AllSuppliers from "./pages/admin/AllSuppliers";
import AllEmployees from "./pages/admin/AllEmployees";
import EmployeeProfile from "./pages/admin/EmployeeProfile";
import AuditLog from "./pages/admin/AuditLog";
import PriceAuditLog from "./pages/admin/PriceAuditLog";
import ProductAttributes from "./pages/admin/ProductAttributes";

import BranchDashboard from "./pages/branch/Dashboard";
import NewSale from "./pages/branch/NewSale";
import ShiftOpen from "./pages/branch/ShiftOpen";
import ShiftClose from "./pages/branch/ShiftClose";
import EditSaleInvoice from "./pages/branch/EditSaleInvoice";
import PreOrders from "./pages/branch/PreOrders";
import SalesHistory from "./pages/branch/SalesHistory";
import InvoiceView from "./pages/branch/InvoiceView";
import Inventory from "./pages/branch/Inventory";
import StockMovements from "./pages/branch/StockMovements";
import PrintBarcodes from "./pages/branch/PrintBarcodes";
import Contacts from "./pages/branch/Contacts";
import SupplierProfile from "./pages/branch/SupplierProfile";
import ContactStatement from "./pages/branch/ContactStatement";
import Treasury from "./pages/branch/Treasury";
import Employees from "./pages/branch/Employees";
import AdvanceRequests from "./pages/branch/AdvanceRequests";
import Shipments from "./pages/branch/Shipments";
import NewShipment from "./pages/branch/NewShipment";
import ShipmentView from "./pages/branch/ShipmentView";


import BranchReports from "./pages/branch/Reports";
import AdminReports from "./pages/admin/Reports";
import StockTransfers from "./pages/branch/StockTransfers";
import Settings from "./pages/admin/Settings";
import SeedData from "./pages/admin/SeedData";
import ScheduledReports from "./pages/admin/ScheduledReports";
import AllAttendance from "./pages/admin/AllAttendance";
import Presence from "./pages/admin/Presence";
import ShiftsHistory from "./pages/admin/ShiftsHistory";
import Attendance from "./pages/branch/Attendance";
import Receivables from "./pages/admin/Receivables";
import { AdminPlaceholder, BranchPlaceholder } from "./pages/Placeholder";
import Invoices from "./pages/branch/Invoices";
import NewPurchaseReturn from "./pages/branch/NewPurchaseReturn";
import NewSaleReturn from "./pages/branch/NewSaleReturn";
import SaleReturnView from "./pages/branch/SaleReturnView";
import PurchaseReturnView from "./pages/branch/PurchaseReturnView";
import StockTransferView from "./pages/branch/StockTransferView";
import NewQuote from "./pages/branch/NewQuote";
import QuoteView from "./pages/branch/QuoteView";
import NewStockAdjustment from "./pages/branch/NewStockAdjustment";
import PaymentVouchers from "./pages/branch/PaymentVouchers";
import ReceiptVouchers from "./pages/branch/ReceiptVouchers";
import AllVouchers from "./pages/admin/AllVouchers";
import CatalogHub from "./pages/admin/CatalogHub";
import ReportsHub from "./pages/admin/ReportsHub";
import OwnerCockpit from "./pages/admin/OwnerCockpit";


import InsightsPage from "./pages/admin/InsightsPage";
import FinanceHub from "./pages/admin/FinanceHub";
import MainTreasury from "./pages/admin/MainTreasury";
import ApprovalRequests from "./pages/admin/ApprovalRequests";
import AdminApprovalsHub from "./pages/admin/AdminApprovalsHub";
import ProfitabilityReport from "./pages/admin/ProfitabilityReport";
import AdminDiscountApprovals from "./pages/admin/AdminDiscountApprovals";
import FinancialDashboard from "./pages/admin/FinancialDashboard";
import MyApprovalRequests from "./pages/branch/MyApprovalRequests";
import PendingDiscountApprovals from "./pages/branch/PendingDiscountApprovals";
import PendingVoidApprovals from "./pages/branch/PendingVoidApprovals";
import InvCountSessions from "./pages/branch/inventory-count/Sessions";
import InvCountNew from "./pages/branch/inventory-count/NewSession";
import InvCountSheet from "./pages/branch/inventory-count/CountingSheet";
import InvCountReview from "./pages/branch/inventory-count/Review";
import InvCountApproval from "./pages/branch/inventory-count/Approval";
import InvCountReport from "./pages/branch/inventory-count/Report";
import InvCountSnapshot from "./pages/branch/inventory-count/Snapshot";

import SuperDashboard from "./pages/super/Dashboard";
import SuperTenants from "./pages/super/Tenants";
import SuperUsers from "./pages/super/AllUsers";
import AttachmentsHub from "./pages/AttachmentsHub";
import FinancialPosition from "./pages/admin/FinancialPosition";
import AdminPartnerProfile from "./pages/admin/PartnerProfile";
import PartnerAdvanceDetail from "./pages/admin/PartnerAdvanceDetail";
import SystemHealth from "./pages/admin/SystemHealth";
import PersonalExpenses from "./pages/admin/PersonalExpenses";
import AskMe from "./pages/admin/AskMe";
import PartnerDashboard from "./pages/partner/Dashboard";
import PartnerLedger from "./pages/partner/Ledger";
import PartnerAdvancesView from "./pages/partner/Advances";
import PartnerProfilePage from "./pages/partner/Profile";
import ChartOfAccounts from "./pages/admin/ChartOfAccounts";
import JournalEntriesPage from "./pages/admin/JournalEntries";
import JournalEntryDetail from "./pages/admin/JournalEntryDetail";
import GeneralLedger from "./pages/admin/GeneralLedger";
import TrialBalance from "./pages/admin/TrialBalance";
import BalanceSheet from "./pages/admin/BalanceSheet";
import IncomeStatement from "./pages/admin/IncomeStatement";
import CashFlowStatement from "./pages/admin/CashFlowStatement";
import AgingReport from "./pages/admin/AgingReport";
import BankReconciliation from "./pages/admin/BankReconciliation";
import BankReconciliationDetail from "./pages/admin/BankReconciliationDetail";
import FiscalClosing from "./pages/admin/FiscalClosing";
import OpeningBalances from "./pages/admin/OpeningBalances";
import FlexibleDistribution from "./pages/admin/FlexibleDistribution";
import Budgets from "./pages/admin/Budgets";
import KpiDashboard from "./pages/admin/KpiDashboard";
import FixedAssets from "./pages/admin/FixedAssets";
import BranchCapital from "./pages/admin/BranchCapital";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner position="top-center" dir="rtl" />
        <ConfirmDialogHost />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
          <PresenceTracker />
          <PaidCelebration />
          <ShiftAlertBar />
          <DesktopNotifications />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/welcome" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/admin/setup-wizard" element={<SetupWizard />} />
            <Route path="/setup-wizard" element={<SetupWizard />} />
            <Route path="/suspended" element={<Suspended />} />
            
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/guide" element={<ProtectedRoute><Guide /></ProtectedRoute>} />


            {/* Super Admin */}
            <Route path="/super/dashboard" element={<ProtectedRoute superAdminOnly><SuperDashboard /></ProtectedRoute>} />
            <Route path="/super/tenants" element={<ProtectedRoute superAdminOnly><SuperTenants /></ProtectedRoute>} />
            <Route path="/super/users" element={<ProtectedRoute superAdminOnly><SuperUsers /></ProtectedRoute>} />

            {/* Admin */}
            <Route path="/admin/dashboard" element={<ProtectedRoute perm="admin_home.view" adminOnly><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/branches/:id" element={<ProtectedRoute adminOnly><BranchProfile /></ProtectedRoute>} />
            <Route path="/admin/pre-orders" element={<ProtectedRoute adminOnly><AllPreOrders /></ProtectedRoute>} />
            <Route path="/admin/contacts" element={<ProtectedRoute perm="admin_contacts.view" adminOnly><AllSuppliers /></ProtectedRoute>} />
            <Route path="/admin/suppliers" element={<Navigate to="/admin/contacts?type=supplier" replace />} />
            <Route path="/admin/contacts/:contactId" element={<ProtectedRoute adminOnly><SupplierProfile /></ProtectedRoute>} />
            <Route path="/admin/suppliers/:contactId" element={<AdminRedirectToContact />} />
            <Route path="/admin/employees" element={<ProtectedRoute perm="admin_employees.view" roles={["supervisor"]}><AllEmployees /></ProtectedRoute>} />
            <Route path="/admin/employees/:id" element={<ProtectedRoute roles={["supervisor"]}><EmployeeProfile /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute perm="admin_settings.view" adminOnly><Settings /></ProtectedRoute>} />
            <Route path="/admin/approval-requests" element={<ProtectedRoute adminOnly><Navigate to="/admin/approvals-hub?tab=approvals" replace /></ProtectedRoute>} />
            <Route path="/admin/approvals-hub" element={<ProtectedRoute perm="admin_approvals.view" adminOnly><AdminApprovalsHub /></ProtectedRoute>} />
            <Route path="/admin/seed" element={<ProtectedRoute adminOnly><SeedData /></ProtectedRoute>} />
            <Route path="/admin/attendance" element={<ProtectedRoute roles={["supervisor"]}><AllAttendance /></ProtectedRoute>} />
            <Route path="/admin/presence" element={<ProtectedRoute perm="admin_presence.view" roles={["admin", "supervisor", "viewer"]}><Presence /></ProtectedRoute>} />
            <Route path="/admin/attachments" element={<ProtectedRoute adminOnly><AttachmentsHub scope="admin" /></ProtectedRoute>} />


            {/* Hubs */}
            <Route path="/admin/catalog" element={<ProtectedRoute perm="admin_catalog.view" adminOnly><CatalogHub /></ProtectedRoute>} />
            <Route path="/admin/reports-hub" element={<ProtectedRoute perm="admin_reports_hub.view" adminOnly><ReportsHub /></ProtectedRoute>} />
            <Route path="/admin/historical-analytics" element={<Navigate to="/admin/reports-hub?tab=historical" replace />} />
            <Route path="/admin/cockpit" element={<ProtectedRoute perm="admin_reports_hub.view" adminOnly><OwnerCockpit /></ProtectedRoute>} />

            <Route path="/admin/monthly-profit" element={<Navigate to="/admin/reports-hub?tab=monthly" replace />} />
            <Route path="/admin/insights" element={<ProtectedRoute perm="admin_insights.view" ownerOnly><InsightsPage /></ProtectedRoute>} />
            <Route path="/admin/finance" element={<ProtectedRoute perm="admin_finance.view" adminOnly><FinanceHub /></ProtectedRoute>} />
            <Route path="/admin/main-treasury" element={<ProtectedRoute perm="admin_main_treasury.view" adminOnly><MainTreasury /></ProtectedRoute>} />
            <Route path="/admin/financial-dashboard" element={<ProtectedRoute adminOnly><FinancialDashboard /></ProtectedRoute>} />
            <Route path="/admin/report-comparison" element={<Navigate to="/admin/reports-hub?tab=comparison" replace />} />

            {/* Legacy redirects → hubs */}
            <Route path="/admin/branches" element={<Navigate to="/admin/catalog?tab=branches" replace />} />
            <Route path="/admin/categories" element={<Navigate to="/admin/catalog?tab=categories" replace />} />
            <Route path="/admin/pricelist" element={<Navigate to="/admin/catalog?tab=pricelist" replace />} />
            <Route path="/admin/inventory" element={<Navigate to="/admin/catalog?tab=inventory" replace />} />
            <Route path="/admin/reports" element={<Navigate to="/admin/reports-hub?tab=central" replace />} />
            <Route path="/admin/scheduled-reports" element={<Navigate to="/admin/reports-hub?tab=scheduled" replace />} />
            <Route path="/admin/audit-log" element={<Navigate to="/admin/reports-hub?tab=audit" replace />} />
            <Route path="/admin/product-attributes" element={<ProtectedRoute perm="admin_product_attributes.view" adminOnly><ProductAttributes /></ProtectedRoute>} />
            <Route path="/admin/price-audit" element={<ProtectedRoute adminOnly><PriceAuditLog /></ProtectedRoute>} />
            <Route path="/admin/vouchers" element={<Navigate to="/admin/finance?tab=vouchers" replace />} />
            <Route path="/admin/receivables" element={<Navigate to="/admin/finance?tab=receivables" replace />} />

            {/* Financial Position (Partners) */}
            <Route path="/admin/financial-position" element={<ProtectedRoute perm="admin_financial_position.view" ownerOnly><FinancialPosition /></ProtectedRoute>} />
            <Route path="/admin/financial-position/partners" element={<Navigate to="/admin/financial-position?tab=partners" replace />} />
            <Route path="/admin/financial-position/partner/:id" element={<ProtectedRoute ownerOnly><AdminPartnerProfile /></ProtectedRoute>} />
            <Route path="/admin/financial-position/transactions" element={<Navigate to="/admin/financial-position?tab=transactions" replace />} />
            <Route path="/admin/financial-position/advances" element={<Navigate to="/admin/financial-position?tab=advances" replace />} />
            <Route path="/admin/financial-position/advance/:id" element={<ProtectedRoute ownerOnly><PartnerAdvanceDetail /></ProtectedRoute>} />
            <Route path="/admin/shifts" element={<ProtectedRoute perm="admin_shifts.view" roles={["admin", "super_admin", "supervisor"]}><ShiftsHistory /></ProtectedRoute>} />
            <Route path="/admin/system-health" element={<ProtectedRoute perm="admin_system_health.view" ownerOnly><SystemHealth /></ProtectedRoute>} />
            <Route path="/admin/ask-me" element={<ProtectedRoute perm="admin_ask_me.view"><AskMe /></ProtectedRoute>} />
            <Route path="/admin/personal-expenses" element={<ProtectedRoute><PersonalExpenses /></ProtectedRoute>} />




            {/* Accounting — General Ledger */}
            <Route path="/admin/accounting/chart" element={<ProtectedRoute perm="admin_finance.view" adminOnly><ChartOfAccounts /></ProtectedRoute>} />
            <Route path="/admin/accounting/journal" element={<ProtectedRoute perm="admin_finance.view" adminOnly><JournalEntriesPage /></ProtectedRoute>} />
            <Route path="/admin/accounting/journal/:id" element={<ProtectedRoute perm="admin_finance.view" adminOnly><JournalEntryDetail /></ProtectedRoute>} />
            <Route path="/admin/accounting/ledger" element={<ProtectedRoute perm="admin_finance.view" adminOnly><GeneralLedger /></ProtectedRoute>} />
            <Route path="/admin/accounting/trial-balance" element={<ProtectedRoute perm="admin_finance.view" adminOnly><TrialBalance /></ProtectedRoute>} />
            <Route path="/admin/accounting/balance-sheet" element={<ProtectedRoute perm="admin_finance.view" adminOnly><BalanceSheet /></ProtectedRoute>} />
            <Route path="/admin/accounting/income-statement" element={<ProtectedRoute perm="admin_finance.view" adminOnly><IncomeStatement /></ProtectedRoute>} />
            <Route path="/admin/accounting/cash-flow" element={<ProtectedRoute perm="admin_finance.view" adminOnly><CashFlowStatement /></ProtectedRoute>} />
            <Route path="/admin/accounting/aging" element={<ProtectedRoute perm="admin_finance.view" adminOnly><AgingReport /></ProtectedRoute>} />
            <Route path="/admin/accounting/bank-reconciliation" element={<ProtectedRoute perm="admin_finance.view" adminOnly><BankReconciliation /></ProtectedRoute>} />
            <Route path="/admin/accounting/bank-reconciliation/:id" element={<ProtectedRoute perm="admin_finance.view" adminOnly><BankReconciliationDetail /></ProtectedRoute>} />
            <Route path="/admin/accounting/fiscal-closing" element={<ProtectedRoute perm="admin_finance.view" adminOnly><FiscalClosing /></ProtectedRoute>} />
            <Route path="/admin/accounting/opening-balances" element={<ProtectedRoute perm="admin_finance.view" adminOnly><OpeningBalances /></ProtectedRoute>} />
            <Route path="/admin/accounting/flexible-distribution" element={<ProtectedRoute perm="admin_finance.view" adminOnly><FlexibleDistribution /></ProtectedRoute>} />
            <Route path="/admin/accounting/budgets" element={<ProtectedRoute perm="admin_finance.view" adminOnly><Budgets /></ProtectedRoute>} />
            <Route path="/admin/accounting/kpis" element={<ProtectedRoute perm="admin_finance.view" adminOnly><KpiDashboard /></ProtectedRoute>} />
            <Route path="/admin/accounting/fixed-assets" element={<ProtectedRoute perm="admin_finance.view" adminOnly><FixedAssets /></ProtectedRoute>} />
            <Route path="/admin/accounting/branch-capital" element={<ProtectedRoute perm="admin_finance.view" adminOnly><BranchCapital /></ProtectedRoute>} />


            {/* Partner portal */}
            <Route path="/partner/dashboard" element={<ProtectedRoute roles={["partner"]}><PartnerDashboard /></ProtectedRoute>} />
            <Route path="/partner/ledger" element={<ProtectedRoute roles={["partner"]}><PartnerLedger /></ProtectedRoute>} />
            <Route path="/partner/advances" element={<ProtectedRoute roles={["partner"]}><PartnerAdvancesView /></ProtectedRoute>} />
            <Route path="/partner/profile" element={<ProtectedRoute roles={["partner"]}><PartnerProfilePage /></ProtectedRoute>} />



            {/* Branch */}
            {/* Branch */}
            <Route path="/branch/:id/dashboard" element={<ProtectedRoute perm="dashboard.view"><BranchDashboard /></ProtectedRoute>} />
            <Route path="/branch/:id/treasury" element={<ProtectedRoute perm="treasury.view"><Treasury /></ProtectedRoute>} />
            <Route path="/branch/:id/payment-vouchers" element={<RedirectToTreasury />} />
            <Route path="/branch/:id/receipt-vouchers" element={<RedirectToTreasury />} />

            <Route path="/branch/:id/sales" element={<RedirectReturnsToInvoices />} />
            <Route path="/branch/:id/sales-history" element={<ProtectedRoute perm="sales.view"><SalesHistory /></ProtectedRoute>} />
            <Route path="/branch/:id/invoices" element={<ProtectedRoute perm="invoices.view"><Invoices /></ProtectedRoute>} />
            <Route path="/branch/:id/purchase-returns/new" element={<ProtectedRoute perm="shipments.create"><NewPurchaseReturn /></ProtectedRoute>} />
            <Route path="/branch/:id/sale-returns/new" element={<ProtectedRoute perm="sales.create"><NewSaleReturn /></ProtectedRoute>} />
            <Route path="/branch/:id/quotes/new" element={<ProtectedRoute perm="sales.create"><NewQuote /></ProtectedRoute>} />
            <Route path="/branch/:id/quotes/:quoteId" element={<ProtectedRoute perm="sales.view"><QuoteView /></ProtectedRoute>} />
            <Route path="/branch/:id/adjustments/new" element={<ProtectedRoute perm="inventory.update"><NewStockAdjustment /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/new" element={<ProtectedRoute perm="sales.create"><NewSale /></ProtectedRoute>} />
            <Route path="/branch/:id/shifts/open" element={<ProtectedRoute perm="sales.create"><ShiftOpen /></ProtectedRoute>} />
            <Route path="/branch/:id/shifts/close" element={<ProtectedRoute perm="sales.create"><ShiftClose /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/returns" element={<RedirectReturnsToInvoices />} />
            
            <Route path="/branch/:id/sales/:invoiceId/edit" element={<ProtectedRoute perm="sales.create"><EditSaleInvoice /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/:invoiceId" element={<ProtectedRoute perm="sales.view"><InvoiceView /></ProtectedRoute>} />
            <Route path="/branch/:id/pre-orders" element={<ProtectedRoute perm="preorders.view"><PreOrders /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments" element={<ProtectedRoute perm="shipments.view"><Shipments /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments/new" element={<ProtectedRoute perm="shipments.create"><NewShipment /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments/:shipmentId" element={<ProtectedRoute perm="shipments.view"><ShipmentView /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments/:shipmentId/edit" element={<ProtectedRoute perm="shipments.create"><NewShipment /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory" element={<ProtectedRoute perm="inventory.view"><Inventory /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory/barcodes" element={<ProtectedRoute perm="inventory.update"><PrintBarcodes /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory/:productId/movements" element={<ProtectedRoute perm="inventory.view"><StockMovements /></ProtectedRoute>} />
            <Route path="/branch/:id/transfers" element={<ProtectedRoute perm="transfers.view"><StockTransfers /></ProtectedRoute>} />
            <Route path="/branch/:id/transfers/:transferId" element={<ProtectedRoute perm="transfers.view"><StockTransferView /></ProtectedRoute>} />
            <Route path="/branch/:id/sale-returns/:returnId" element={<ProtectedRoute perm="sales.view"><SaleReturnView /></ProtectedRoute>} />
            <Route path="/branch/:id/purchase-returns/:returnId" element={<ProtectedRoute perm="shipments.view"><PurchaseReturnView /></ProtectedRoute>} />
            <Route path="/branch/:id/contacts" element={<ProtectedRoute perm="customers.view"><Contacts /></ProtectedRoute>} />
            <Route path="/branch/:id/contacts/:contactId" element={<ProtectedRoute perm="customers.view"><SupplierProfile /></ProtectedRoute>} />
            <Route path="/branch/:id/contacts/:contactId/statement" element={<ProtectedRoute perm="customers.view"><ContactStatement /></ProtectedRoute>} />
            <Route path="/admin/contacts/:contactId/statement" element={<ProtectedRoute adminOnly><ContactStatement /></ProtectedRoute>} />
            <Route path="/branch/:id/customers" element={<Navigate to="../contacts?tab=customer" replace />} />
            <Route path="/branch/:id/customers/:contactId" element={<RedirectCustomerToContact />} />
            <Route path="/branch/:id/suppliers" element={<Navigate to="../contacts?tab=supplier" replace />} />
            <Route path="/branch/:id/suppliers/:contactId" element={<RedirectSupplierToContact />} />
            <Route path="/branch/:id/employees" element={<ProtectedRoute perm="employees.view"><Employees /></ProtectedRoute>} />
            <Route path="/branch/:id/advance-requests" element={<ProtectedRoute perm="advances.view"><AdvanceRequests /></ProtectedRoute>} />
            <Route path="/branch/:id/approval-requests" element={<ProtectedRoute><MyApprovalRequests /></ProtectedRoute>} />

            <Route path="/branch/:id/discount-approvals" element={<ProtectedRoute><PendingDiscountApprovals /></ProtectedRoute>} />
            <Route path="/branch/:id/void-approvals" element={<ProtectedRoute><PendingVoidApprovals /></ProtectedRoute>} />
            <Route path="/admin/discount-approvals" element={<ProtectedRoute adminOnly><Navigate to="/admin/approvals-hub?tab=discounts" replace /></ProtectedRoute>} />
            <Route path="/admin/profitability" element={<ProtectedRoute adminOnly><Navigate to="/admin/reports-hub?tab=profitability" replace /></ProtectedRoute>} />

            <Route path="/branch/:id/reports" element={<ProtectedRoute perm="reports.view"><BranchReports /></ProtectedRoute>} />
            <Route path="/branch/:id/attendance" element={<ProtectedRoute perm="attendance.view"><Attendance /></ProtectedRoute>} />
            <Route path="/branch/:id/attachments" element={<ProtectedRoute perm="attachments.view"><AttachmentsHub scope="branch" /></ProtectedRoute>} />


            {/* جرد المخزن */}
            <Route path="/branch/:id/inventory-count" element={<ProtectedRoute perm="inventory.view"><InvCountSessions /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory-count/new" element={<ProtectedRoute perm="inventory.view"><InvCountNew /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory-count/:sessionId/count" element={<ProtectedRoute perm="inventory.view"><InvCountSheet /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory-count/:sessionId/review" element={<ProtectedRoute perm="inventory.view"><InvCountReview /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory-count/:sessionId/approve" element={<ProtectedRoute perm="inventory.view"><InvCountApproval /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory-count/:sessionId/report" element={<ProtectedRoute perm="inventory.view"><InvCountReport /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory-count/:sessionId/snapshot" element={<ProtectedRoute perm="inventory.view"><InvCountSnapshot /></ProtectedRoute>} />


            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
