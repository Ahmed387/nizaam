import { lazy, Suspense, useEffect } from "react";
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

/** Shown for the split-second a page's code is downloaded the first time (pages load on demand). */
function RouteLoading() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
    </div>
  );
}

/**
 * Pages are split into their own files (the app used to ship one 5 MB file before the login screen could show).
 * After start-up, quietly fetch the screens a cashier needs even when the internet drops (sale, returns,
 * dashboard), and after a new deploy reload once if an old page file is gone.
 */
function PageWarmup() {
  useEffect(() => {
    const warm = () => {
      import("./pages/branch/NewSale"); import("./pages/branch/Dashboard"); import("./pages/branch/NewSaleReturn");
      import("./pages/branch/InvoiceView"); import("./pages/admin/Dashboard");
    };
    const w = window as any;
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 4000 }) : window.setTimeout(warm, 2500);
    const onStale = (e: Event) => {
      try {
        if (sessionStorage.getItem("chunk-reload") === "1") return;
        sessionStorage.setItem("chunk-reload", "1");
      } catch { /* storage blocked: still reload once */ }
      e.preventDefault();
      window.location.reload();
    };
    window.addEventListener("vite:preloadError", onStale);
    return () => {
      if (w.cancelIdleCallback && w.requestIdleCallback) w.cancelIdleCallback(id); else window.clearTimeout(id);
      window.removeEventListener("vite:preloadError", onStale);
    };
  }, []);
  return null;
}

function PresenceTracker() {
  usePresenceHeartbeat();
  return null;
}

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Setup = lazy(() => import("./pages/Setup"));
const SetupWizard = lazy(() => import("./pages/SetupWizard"));
const Landing = lazy(() => import("./pages/Landing"));
const Profile = lazy(() => import("./pages/Profile"));
const Guide = lazy(() => import("./pages/Guide"));
const Suspended = lazy(() => import("./pages/Suspended"));


const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const Branches = lazy(() => import("./pages/admin/Branches"));
const BranchProfile = lazy(() => import("./pages/admin/BranchProfile"));

const Categories = lazy(() => import("./pages/admin/Categories"));
const PriceList = lazy(() => import("./pages/admin/PriceList"));
const AllPreOrders = lazy(() => import("./pages/admin/AllPreOrders"));

const AllInventory = lazy(() => import("./pages/admin/AllInventory"));
const AllSuppliers = lazy(() => import("./pages/admin/AllSuppliers"));
const AllEmployees = lazy(() => import("./pages/admin/AllEmployees"));
const EmployeeProfile = lazy(() => import("./pages/admin/EmployeeProfile"));
const AuditLog = lazy(() => import("./pages/admin/AuditLog"));
const PriceAuditLog = lazy(() => import("./pages/admin/PriceAuditLog"));


const BranchDashboard = lazy(() => import("./pages/branch/Dashboard"));
const NewSale = lazy(() => import("./pages/branch/NewSale"));
const ShiftOpen = lazy(() => import("./pages/branch/ShiftOpen"));
const ShiftClose = lazy(() => import("./pages/branch/ShiftClose"));
const EditSaleInvoice = lazy(() => import("./pages/branch/EditSaleInvoice"));
const PreOrders = lazy(() => import("./pages/branch/PreOrders"));
const SalesHistory = lazy(() => import("./pages/branch/SalesHistory"));
const InvoiceView = lazy(() => import("./pages/branch/InvoiceView"));
const Inventory = lazy(() => import("./pages/branch/Inventory"));
const StockMovements = lazy(() => import("./pages/branch/StockMovements"));
const PrintBarcodes = lazy(() => import("./pages/branch/PrintBarcodes"));
const Contacts = lazy(() => import("./pages/branch/Contacts"));
const ContactFile = lazy(() => import("./pages/branch/ContactFile"));
const ContactStatement = lazy(() => import("./pages/branch/ContactStatement"));
const Treasury = lazy(() => import("./pages/branch/Treasury"));
const Employees = lazy(() => import("./pages/branch/Employees"));
const AdvanceRequests = lazy(() => import("./pages/branch/AdvanceRequests"));
const Shipments = lazy(() => import("./pages/branch/Shipments"));
const NewShipment = lazy(() => import("./pages/branch/NewShipment"));
const ShipmentView = lazy(() => import("./pages/branch/ShipmentView"));


const BranchReports = lazy(() => import("./pages/branch/Reports"));
const AdminReports = lazy(() => import("./pages/admin/Reports"));
const StockTransfers = lazy(() => import("./pages/branch/StockTransfers"));
const Settings = lazy(() => import("./pages/admin/Settings"));
const ScheduledReports = lazy(() => import("./pages/admin/ScheduledReports"));
const AllAttendance = lazy(() => import("./pages/admin/AllAttendance"));
const Presence = lazy(() => import("./pages/admin/Presence"));
const ShiftsHistory = lazy(() => import("./pages/admin/ShiftsHistory"));
const Attendance = lazy(() => import("./pages/branch/Attendance"));
const Receivables = lazy(() => import("./pages/admin/Receivables"));
import { AdminPlaceholder, BranchPlaceholder } from "./pages/Placeholder";
const Invoices = lazy(() => import("./pages/branch/Invoices"));
const NewPurchaseReturn = lazy(() => import("./pages/branch/NewPurchaseReturn"));
const NewSaleReturn = lazy(() => import("./pages/branch/NewSaleReturn"));
const SaleReturnView = lazy(() => import("./pages/branch/SaleReturnView"));
const VoucherView = lazy(() => import("./pages/branch/VoucherView"));
const PurchaseReturnView = lazy(() => import("./pages/branch/PurchaseReturnView"));
const StockTransferView = lazy(() => import("./pages/branch/StockTransferView"));
const NewQuote = lazy(() => import("./pages/branch/NewQuote"));
const QuoteView = lazy(() => import("./pages/branch/QuoteView"));
const NewStockAdjustment = lazy(() => import("./pages/branch/NewStockAdjustment"));
const PaymentVouchers = lazy(() => import("./pages/branch/PaymentVouchers"));
const ReceiptVouchers = lazy(() => import("./pages/branch/ReceiptVouchers"));
const AllVouchers = lazy(() => import("./pages/admin/AllVouchers"));
const CatalogHub = lazy(() => import("./pages/admin/CatalogHub"));
const ReportsHub = lazy(() => import("./pages/admin/ReportsHub"));
const HistoricalAnalytics = lazy(() => import("./pages/admin/HistoricalAnalytics"));


const FinanceHub = lazy(() => import("./pages/admin/FinanceHub"));
const MainTreasury = lazy(() => import("./pages/admin/MainTreasury"));
const ApprovalRequests = lazy(() => import("./pages/admin/ApprovalRequests"));
const AdminApprovalsHub = lazy(() => import("./pages/admin/AdminApprovalsHub"));
const ProfitabilityReport = lazy(() => import("./pages/admin/ProfitabilityReport"));
const AdminDiscountApprovals = lazy(() => import("./pages/admin/AdminDiscountApprovals"));
const MyApprovalRequests = lazy(() => import("./pages/branch/MyApprovalRequests"));
const PendingDiscountApprovals = lazy(() => import("./pages/branch/PendingDiscountApprovals"));
const PendingVoidApprovals = lazy(() => import("./pages/branch/PendingVoidApprovals"));
const InvCountSessions = lazy(() => import("./pages/branch/inventory-count/Sessions"));
const InvCountNew = lazy(() => import("./pages/branch/inventory-count/NewSession"));
const InvCountSheet = lazy(() => import("./pages/branch/inventory-count/CountingSheet"));
const InvCountReview = lazy(() => import("./pages/branch/inventory-count/Review"));
const InvCountApproval = lazy(() => import("./pages/branch/inventory-count/Approval"));
const InvCountReport = lazy(() => import("./pages/branch/inventory-count/Report"));
const InvCountSnapshot = lazy(() => import("./pages/branch/inventory-count/Snapshot"));

const SuperDashboard = lazy(() => import("./pages/super/Dashboard"));
const SuperTenants = lazy(() => import("./pages/super/Tenants"));
const SuperUsers = lazy(() => import("./pages/super/AllUsers"));
const AttachmentsHub = lazy(() => import("./pages/AttachmentsHub"));
const FinancialPosition = lazy(() => import("./pages/admin/FinancialPosition"));
const AdminPartnerProfile = lazy(() => import("./pages/admin/PartnerProfile"));
const SystemHealth = lazy(() => import("./pages/admin/SystemHealth"));
const PersonalExpenses = lazy(() => import("./pages/admin/PersonalExpenses"));
const AskMe = lazy(() => import("./pages/admin/AskMe"));
const PartnerDashboard = lazy(() => import("./pages/partner/Dashboard"));
const PartnerLedger = lazy(() => import("./pages/partner/Ledger"));
const PartnerProfilePage = lazy(() => import("./pages/partner/Profile"));
const ChartOfAccounts = lazy(() => import("./pages/admin/ChartOfAccounts"));
const JournalEntriesPage = lazy(() => import("./pages/admin/JournalEntries"));
const JournalEntryDetail = lazy(() => import("./pages/admin/JournalEntryDetail"));
const GeneralLedger = lazy(() => import("./pages/admin/GeneralLedger"));
const TrialBalance = lazy(() => import("./pages/admin/TrialBalance"));
const BalanceSheet = lazy(() => import("./pages/admin/BalanceSheet"));
const IncomeStatement = lazy(() => import("./pages/admin/IncomeStatement"));
const CashFlowStatement = lazy(() => import("./pages/admin/CashFlowStatement"));
const AgingReport = lazy(() => import("./pages/admin/AgingReport"));
const BankReconciliation = lazy(() => import("./pages/admin/BankReconciliation"));
const BankReconciliationDetail = lazy(() => import("./pages/admin/BankReconciliationDetail"));
const FiscalClosing = lazy(() => import("./pages/admin/FiscalClosing"));
const OpeningBalances = lazy(() => import("./pages/admin/OpeningBalances"));
const FlexibleDistribution = lazy(() => import("./pages/admin/FlexibleDistribution"));
const FixedAssets = lazy(() => import("./pages/admin/FixedAssets"));
const BranchCapital = lazy(() => import("./pages/admin/BranchCapital"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner position="top-center" dir="rtl" />
        <ConfirmDialogHost />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
          <PresenceTracker />
          <PageWarmup />
          <PaidCelebration />
          <ShiftAlertBar />
          <DesktopNotifications />
          <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/welcome" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/signup" element={<Navigate to="/login" replace />} />
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
            <Route path="/admin/contacts/:contactId" element={<ProtectedRoute adminOnly><ContactFile /></ProtectedRoute>} />
            <Route path="/admin/suppliers/:contactId" element={<AdminRedirectToContact />} />
            <Route path="/admin/employees" element={<ProtectedRoute perm="admin_employees.view" roles={["supervisor"]}><AllEmployees /></ProtectedRoute>} />
            <Route path="/admin/employees/:id" element={<ProtectedRoute roles={["supervisor"]}><EmployeeProfile /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute perm="admin_settings.view" adminOnly><Settings /></ProtectedRoute>} />
            <Route path="/admin/approval-requests" element={<ProtectedRoute adminOnly><Navigate to="/admin/approvals-hub?tab=approvals" replace /></ProtectedRoute>} />
            <Route path="/admin/approvals-hub" element={<ProtectedRoute perm="admin_approvals.view" adminOnly><AdminApprovalsHub /></ProtectedRoute>} />
            <Route path="/admin/attendance" element={<ProtectedRoute roles={["supervisor"]}><AllAttendance /></ProtectedRoute>} />
            <Route path="/admin/presence" element={<ProtectedRoute perm="admin_presence.view" roles={["admin", "supervisor", "viewer"]}><Presence /></ProtectedRoute>} />
            <Route path="/admin/attachments" element={<ProtectedRoute adminOnly><AttachmentsHub scope="admin" /></ProtectedRoute>} />


            {/* Hubs */}
            <Route path="/admin/catalog" element={<ProtectedRoute perm="admin_catalog.view" adminOnly><CatalogHub /></ProtectedRoute>} />
            <Route path="/admin/reports-hub" element={<ProtectedRoute perm="admin_reports_hub.view" adminOnly><ReportsHub /></ProtectedRoute>} />
            <Route path="/admin/historical-analytics" element={<ProtectedRoute perm="admin_historical_analytics.view" adminOnly><HistoricalAnalytics /></ProtectedRoute>} />
            <Route path="/admin/cockpit" element={<Navigate to="/admin/reports-hub?tab=snapshot" replace />} />

            <Route path="/admin/monthly-profit" element={<Navigate to="/admin/reports-hub?tab=snapshot" replace />} />
            <Route path="/admin/insights" element={<Navigate to="/admin/reports-hub?tab=snapshot" replace />} />
            <Route path="/admin/finance" element={<ProtectedRoute perm="admin_finance.view" adminOnly><FinanceHub /></ProtectedRoute>} />
            <Route path="/admin/main-treasury" element={<ProtectedRoute perm="admin_main_treasury.view" adminOnly><MainTreasury /></ProtectedRoute>} />
            <Route path="/admin/financial-dashboard" element={<Navigate to="/admin/reports-hub?tab=snapshot" replace />} />
            <Route path="/admin/report-comparison" element={<Navigate to="/admin/reports-hub?tab=snapshot" replace />} />

            {/* Legacy redirects → hubs */}
            <Route path="/admin/branches" element={<Navigate to="/admin/catalog?tab=branches" replace />} />
            <Route path="/admin/categories" element={<Navigate to="/admin/catalog?tab=categories" replace />} />
            <Route path="/admin/pricelist" element={<Navigate to="/admin/catalog?tab=pricelist" replace />} />
            <Route path="/admin/inventory" element={<Navigate to="/admin/catalog?tab=inventory" replace />} />
            <Route path="/admin/reports" element={<Navigate to="/admin/reports-hub?tab=central" replace />} />
            <Route path="/admin/scheduled-reports" element={<Navigate to="/admin/reports-hub?tab=scheduled" replace />} />
            <Route path="/admin/audit-log" element={<Navigate to="/admin/reports-hub?tab=audit" replace />} />
            <Route path="/admin/product-attributes" element={<ProtectedRoute perm="admin_product_attributes.view" adminOnly><Navigate to="/admin/catalog?tab=attributes" replace /></ProtectedRoute>} />
            <Route path="/admin/price-audit" element={<ProtectedRoute adminOnly><PriceAuditLog /></ProtectedRoute>} />
            <Route path="/admin/vouchers" element={<Navigate to="/admin/finance?tab=vouchers" replace />} />
            <Route path="/admin/receivables" element={<Navigate to="/admin/finance?tab=receivables" replace />} />

            {/* Financial Position (Partners) */}
            <Route path="/admin/financial-position" element={<ProtectedRoute perm="admin_financial_position.view" ownerOnly><FinancialPosition /></ProtectedRoute>} />
            <Route path="/admin/financial-position/partners" element={<Navigate to="/admin/financial-position?tab=partners" replace />} />
            <Route path="/admin/financial-position/partner/:id" element={<ProtectedRoute ownerOnly><AdminPartnerProfile /></ProtectedRoute>} />
            <Route path="/admin/financial-position/transactions" element={<Navigate to="/admin/financial-position?tab=transactions" replace />} />
            <Route path="/admin/financial-position/advances" element={<Navigate to="/admin/financial-position?tab=advances" replace />} />
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
            <Route path="/admin/accounting/budgets" element={<Navigate to="/admin/reports-hub?tab=snapshot" replace />} />
            <Route path="/admin/accounting/kpis" element={<Navigate to="/admin/reports-hub?tab=snapshot" replace />} />
            <Route path="/admin/accounting/fixed-assets" element={<ProtectedRoute perm="admin_finance.view" adminOnly><FixedAssets /></ProtectedRoute>} />
            <Route path="/admin/accounting/branch-capital" element={<ProtectedRoute perm="admin_finance.view" adminOnly><BranchCapital /></ProtectedRoute>} />


            {/* Partner portal */}
            <Route path="/partner/dashboard" element={<ProtectedRoute roles={["partner"]}><PartnerDashboard /></ProtectedRoute>} />
            <Route path="/partner/ledger" element={<ProtectedRoute roles={["partner"]}><PartnerLedger /></ProtectedRoute>} />
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
            <Route path="/branch/:id/vouchers/:voucherId" element={<ProtectedRoute perm="invoices.view"><VoucherView /></ProtectedRoute>} />
            <Route path="/branch/:id/sale-returns/:returnId" element={<ProtectedRoute perm="sales.view"><SaleReturnView /></ProtectedRoute>} />
            <Route path="/branch/:id/purchase-returns/:returnId" element={<ProtectedRoute perm="shipments.view"><PurchaseReturnView /></ProtectedRoute>} />
            <Route path="/branch/:id/contacts" element={<ProtectedRoute perm="customers.view"><Contacts /></ProtectedRoute>} />
            <Route path="/branch/:id/contacts/:contactId" element={<ProtectedRoute perm="customers.view"><ContactFile /></ProtectedRoute>} />
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
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
