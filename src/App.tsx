import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";

function RedirectToTreasury() {
  const { id } = useParams();
  return <Navigate to={`/branch/${id}/treasury`} replace />;
}

import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Setup from "./pages/Setup";
import Signup from "./pages/Signup";
import Landing from "./pages/Landing";
import Profile from "./pages/Profile";
import Suspended from "./pages/Suspended";
import InstallApp from "./pages/InstallApp";

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

import BranchDashboard from "./pages/branch/Dashboard";
import NewSale from "./pages/branch/NewSale";
import PreOrders from "./pages/branch/PreOrders";
import SalesHistory from "./pages/branch/SalesHistory";
import InvoiceView from "./pages/branch/InvoiceView";
import Inventory from "./pages/branch/Inventory";
import StockMovements from "./pages/branch/StockMovements";
import PrintBarcodes from "./pages/branch/PrintBarcodes";
import Customers from "./pages/branch/Customers";
import Contacts from "./pages/branch/Contacts";
import CustomerProfile from "./pages/branch/CustomerProfile";
import Suppliers from "./pages/branch/Suppliers";
import SupplierProfile from "./pages/branch/SupplierProfile";
import Treasury from "./pages/branch/Treasury";
import Employees from "./pages/branch/Employees";
import AdvanceRequests from "./pages/branch/AdvanceRequests";
import Shipments from "./pages/branch/Shipments";
import NewShipment from "./pages/branch/NewShipment";
import ShipmentView from "./pages/branch/ShipmentView";
import Returns from "./pages/branch/Returns";
import NewReturn from "./pages/branch/NewReturn";

import BranchReports from "./pages/branch/Reports";
import AdminReports from "./pages/admin/Reports";
import StockTransfers from "./pages/branch/StockTransfers";
import Settings from "./pages/admin/Settings";
import SeedData from "./pages/admin/SeedData";
import ScheduledReports from "./pages/admin/ScheduledReports";
import AllAttendance from "./pages/admin/AllAttendance";
import Attendance from "./pages/branch/Attendance";
import Receivables from "./pages/admin/Receivables";
import { AdminPlaceholder, BranchPlaceholder } from "./pages/Placeholder";
import Invoices from "./pages/branch/Invoices";
import NewPurchaseReturn from "./pages/branch/NewPurchaseReturn";
import NewQuote from "./pages/branch/NewQuote";
import NewStockAdjustment from "./pages/branch/NewStockAdjustment";
import PaymentVouchers from "./pages/branch/PaymentVouchers";
import ReceiptVouchers from "./pages/branch/ReceiptVouchers";
import AllVouchers from "./pages/admin/AllVouchers";

import SuperDashboard from "./pages/super/Dashboard";
import SuperTenants from "./pages/super/Tenants";
import SuperUsers from "./pages/super/AllUsers";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner position="top-center" dir="rtl" />
        <BrowserRouter>
          <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/welcome" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/suspended" element={<Suspended />} />
            <Route path="/install" element={<InstallApp />} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

            {/* Super Admin */}
            <Route path="/super/dashboard" element={<ProtectedRoute superAdminOnly><SuperDashboard /></ProtectedRoute>} />
            <Route path="/super/tenants" element={<ProtectedRoute superAdminOnly><SuperTenants /></ProtectedRoute>} />
            <Route path="/super/users" element={<ProtectedRoute superAdminOnly><SuperUsers /></ProtectedRoute>} />

            {/* Admin */}
            <Route path="/admin/dashboard" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/branches" element={<ProtectedRoute adminOnly><Branches /></ProtectedRoute>} />
            <Route path="/admin/branches/:id" element={<ProtectedRoute adminOnly><BranchProfile /></ProtectedRoute>} />
            
            <Route path="/admin/categories" element={<ProtectedRoute adminOnly><Categories /></ProtectedRoute>} />
            <Route path="/admin/pricelist" element={<ProtectedRoute adminOnly><PriceList /></ProtectedRoute>} />
            <Route path="/admin/pre-orders" element={<ProtectedRoute adminOnly><AllPreOrders /></ProtectedRoute>} />
            
            <Route path="/admin/inventory" element={<ProtectedRoute adminOnly><AllInventory /></ProtectedRoute>} />
            <Route path="/admin/reports" element={<ProtectedRoute adminOnly><AdminReports /></ProtectedRoute>} />
            <Route path="/admin/suppliers" element={<ProtectedRoute adminOnly><AllSuppliers /></ProtectedRoute>} />
            <Route path="/admin/suppliers/:supplierId" element={<ProtectedRoute adminOnly><SupplierProfile /></ProtectedRoute>} />
            <Route path="/admin/employees" element={<ProtectedRoute roles={["supervisor"]}><AllEmployees /></ProtectedRoute>} />
            <Route path="/admin/employees/:id" element={<ProtectedRoute roles={["supervisor"]}><EmployeeProfile /></ProtectedRoute>} />
            <Route path="/admin/audit-log" element={<ProtectedRoute adminOnly><AuditLog /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
            <Route path="/admin/seed" element={<ProtectedRoute adminOnly><SeedData /></ProtectedRoute>} />
            <Route path="/admin/scheduled-reports" element={<ProtectedRoute adminOnly><ScheduledReports /></ProtectedRoute>} />
            <Route path="/admin/attendance" element={<ProtectedRoute roles={["supervisor"]}><AllAttendance /></ProtectedRoute>} />
            <Route path="/admin/receivables" element={<ProtectedRoute adminOnly><Receivables /></ProtectedRoute>} />

            {/* Branch */}
            <Route path="/admin/vouchers" element={<ProtectedRoute adminOnly><AllVouchers /></ProtectedRoute>} />

            {/* Branch */}
            <Route path="/branch/:id/dashboard" element={<ProtectedRoute><BranchDashboard /></ProtectedRoute>} />
            <Route path="/branch/:id/payment-vouchers" element={<RedirectToTreasury />} />
            <Route path="/branch/:id/receipt-vouchers" element={<RedirectToTreasury />} />

            <Route path="/branch/:id/sales" element={<ProtectedRoute><SalesHistory /></ProtectedRoute>} />
            <Route path="/branch/:id/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
            <Route path="/branch/:id/purchase-returns/new" element={<ProtectedRoute roles={["branch_manager","warehouse","accountant"]}><NewPurchaseReturn /></ProtectedRoute>} />
            <Route path="/branch/:id/quotes/new" element={<ProtectedRoute roles={["branch_manager","cashier","accountant"]}><NewQuote /></ProtectedRoute>} />
            <Route path="/branch/:id/adjustments/new" element={<ProtectedRoute roles={["branch_manager","warehouse"]}><NewStockAdjustment /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/new" element={<ProtectedRoute roles={["branch_manager","cashier"]}><NewSale /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/returns" element={<ProtectedRoute roles={["branch_manager","cashier","accountant"]}><Returns /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/returns/new" element={<ProtectedRoute roles={["branch_manager","cashier"]}><NewReturn /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/:invoiceId" element={<ProtectedRoute><InvoiceView /></ProtectedRoute>} />
            <Route path="/branch/:id/pre-orders" element={<ProtectedRoute roles={["branch_manager","cashier","warehouse","accountant"]}><PreOrders /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments" element={<ProtectedRoute roles={["branch_manager","warehouse","accountant"]}><Shipments /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments/new" element={<ProtectedRoute roles={["branch_manager","warehouse"]}><NewShipment /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments/:shipmentId" element={<ProtectedRoute roles={["branch_manager","warehouse","accountant"]}><ShipmentView /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory/barcodes" element={<ProtectedRoute roles={["branch_manager","warehouse"]}><PrintBarcodes /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory/:productId/movements" element={<ProtectedRoute roles={["branch_manager","warehouse","accountant"]}><StockMovements /></ProtectedRoute>} />
            <Route path="/branch/:id/transfers" element={<ProtectedRoute roles={["branch_manager","warehouse"]}><StockTransfers /></ProtectedRoute>} />
            <Route path="/branch/:id/contacts" element={<ProtectedRoute roles={["branch_manager","cashier","warehouse","accountant"]}><Contacts /></ProtectedRoute>} />
            <Route path="/branch/:id/customers" element={<Navigate to="../contacts?tab=customers" replace />} />
            <Route path="/branch/:id/customers/:customerId" element={<ProtectedRoute><CustomerProfile /></ProtectedRoute>} />
            <Route path="/branch/:id/suppliers" element={<Navigate to="../contacts?tab=suppliers" replace />} />
            <Route path="/branch/:id/suppliers/:supplierId" element={<ProtectedRoute roles={["branch_manager","warehouse","accountant"]}><SupplierProfile /></ProtectedRoute>} />
            <Route path="/branch/:id/employees" element={<ProtectedRoute roles={["branch_manager"]}><Employees /></ProtectedRoute>} />
            <Route path="/branch/:id/advance-requests" element={<ProtectedRoute roles={["branch_manager"]}><AdvanceRequests /></ProtectedRoute>} />
            
            <Route path="/branch/:id/reports" element={<ProtectedRoute roles={["branch_manager","accountant"]}><BranchReports /></ProtectedRoute>} />
            <Route path="/branch/:id/attendance" element={<ProtectedRoute roles={["branch_manager","cashier","accountant"]}><Attendance /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
