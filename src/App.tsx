import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Setup from "./pages/Setup";
import Signup from "./pages/Signup";
import Landing from "./pages/Landing";

import AdminDashboard from "./pages/admin/Dashboard";
import Branches from "./pages/admin/Branches";

import Categories from "./pages/admin/Categories";
import PriceList from "./pages/admin/PriceList";
import AllInventory from "./pages/admin/AllInventory";
import AllSuppliers from "./pages/admin/AllSuppliers";
import AllEmployees from "./pages/admin/AllEmployees";
import EmployeeProfile from "./pages/admin/EmployeeProfile";
import AuditLog from "./pages/admin/AuditLog";

import BranchDashboard from "./pages/branch/Dashboard";
import NewSale from "./pages/branch/NewSale";
import SalesHistory from "./pages/branch/SalesHistory";
import InvoiceView from "./pages/branch/InvoiceView";
import Inventory from "./pages/branch/Inventory";
import StockMovements from "./pages/branch/StockMovements";
import PrintBarcodes from "./pages/branch/PrintBarcodes";
import Customers from "./pages/branch/Customers";
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
import Expenses from "./pages/branch/Expenses";
import BranchReports from "./pages/branch/Reports";
import AdminReports from "./pages/admin/Reports";
import StockTransfers from "./pages/branch/StockTransfers";
import Settings from "./pages/admin/Settings";
import SeedData from "./pages/admin/SeedData";
import { AdminPlaceholder, BranchPlaceholder } from "./pages/Placeholder";

import SuperDashboard from "./pages/super/Dashboard";
import SuperTenants from "./pages/super/Tenants";
import SuperUsers from "./pages/super/AllUsers";

const queryClient = new QueryClient();

const App = () => (
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

            {/* Super Admin */}
            <Route path="/super/dashboard" element={<ProtectedRoute superAdminOnly><SuperDashboard /></ProtectedRoute>} />
            <Route path="/super/tenants" element={<ProtectedRoute superAdminOnly><SuperTenants /></ProtectedRoute>} />
            <Route path="/super/users" element={<ProtectedRoute superAdminOnly><SuperUsers /></ProtectedRoute>} />

            {/* Admin */}
            <Route path="/admin/dashboard" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/branches" element={<ProtectedRoute adminOnly><Branches /></ProtectedRoute>} />
            
            <Route path="/admin/categories" element={<ProtectedRoute adminOnly><Categories /></ProtectedRoute>} />
            <Route path="/admin/pricelist" element={<ProtectedRoute adminOnly><PriceList /></ProtectedRoute>} />
            <Route path="/admin/inventory" element={<ProtectedRoute adminOnly><AllInventory /></ProtectedRoute>} />
            <Route path="/admin/reports" element={<ProtectedRoute adminOnly><AdminReports /></ProtectedRoute>} />
            <Route path="/admin/suppliers" element={<ProtectedRoute adminOnly><AllSuppliers /></ProtectedRoute>} />
            <Route path="/admin/suppliers/:supplierId" element={<ProtectedRoute adminOnly><SupplierProfile /></ProtectedRoute>} />
            <Route path="/admin/employees" element={<ProtectedRoute adminOnly><AllEmployees /></ProtectedRoute>} />
            <Route path="/admin/employees/:id" element={<ProtectedRoute adminOnly><EmployeeProfile /></ProtectedRoute>} />
            <Route path="/admin/audit-log" element={<ProtectedRoute adminOnly><AuditLog /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
            <Route path="/admin/seed" element={<ProtectedRoute adminOnly><SeedData /></ProtectedRoute>} />

            {/* Branch */}
            <Route path="/branch/:id/dashboard" element={<ProtectedRoute><BranchDashboard /></ProtectedRoute>} />
            <Route path="/branch/:id/sales" element={<ProtectedRoute><SalesHistory /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/new" element={<ProtectedRoute><NewSale /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/returns" element={<ProtectedRoute><Returns /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/returns/new" element={<ProtectedRoute><NewReturn /></ProtectedRoute>} />
            <Route path="/branch/:id/sales/:invoiceId" element={<ProtectedRoute><InvoiceView /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments" element={<ProtectedRoute><Shipments /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments/new" element={<ProtectedRoute><NewShipment /></ProtectedRoute>} />
            <Route path="/branch/:id/shipments/:shipmentId" element={<ProtectedRoute><ShipmentView /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory/barcodes" element={<ProtectedRoute><PrintBarcodes /></ProtectedRoute>} />
            <Route path="/branch/:id/inventory/:productId/movements" element={<ProtectedRoute><StockMovements /></ProtectedRoute>} />
            <Route path="/branch/:id/transfers" element={<ProtectedRoute><StockTransfers /></ProtectedRoute>} />
            <Route path="/branch/:id/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
            <Route path="/branch/:id/customers/:customerId" element={<ProtectedRoute><CustomerProfile /></ProtectedRoute>} />
            <Route path="/branch/:id/suppliers" element={<ProtectedRoute><Suppliers /></ProtectedRoute>} />
            <Route path="/branch/:id/suppliers/:supplierId" element={<ProtectedRoute><SupplierProfile /></ProtectedRoute>} />
            <Route path="/branch/:id/treasury" element={<ProtectedRoute><Treasury /></ProtectedRoute>} />
            <Route path="/branch/:id/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
            <Route path="/branch/:id/advance-requests" element={<ProtectedRoute><AdvanceRequests /></ProtectedRoute>} />
            <Route path="/branch/:id/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
            <Route path="/branch/:id/reports" element={<ProtectedRoute><BranchReports /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
