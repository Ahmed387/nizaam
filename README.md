# NexaStore ERP

You are a senior full-stack developer and UI/UX designer. Build a complete, 
production-ready web application called **NexaStore** (نيكساستور) — a 
multi-branch store management ERP system in Arabic (RTL). Below is the full 
specification.

═══════════════════════════════════════════════════════════════
## 1. TECH STACK
═══════════════════════════════════════════════════════════════

- Frontend: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Backend: Next.js API Routes
- Database: PostgreSQL + Prisma ORM
- Auth: NextAuth.js (credentials provider)
- Image Upload: Cloudinary
- PDF Generation: React-PDF
- Charts: Recharts
- Excel Export: SheetJS
- UI: Arabic RTL, no third-party component libraries
- Deployment ready: Vercel + Supabase (PostgreSQL)

═══════════════════════════════════════════════════════════════
## 2. DESIGN SYSTEM
═══════════════════════════════════════════════════════════════

Direction: RTL (Arabic)
Font: Cairo (Google Fonts) — headers bold 700-800, body 400-500
Color Palette:
  --bg: #0f172a
  --surface: #1e293b
  --surface2: #273548
  --border: rgba(148,163,184,0.1)
  --accent: #3b82f6        /* blue */
  --accent2: #8b5cf6       /* purple */
  --success: #10b981
  --warning: #f59e0b
  --danger: #ef4444
  --text: #f1f5f9
  --muted: #94a3b8

Style:
- Dark theme throughout
- Sidebar navigation (collapsible on mobile)
- Cards with subtle borders and hover lift
- Gradient buttons (accent → accent2)
- Tables with alternating row colors
- Toast notifications for all actions
- Loading skeletons for data fetching
- All transitions: 200ms ease
- Responsive: mobile + tablet + desktop

═══════════════════════════════════════════════════════════════
## 3. DATABASE SCHEMA (Prisma)
═══════════════════════════════════════════════════════════════

model User {
  id          String   @id @default(cuid())
  name        String
  username    String   @unique
  password    String   (hashed bcrypt)
  role        Role     (ADMIN | BRANCH_MANAGER | CASHIER | 
                        WAREHOUSE | ACCOUNTANT)
  branches    BranchUser[]
  createdAt   DateTime @default(now())
  isActive    Boolean  @default(true)
}

model Branch {
  id          String   @id @default(cuid())
  name        String
  address     String
  phone       String
  code        String   @unique (auto-generated)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
}

model Category {
  id          String   @id @default(cuid())
  name        String
  parentId    String?  (for subcategories)
  parent      Category? @relation(fields: [parentId])
  children    Category[]
}

model Product {
  id            String   @id @default(cuid())
  name          String
  sku           String   @unique (auto-generated)
  categoryId    String
  image         String?  (Cloudinary URL)
  costPrice     Float    (سعر الشراء)
  sellingPrice  Float    (سعر البيع)
  marketPrice   Float    (سعر السوق من الليست)
  lowStockAlert Int      (الحد التنبيهي — set by Admin)
  branchId      String
  quantity      Int      @default(0)
  createdAt     DateTime @default(now())
}

model PriceList {
  id          String   @id @default(cuid())
  productName String
  marketPrice Float
  uploadedAt  DateTime @default(now())
  uploadedBy  String
}

model Customer {
  id        String   @id @default(cuid())
  name      String
  phone     String?
  address   String?
  branchId  String
  notes     String?
  createdAt DateTime @default(now())
}

model Supplier {
  id          String   @id @default(cuid())
  companyName String
  contactName String?
  phone       String?
  address     String?
  notes       String?
  balance     Float    @default(0) (دائن/مدين)
  createdAt   DateTime @default(now())
}

model Invoice {
  id            String        @id @default(cuid())
  invoiceNumber String        @unique (INV-2025-0001)
  branchId      String
  customerId    String?
  cashierId     String
  items         InvoiceItem[]
  subtotal      Float
  discountAmount Float        @default(0)
  discountPercent Float       @default(0)
  discountReason String?
  total         Float
  paymentMethod String        @default("cash")
  status        String        @default("active") (active | cancelled)
  cancelReason  String?
  createdAt     DateTime      @default(now())
}

model InvoiceItem {
  id         String  @id @default(cuid())
  invoiceId  String
  productId  String
  productName String (snapshot)
  quantity   Int
  costPrice  Float   (snapshot at time of sale)
  sellingPrice Float (snapshot)
  marketPrice Float  (snapshot)
  total      Float
}

model Shipment {
  id              String         @id @default(cuid())
  branchId        String
  supplierId      String
  receivedBy      String         (employee name)
  arrivalDate     DateTime
  shippingCost    Float          @default(0)
  adminCost       Float          @default(0)
  totalCost       Float
  notes           String?
  items           ShipmentItem[]
  createdAt       DateTime       @default(now())
}

model ShipmentItem {
  id         String @id @default(cuid())
  shipmentId String
  productId  String
  productName String
  quantity   Int
  costPrice  Float
  total      Float
}

model StockTransfer {
  id            String   @id @default(cuid())
  fromBranchId  String
  toBranchId    String
  productId     String
  quantity      Int
  reason        String?
  status        String   @default("pending") (pending | confirmed)
  transferredBy String
  confirmedBy   String?
  createdAt     DateTime @default(now())
}

model Treasury {
  id          String   @id @default(cuid())
  branchId    String
  type        String   (income | expense)
  category    String   (sales | salary | advance | transfer | 
                        shipping | admin | operational | other)
  amount      Float
  description String
  referenceId String?  (invoice/shipment/salary id)
  createdAt   DateTime @default(now())
  createdBy   String
}

model TreasuryTransfer {
  id            String   @id @default(cuid())
  fromBranchId  String
  toBranchId    String
  amount        Float
  reason        String?
  transferredBy String
  createdAt     DateTime @default(now())
}

model Employee {
  id           String   @id @default(cuid())
  branchId     String
  name         String
  jobTitle     String
  phone        String?
  baseSalary   Float
  hireDate     DateTime
  notes        String?
  isActive     Boolean  @default(true)
  salaries     Salary[]
  advances     Advance[]
}

model Salary {
  id           String   @id @default(cuid())
  employeeId   String
  month        String   (2025-01)
  baseSalary   Float
  deductions   Float    @default(0)
  bonuses      Float    @default(0)
  advanceDeduct Float   @default(0)
  netSalary    Float
  paidAt       DateTime @default(now())
  paidBy       String
}

model Advance {
  id           String   @id @default(cuid())
  employeeId   String
  amount       Float    (قيمة السلفة)
  remaining    Float    (المتبقي)
  monthlyDeduct Float   (خصم شهري)
  reason       String?
  createdAt    DateTime @default(now())
  payments     AdvancePayment[]
}

model AdvancePayment {
  id         String   @id @default(cuid())
  advanceId  String
  amount     Float
  month      String
  paidAt     DateTime @default(now())
}

model Expense {
  id          String   @id @default(cuid())
  branchId    String
  type        String   (operational | shipping | admin)
  amount      Float
  description String
  date        DateTime
  createdBy   String
}

model Return {
  id          String   @id @default(cuid())
  invoiceId   String
  branchId    String
  items       ReturnItem[]
  reason      String
  totalRefund Float
  createdAt   DateTime @default(now())
  createdBy   String
}

model ReturnItem {
  id        String @id @default(cuid())
  returnId  String
  productId String
  quantity  Int
  refund    Float
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String
  userName   String
  branchId   String?
  action     String   (CREATE | UPDATE | DELETE | CANCEL)
  entity     String   (Invoice | Product | Employee | ...)
  entityId   String
  details    String   (JSON snapshot of what changed)
  createdAt  DateTime @default(now())
}

═══════════════════════════════════════════════════════════════
## 4. USER ROLES & PERMISSIONS
═══════════════════════════════════════════════════════════════

ADMIN:
  ✅ Everything — all branches, all data
  ✅ Create/edit/deactivate branches
  ✅ Create/edit users and assign roles
  ✅ Set stock alert thresholds per product per branch
  ✅ Upload and manage Price List (market prices)
  ✅ View consolidated reports across all branches
  ✅ Transfer stock and money between branches
  ✅ Manage product categories

BRANCH_MANAGER:
  ✅ Their branch only
  ✅ Sales, shipments, inventory
  ✅ Manage branch employees, salaries, advances
  ✅ Branch treasury, expenses
  ✅ Register customers and suppliers
  ✅ Request stock transfer from another branch
  ✅ Cancel invoices (with reason)
  ❌ Cannot see other branches
  ❌ Cannot create users

CASHIER:
  ✅ Create invoices (sales screen only)
  ✅ Apply discount (amount or %)
  ✅ View price list reference prices
  ✅ Print invoices
  ❌ No access to financials, stock details, or employees

WAREHOUSE:
  ✅ View and manage branch stock
  ✅ Receive shipments
  ✅ Confirm incoming stock transfers
  ❌ No access to sales or financials

ACCOUNTANT:
  ✅ View all financial reports for their branch
  ✅ View treasury movements
  ✅ View supplier balances
  ❌ Cannot create transactions

═══════════════════════════════════════════════════════════════
## 5. PAGES & FEATURES (Detailed)
═══════════════════════════════════════════════════════════════

─────────────────────────────────────────
### PAGE: /login
─────────────────────────────────────────
- Arabic RTL centered card on dark bg
- Logo + "نيكساستور" title
- Username input + Password input
- "تسجيل الدخول" button (gradient)
- Error message on wrong credentials
- After login → redirect based on role:
    ADMIN → /admin/dashboard
    others → /branch/[branchId]/dashboard
- NextAuth session with JWT
- Remember session 30 days

─────────────────────────────────────────
### LAYOUT: Admin Layout
─────────────────────────────────────────
Sidebar (right side, RTL):
  Logo at top
  Navigation links:
    🏠 الرئيسية (Dashboard)
    🏪 إدارة الفروع
    👥 المستخدمين
    📂 التصنيفات
    📋 قائمة الأسعار
    📊 التقارير المركزية
    📜 سجل العمليات
    ⚙️ الإعدادات
  User info + logout at bottom

─────────────────────────────────────────
### PAGE: /admin/dashboard
─────────────────────────────────────────
Top row — 4 KPI cards:
  💰 إجمالي مبيعات اليوم (all branches combined)
  🏦 إجمالي رصيد الخزن (all branches)
  ⚠️ منتجات تحت الحد التنبيهي (count)
  📦 شحنات اليوم (count)

Second row — Branch comparison bar chart (Recharts):
  X axis: branch names
  Y axis: sales amount
  Period filter: [ يومي | أسبوعي | شهري ]

Third row:
  Left: Per-branch summary table:
    | الفرع | المبيعات | المصروفات | الربح | رصيد الخزنة |
  Right: Stock alerts list (products below threshold across all branches)

Bottom: Last 10 transactions across all branches (real-time)

─────────────────────────────────────────
### PAGE: /admin/branches
─────────────────────────────────────────
- Table of all branches:
  | الكود | الاسم | العنوان | التليفون | الحالة | تاريخ الإنشاء |
- "إضافة فرع جديد" button → modal:
    Branch name, address, phone
    Auto-generate unique code (FR-001, FR-002...)
    Submit creates branch in DB
- Edit button → same modal pre-filled
- Activate/Deactivate toggle (with confirmation)

─────────────────────────────────────────
### PAGE: /admin/users
─────────────────────────────────────────
- Table of all users:
  | الاسم | اسم المستخدم | الدور | الفروع | الحالة |
- "إضافة مستخدم" → modal:
    Full name, username, password
    Role selector (dropdown)
    Branch assignment (multi-select for manager/cashier)
    isActive toggle
- Edit → same modal
- Deactivate (never delete — just deactivate)

─────────────────────────────────────────
### PAGE: /admin/categories
─────────────────────────────────────────
- Tree view of categories (parent → children)
- Example:
    📁 أجهزة كهربائية
       └── 📺 تليفزيونات
       └── 🧺 غسالات
    📁 موبايلات
       └── 📱 أندرويد
       └── 🍎 آيفون
- Add main category
- Add subcategory under any parent
- Edit / Delete (only if no products assigned)

─────────────────────────────────────────
### PAGE: /admin/pricelist
─────────────────────────────────────────
Price List (قائمة أسعار السوق المرجعية):
- Table showing: | اسم المنتج | سعر السوق | آخر تحديث |
- Two ways to update:
  1. Manual: "إضافة منتج للليست" button → name + price
  2. Bulk Upload: Upload Excel file (.xlsx)
     Columns: اسم المنتج | سعر السوق
     System parses and upserts records
- Admin can edit any price anytime
- This list is READ-ONLY for cashiers (reference only)

─────────────────────────────────────────
### PAGE: /admin/reports
─────────────────────────────────────────
(See full reports section below — Section 6)

─────────────────────────────────────────
### PAGE: /admin/audit-log
─────────────────────────────────────────
- Full log of all system actions
- Table: | التاريخ | المستخدم | الفرع | العملية | السجل | التفاصيل |
- Filter by: user, branch, action type, date range
- Cannot be deleted or edited by anyone
- Export to PDF

─────────────────────────────────────────
### LAYOUT: Branch Layout
─────────────────────────────────────────
Sidebar (RTL):
  Branch name + logo at top
  Navigation:
    🏠 الرئيسية
    🛒 المبيعات
    📦 الشحنات
    🗄️ المخزون
    👥 العملاء
    🏭 الموردين
    💰 الخزنة
    👨‍💼 الموظفين
    📋 المصروفات
    📊 التقارير
  User info + logout at bottom

─────────────────────────────────────────
### PAGE: /branch/[id]/dashboard
─────────────────────────────────────────
KPI Row:
  💰 مبيعات اليوم
  🏦 رصيد الخزنة
  ⚠️ منتجات تحت الحد
  👥 عملاء جدد اليوم

Recent invoices table (last 5):
  | رقم الفاتورة | العميل | المبلغ | الكاشير | الوقت |

Stock alerts list:
  | المنتج | الكمية الحالية | الحد التنبيهي |
  Red badge if quantity < threshold

Today's expenses summary

─────────────────────────────────────────
### PAGE: /branch/[id]/sales/new
─────────────────────────────────────────
POS Invoice Screen:

Top bar:
  Branch name | Cashier name | Date & time (live)

Customer section:
  Search existing customer by name/phone
  OR "عميل جديد سريع" (name + phone inline)
  OR leave as "عميل نقدي"

Product search:
  Search bar (by name or SKU)
  Results show:
    Product name
    💰 سعر السوق: 15,000 جنيه    ← from price list
    🏷️ سعر البيع: 14,200 جنيه   ← your selling price
    📦 سعر الشراء: 11,000 جنيه  ← cost (manager sees, cashier hidden)
    📊 متاح: 12 قطعة
  Click product → adds to invoice items

Invoice items table:
  | المنتج | الكمية | سعر البيع | الإجمالي | حذف |
  Quantity is editable inline

Discount section:
  [ خصم بالمبلغ: ___ جنيه ]  ←→  [ نسبة الخصم: ___% ]
  Both fields linked: typing in one auto-calculates the other
  Example: type 100 جنيه → shows 10% automatically
  Example: type 15% → shows 1,500 جنيه automatically
  Reason field (optional text)

Total summary:
  الإجمالي قبل الخصم:   10,000 جنيه
  الخصم (10%):         - 1,000 جنيه
  ─────────────────────────────────
  الإجمالي النهائي:      9,000 جنيه

Actions:
  [ إلغاء ] [ 🖨️ إنشاء وطباعة الفاتورة ]

On submit:
  - Deduct quantities from branch stock
  - Add income to branch treasury
  - Save invoice with snapshot of all prices
  - Log action in AuditLog
  - Open print dialog with formatted invoice PDF

─────────────────────────────────────────
### INVOICE PRINT FORMAT
─────────────────────────────────────────
┌─────────────────────────────────────┐
│         🏪 اسم الفرع                │
│    عنوان الفرع | تليفون الفرع       │
│─────────────────────────────────────│
│ رقم الفاتورة: INV-2025-0042         │
│ التاريخ: 15 يناير 2025 | 3:45 م    │
│ الكاشير: محمد أحمد                  │
│ العميل: أحمد علي                    │
│─────────────────────────────────────│
│ المنتج    | الكمية | السعر | الإجمالي│
│ شاشة 55  |   1    | 14,200| 14,200 │
│ كيبورد   |   2    |   350 |    700 │
│─────────────────────────────────────│
│ الإجمالي قبل الخصم:     14,900 جنيه│
│ خصم (5%):             -   745 جنيه│
│ الإجمالي النهائي:       14,155 جنيه│
│─────────────────────────────────────│
│      شكراً لتعاملكم معنا 🙏         │
└─────────────────────────────────────┘

─────────────────────────────────────────
### PAGE: /branch/[id]/sales/history
─────────────────────────────────────────
Table of all invoices:
  | رقم الفاتورة | العميل | المبلغ | الخصم | الكاشير | التاريخ | الحالة |
Filter by: date range, customer, cashier, status
Actions per row:
  👁️ عرض التفاصيل
  🖨️ إعادة طباعة
  ❌ إلغاء (Manager only → modal asks for reason)
    - Cancellation returns stock to inventory
    - Adds reversal entry in treasury
    - Logged in AuditLog

─────────────────────────────────────────
### PAGE: /branch/[id]/sales/returns
─────────────────────────────────────────
- Search invoice by number or customer name
- Select invoice → shows its items
- Check which items to return + quantity
- Confirm return:
  - Stock returned to inventory automatically
  - Refund amount deducted from treasury
  - Reason required
  - Logged in AuditLog

─────────────────────────────────────────
### PAGE: /branch/[id]/shipments/new
─────────────────────────────────────────
Form fields:
  تاريخ الشحنة: [date picker]
  المورد: [searchable dropdown from suppliers list]
  المستلم: [employee name — text or dropdown]
  مصاريف الشحن: [number]
  مصاريف إدارية: [number]
  ملاحظات: [textarea]

Products received (dynamic rows):
  | اسم المنتج | الكمية | سعر الشراء | الإجمالي |
  [ + إضافة منتج ]
  Product search links to existing products catalog
  
Auto-calculated totals:
  إجمالي البضاعة:     25,000 جنيه
  مصاريف الشحن:       1,500 جنيه
  مصاريف إدارية:        500 جنيه
  ─────────────────────────────
  إجمالي الشحنة:      27,000 جنيه

On submit:
  - Add quantities to branch stock
  - Add to supplier balance (مدين)
  - Deduct from treasury (or mark as pending payment)
  - Log shipment in AuditLog

─────────────────────────────────────────
### PAGE: /branch/[id]/shipments/history
─────────────────────────────────────────
Table: | التاريخ | المورد | المستلم | الإجمالي | المصاريف |
Click row → full shipment details modal

─────────────────────────────────────────
### PAGE: /branch/[id]/inventory
─────────────────────────────────────────
Products table:
  | صورة | الكود | الاسم | التصنيف | الكمية | سعر الشراء | 
  | سعر البيع | سعر السوق | الحد التنبيهي | الحالة |
  
  Status badges:
    🟢 متوفر (quantity > threshold)
    🟡 منخفض (quantity ≤ threshold)
    🔴 نفد (quantity = 0)

Filter by: category, status, search by name/SKU

"إضافة منتج جديد" button → modal:
  Product name
  Category (parent + child selector)
  SKU (auto-generated, can override)
  Upload image (Cloudinary)
  Cost price (سعر الشراء)
  Selling price (سعر البيع)
  Market price auto-filled from PriceList if product name matches
  Low stock threshold (Admin sets this)
  Initial quantity

Stock Movements tab:
  | التاريخ | النوع | الكمية | السبب | المرجع |
  Types: بيع | شحنة واردة | نقل صادر | نقل وارد | مرتجع

Transfer Stock button → modal:
  Select destination branch
  Select product + quantity
  Reason
  Submit → creates pending transfer
  Receiving branch must confirm

─────────────────────────────────────────
### PAGE: /branch/[id]/customers
─────────────────────────────────────────
Table: | الاسم | التليفون | العنوان | عدد الفواتير | إجمالي المشتريات |
Add/Edit modal: name, phone, address, notes
Click customer → customer profile:
  All their invoices
  Total spent
  First and last purchase date

─────────────────────────────────────────
### PAGE: /branch/[id]/suppliers
─────────────────────────────────────────
Table: | الشركة | المسؤول | التليفون | الرصيد (دائن/مدين) |
Add/Edit modal: company name, contact, phone, address, notes
Click supplier → supplier profile:
  All shipments received from them
  Total amount
  Amount paid
  Remaining balance (المتبقي عليك)
  Payment history

Record Payment button:
  Amount paid to supplier
  Date
  Notes
  → Reduces supplier balance
  → Deducts from treasury

─────────────────────────────────────────
### PAGE: /branch/[id]/treasury
─────────────────────────────────────────
Header: رصيد الخزنة الحالي: 18,500 جنيه (large, prominent)

Movement tabs: [ الكل | دخول | خروج ]

Table:
  | التاريخ | النوع | الوصف | المبلغ | الرصيد التراكمي |
  Income rows: green
  Expense rows: red

Categories shown:
  💚 مبيعات | إيداع | تحويل وارد
  🔴 مصروفات | رواتب | سلف | شحن | تحويل صادر | دفع مورد

"تحويل لفرع آخر" button → modal:
  Destination branch
  Amount
  Reason
  → Deducts from current branch treasury
  → Adds to destination branch treasury
  → Logged in both branches + AuditLog

Filter by date range
Export treasury report PDF/Excel

─────────────────────────────────────────
### PAGE: /branch/[id]/employees
─────────────────────────────────────────
Employees table:
  | الاسم | الوظيفة | الراتب الأساسي | تاريخ التعيين | الحالة |
  
Add/Edit modal:
  Full name, job title, phone
  Base salary, hire date, notes

Click employee → Employee Profile:

  Tab 1: بيانات الموظف
    All basic info

  Tab 2: الرواتب
    Monthly salary history table:
      | الشهر | الراتب | خصومات | مكافآت | خصم السلفة | الصافي | تاريخ الصرف |
    "صرف راتب" button → modal:
      Month selector
      Base salary (pre-filled)
      Bonus (مكافأة)
      Deductions (خصومات)
      Advance deduction (auto-calculated from active advances)
      Net salary (auto-calculated)
      Confirm → deducts from treasury → logs payment

  Tab 3: السلف
    Active advances table:
      | التاريخ | المبلغ الأصلي | المتبقي | الخصم الشهري | الحالة |
    
    "إضافة سلفة جديدة" → modal:
      Amount (قيمة السلفة)
      Monthly deduction amount (خصم شهري)
      Reason
      Example shown:
        السلفة: 3,000 جنيه
        الخصم الشهري: 500 جنيه
        عدد الأشهر: 6 أشهر
      → Deducts from treasury immediately
      → Creates advance record with payment schedule

    Payment schedule auto-shown:
      شهر 1: يتبقى 2,500 جنيه
      شهر 2: يتبقى 2,000 جنيه
      شهر 3: يتبقى 1,500 جنيه
      ... (until cleared)

    When paying monthly salary:
      SALARY SLIP preview shows:
        الراتب الأساسي:        5,000 جنيه
        مكافآت:              +   500 جنيه
        خصومات:              -   200 جنيه
        خصم السلفة:          -   500 جنيه
        ─────────────────────────────────
        الصافي المستحق:        4,800 جنيه
        متبقي من السلفة بعد الخصم: 2,000 جنيه

─────────────────────────────────────────
### PAGE: /branch/[id]/expenses
─────────────────────────────────────────
Table: | التاريخ | النوع | الوصف | المبلغ | المسؤول |
Types:
  🏢 تشغيلية (إيجار، كهرباء، إنترنت)
  🚚 شحن ونقل
  📋 إدارية متنوعة

"إضافة مصروف" → modal:
  Type, amount, description, date, created by
  → Auto-deducted from branch treasury

Filter by type and date range
Monthly total summary at top

═══════════════════════════════════════════════════════════════
## 6. REPORTS (Full Detail)
═══════════════════════════════════════════════════════════════

All reports have:
  Period selector: [ اليوم | هذا الأسبوع | هذا الشهر | هذه السنة | مخصص ]
  Branch selector (Admin sees all, Manager sees own)
  Export buttons: [ 📄 PDF ] [ 📊 Excel ]

─────────────────────────────────────
### REPORT 1: الأرباح والخسائر
─────────────────────────────────────
💚 الإيرادات:
   إجمالي المبيعات:              85,000 جنيه
   (-) قيمة المرتجعات:          - 2,000 جنيه
   ─────────────────────────────────────────
   صافي الإيرادات:               83,000 جنيه

🔴 التكاليف:
   تكلفة البضاعة المباعة (COGS): 45,000 جنيه
   مصروفات تشغيلية:               8,000 جنيه
   مصاريف شحن ونقل:               3,000 جنيه
   رواتب الموظفين:                12,000 جنيه
   سلف موظفين مصروفة:             3,000 جنيه
   مصاريف إدارية:                 2,000 جنيه
   ─────────────────────────────────────────
   إجمالي التكاليف:               73,000 جنيه

═══════════════════════════════════════
✅ صافي الربح:                    10,000 جنيه
   نسبة الربح الصافية:              12.5%
═══════════════════════════════════════

─────────────────────────────────────
### REPORT 2: الموردين والمستحقات
─────────────────────────────────────
لكل مورد:
  إجمالي الشحنات:    45,000 جنيه
  إجمالي المدفوع:    35,000 جنيه
  ─────────────────────────────
  ⚠️ المتبقي عليك:   10,000 جنيه

ملخص كل الموردين:
  | المورد | إجمالي الشحنات | المدفوع | المتبقي |

إجمالي المستحق لكل الموردين: XX,XXX جنيه

─────────────────────────────────────
### REPORT 3: تقرير الخزنة
─────────────────────────────────────
لكل فرع:
  رصيد أول الفترة:     5,000
  (+) إجمالي الدخل:   83,000
  (-) إجمالي الخروج:  73,000
  ─────────────────────────
  الرصيد الحالي:       15,000

تفاصيل الدخل:
  مبيعات:   80,000
  تحويلات واردة: 3,000

تفاصيل الخروج:
  مصروفات:  10,000
  رواتب:    12,000
  سلف:       3,000
  دفع موردين: 35,000
  تحويلات صادرة: 13,000

─────────────────────────────────────
### REPORT 4: مقارنة الفروع
─────────────────────────────────────
Bar chart + table:

             فرع 1    فرع 2    فرع 3
المبيعات:   85,000   61,000   43,000
المصروفات:  70,000   55,000   38,000
الربح:      15,000    6,000    5,000
نسبة الربح:  17.6%    9.8%    11.6%
رصيد الخزنة: 18,000  9,000    7,500

🏆 الأكثر مبيعاً: فرع 1
💰 الأعلى ربحية: فرع 1

─────────────────────────────────────
### REPORT 5: المنتجات الأكثر مبيعاً
─────────────────────────────────────
Table:
  | المنتج | التصنيف | الكمية المباعة | الإيراد | الربح |
  Sorted by quantity or revenue
  Filter by category

─────────────────────────────────────
### REPORT 6: تقرير الرواتب
─────────────────────────────────────
Per branch, per month:
  | الموظف | الراتب الأساسي | مكافآت | خصومات | سلف | الصافي |
  Total salaries paid this month: XX,XXX جنيه
  Total advances outstanding: XX,XXX جنيه

─────────────────────────────────────
### REPORT 7: تقرير المخزون
─────────────────────────────────────
  | المنتج | الكمية | سعر الشراء | القيمة الإجمالية | الحالة |
  إجمالي قيمة المخزون: XXX,XXX جنيه
  Filter by: status (low/ok/out), category, branch

═══════════════════════════════════════════════════════════════
## 7. SYSTEM-WIDE FEATURES
═══════════════════════════════════════════════════════════════

STOCK ALERTS:
  - Every product has lowStockAlert threshold (set by Admin)
  - When quantity ≤ threshold → show warning badge on dashboard
  - Red badge counter in sidebar nav next to المخزون
  - Shown in Admin central dashboard for all branches

AUDIT LOG:
  - Every CREATE, UPDATE, DELETE, CANCEL logged automatically
  - Stores: userId, userName, branchId, action, entity, 
    entityId, JSON diff of changes, timestamp
  - No one can delete audit logs
  - Admin can filter and export

PRICE LIST REFERENCE:
  - Admin uploads market prices (Excel or manual)
  - On POS screen, cashier sees 3 prices side by side:
      سعر السوق | سعر البيع | سعر الشراء
  - Helps cashier decide discount limits
  - Price list is global (not per branch)

DISCOUNT SYSTEM (on invoice):
  - Cashier enters EITHER amount OR percentage
  - Both auto-calculate and display simultaneously
  - Example: Enter 100 جنيه → shows 10% automatically
  - Example: Enter 15% → shows 1,500 جنيه automatically
  - Both values printed on invoice

STOCK TRANSFER (between branches):
  - Branch A creates transfer request
  - Selects: destination branch, product, quantity, reason
  - Branch B (warehouse or manager) receives notification
  - Branch B confirms receipt
  - On confirmation: stock deducted from A, added to B
  - Both movements logged in StockMovements

TREASURY TRANSFER (between branches):
  - Manager/Admin initiates transfer
  - Amount + reason required
  - Auto-deducts from source treasury
  - Auto-adds to destination treasury
  - Both entries logged

RETURNS:
  - Reference original invoice
  - Select products + quantity to return
  - Stock auto-returned to inventory
  - Refund auto-added to treasury
  - Reason required, logged in AuditLog

INVOICE CANCELLATION:
  - Manager only
  - Reason required
  - Stock quantities restored
  - Treasury reversed
  - Invoice marked "ملغي" — never deleted

SALARY WITH ADVANCE DEDUCTION:
  - When paying salary, system checks active advances
  - Auto-suggests monthly deduction amount
  - Shows preview before confirming:
      الراتب الأساسي: 5,000
      مكافآت: +500
      خصومات: -200
      خصم سلفة: -500
      الصافي: 4,800
      متبقي سلفة: 2,500
  - Advance remaining balance auto-updates

═══════════════════════════════════════════════════════════════
## 8. API ROUTES STRUCTURE
═══════════════════════════════════════════════════════════════

/api/auth/[...nextauth]     ← NextAuth

/api/branches               GET, POST
/api/branches/[id]          GET, PUT, PATCH (activate/deactivate)

/api/users                  GET, POST
/api/users/[id]             GET, PUT, PATCH

/api/categories             GET, POST, PUT, DELETE

/api/pricelist              GET, POST (bulk or single)
/api/pricelist/upload       POST (Excel file → parse → upsert)

/api/products               GET, POST
/api/products/[id]          GET, PUT, DELETE
/api/products/transfer      POST (stock transfer between branches)

/api/customers              GET, POST
/api/customers/[id]         GET, PUT

/api/suppliers              GET, POST
/api/suppliers/[id]         GET, PUT
/api/suppliers/[id]/pay     POST (record payment to supplier)

/api/invoices               GET, POST
/api/invoices/[id]          GET
/api/invoices/[id]/cancel   PATCH

/api/returns                POST

/api/shipments              GET, POST
/api/shipments/[id]         GET

/api/treasury               GET (movements)
/api/treasury/transfer      POST (between branches)
/api/treasury/expense       POST

/api/employees              GET, POST
/api/employees/[id]         GET, PUT
/api/employees/[id]/salary  GET, POST
/api/employees/[id]/advance GET, POST

/api/reports/profit-loss    GET
/api/reports/suppliers      GET
/api/reports/treasury       GET
/api/reports/comparison     GET
/api/reports/products       GET
/api/reports/salaries       GET
/api/reports/inventory      GET

/api/audit-log              GET

All routes:
  - Validate session (NextAuth getServerSession)
  - Check role permissions before executing
  - Return proper HTTP status codes
  - Log mutations to AuditLog automatically

═══════════════════════════════════════════════════════════════
## 9. FOLDER STRUCTURE
═══════════════════════════════════════════════════════════════

NexaStore/
├── app/
│   ├── layout.tsx               ← Root layout (Cairo font, RTL)
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (admin)/
│   │   ├── layout.tsx           ← Admin sidebar layout
│   │   └── admin/
│   │       ├── dashboard/
│   │       ├── branches/
│   │       ├── users/
│   │       ├── categories/
│   │       ├── pricelist/
│   │       ├── reports/
│   │       └── audit-log/
│   ├── (branch)/
│   │   ├── layout.tsx           ← Branch sidebar layout
│   │   └── branch/[id]/
│   │       ├── dashboard/
│   │       ├── sales/
│   │       │   ├── new/
│   │       │   ├── history/
│   │       │   └── returns/
│   │       ├── shipments/
│   │       ├── inventory/
│   │       ├── customers/
│   │       ├── suppliers/
│   │       ├── treasury/
│   │       ├── employees/
│   │       ├── expenses/
│   │       └── reports/
│   └── api/
│       └── (all API routes above)
├── components/
│   ├── ui/                      ← Reusable: Button, Modal, Table,
│   │                               Badge, Toast, Skeleton, Card
│   ├── layout/                  ← Sidebar, Navbar, PageHeader
│   ├── forms/                   ← InvoiceForm, ShipmentForm, etc.
│   ├── charts/                  ← BranchComparisonChart, etc.
│   └── reports/                 ← Report components
├── lib/
│   ├── prisma.ts                ← Prisma client singleton
│   ├── auth.ts                  ← NextAuth config
│   ├── permissions.ts           ← Role-based access helpers
│   ├── audit.ts                 ← AuditLog helper function
│   ├── treasury.ts              ← Treasury movement helper
│   └── utils.ts                 ← Formatters (currency, date, etc.)
├── prisma/
│   └── schema.prisma
├── public/
│   └── logo.svg
├── .env.local
└── tailwind.config.ts

═══════════════════════════════════════════════════════════════
## 10. ENVIRONMENT VARIABLES
═══════════════════════════════════════════════════════════════

DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=your-secret
NEXTAUTH_URL=http://localhost:3000
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

═══════════════════════════════════════════════════════════════
## 11. SEED DATA (for testing)
═══════════════════════════════════════════════════════════════

Create:
  1 Admin user (username: admin, password: admin123)
  3 Branches (الفرع الأول، الفرع الثاني، الفرع الثالث)
  3 Branch managers (one per branch)
  1 Cashier per branch
  Main categories: أجهزة كهربائية، موبايلات، لاب توب، إكسسوارات
  5 sample products per branch with stock
  2 sample suppliers
  Sample price list entries matching product names

═══════════════════════════════════════════════════════════════
## 12. IMPLEMENTATION NOTES
═══════════════════════════════════════════════════════════════

- All text and UI labels in Arabic
- RTL layout: dir="rtl" on <html>
- Numbers and currency: format as "1,500 جنيه"
- Dates: Arabic format "15 يناير 2025"
- All modals use backdrop blur + dark overlay
- Confirm dangerous actions (delete, cancel) with modal
- Never hard delete data — use isActive/isCancelled flags
- All money calculations use 2 decimal precision
- Invoice numbers: INV-YYYY-XXXXX (auto-increment)
- SKU codes: SKU-XXXXXX (auto-generated)
- Branch codes: FR-001, FR-002, etc.
- Toast notifications for all success/error states
- Loading skeleton on all data tables
- Mobile responsive sidebar (hamburger menu on mobile)
- Session expires after 30 days of inactivity

Start by building:
  1. Database schema + migrations
  2. NextAuth setup + Login page
  3. Admin dashboard
  4. Branch dashboard
  5. Sales (POS) — most critical feature
  6. Inventory management
  7. Then remaining modules in order listed above

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://nizaam.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/375beea2-021c-4b77-bf5b-e30789ce10c0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
