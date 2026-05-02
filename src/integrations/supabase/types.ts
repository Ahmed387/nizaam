export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      advance_payments: {
        Row: {
          advance_id: string
          amount: number
          id: string
          month: string
          paid_at: string
          tenant_id: string | null
        }
        Insert: {
          advance_id: string
          amount: number
          id?: string
          month: string
          paid_at?: string
          tenant_id?: string | null
        }
        Update: {
          advance_id?: string
          amount?: number
          id?: string
          month?: string
          paid_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advance_payments_advance_id_fkey"
            columns: ["advance_id"]
            isOneToOne: false
            referencedRelation: "advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_payments_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      advance_requests: {
        Row: {
          admin_decision_at: string | null
          admin_id: string | null
          admin_note: string | null
          amount: number
          branch_id: string
          branch_manager_decision_at: string | null
          branch_manager_id: string | null
          branch_manager_note: string | null
          created_at: string
          employee_id: string
          id: string
          monthly_deduct: number
          reason: string | null
          rejection_reason: string | null
          requested_by: string
          resulting_advance_id: string | null
          status: Database["public"]["Enums"]["advance_request_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          admin_decision_at?: string | null
          admin_id?: string | null
          admin_note?: string | null
          amount: number
          branch_id: string
          branch_manager_decision_at?: string | null
          branch_manager_id?: string | null
          branch_manager_note?: string | null
          created_at?: string
          employee_id: string
          id?: string
          monthly_deduct: number
          reason?: string | null
          rejection_reason?: string | null
          requested_by: string
          resulting_advance_id?: string | null
          status?: Database["public"]["Enums"]["advance_request_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_decision_at?: string | null
          admin_id?: string | null
          admin_note?: string | null
          amount?: number
          branch_id?: string
          branch_manager_decision_at?: string | null
          branch_manager_id?: string | null
          branch_manager_note?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          monthly_deduct?: number
          reason?: string | null
          rejection_reason?: string | null
          requested_by?: string
          resulting_advance_id?: string | null
          status?: Database["public"]["Enums"]["advance_request_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      advances: {
        Row: {
          amount: number
          created_at: string
          employee_id: string
          id: string
          monthly_deduct: number
          reason: string | null
          remaining: number
          tenant_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          employee_id: string
          id?: string
          monthly_deduct: number
          reason?: string | null
          remaining: number
          tenant_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          employee_id?: string
          id?: string
          monthly_deduct?: number
          reason?: string | null
          remaining?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          branch_id: string | null
          created_at: string
          details: Json | null
          entity: string
          entity_id: string | null
          id: string
          tenant_id: string | null
          user_id: string | null
          user_name: string
        }
        Insert: {
          action: string
          branch_id?: string | null
          created_at?: string
          details?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          user_name: string
        }
        Update: {
          action?: string
          branch_id?: string | null
          created_at?: string
          details?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_users: {
        Row: {
          branch_id: string
          id: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          branch_id: string
          id?: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          branch_id?: string
          id?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_users_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_users_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
          tenant_id: string | null
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          tenant_id?: string | null
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          branch_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string | null
        }
        Insert: {
          address?: string | null
          branch_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string | null
        }
        Update: {
          address?: string | null
          branch_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          base_salary: number
          branch_id: string
          created_at: string
          email: string | null
          hire_date: string
          id: string
          is_active: boolean
          job_title: string
          login_password: string | null
          name: string
          notes: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          base_salary?: number
          branch_id: string
          created_at?: string
          email?: string | null
          hire_date: string
          id?: string
          is_active?: boolean
          job_title: string
          login_password?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          base_salary?: number
          branch_id?: string
          created_at?: string
          email?: string | null
          hire_date?: string
          id?: string
          is_active?: boolean
          job_title?: string
          login_password?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          created_by: string
          date: string
          description: string | null
          id: string
          tenant_id: string | null
          type: string
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          created_by: string
          date: string
          description?: string | null
          id?: string
          tenant_id?: string | null
          type: string
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          created_by?: string
          date?: string
          description?: string | null
          id?: string
          tenant_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          cost_price: number
          id: string
          invoice_id: string
          market_price: number
          product_id: string | null
          product_name: string
          quantity: number
          selling_price: number
          tenant_id: string | null
          total: number
        }
        Insert: {
          cost_price?: number
          id?: string
          invoice_id: string
          market_price?: number
          product_id?: string | null
          product_name: string
          quantity: number
          selling_price?: number
          tenant_id?: string | null
          total?: number
        }
        Update: {
          cost_price?: number
          id?: string
          invoice_id?: string
          market_price?: number
          product_id?: string | null
          product_name?: string
          quantity?: number
          selling_price?: number
          tenant_id?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          branch_id: string
          cancel_reason: string | null
          cashier_id: string
          created_at: string
          customer_id: string | null
          discount_amount: number
          discount_percent: number
          discount_reason: string | null
          id: string
          invoice_number: string
          payment_method: string
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tenant_id: string | null
          total: number
        }
        Insert: {
          branch_id: string
          cancel_reason?: string | null
          cashier_id: string
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          discount_percent?: number
          discount_reason?: string | null
          id?: string
          invoice_number: string
          payment_method?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tenant_id?: string | null
          total?: number
        }
        Update: {
          branch_id?: string
          cancel_reason?: string | null
          cashier_id?: string
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          discount_percent?: number
          discount_reason?: string | null
          id?: string
          invoice_number?: string
          payment_method?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tenant_id?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          related_entity: string | null
          related_entity_id: string | null
          tenant_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          related_entity?: string | null
          related_entity_id?: string | null
          tenant_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          related_entity?: string | null
          related_entity_id?: string | null
          tenant_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      price_list: {
        Row: {
          category_name: string | null
          description: string | null
          id: string
          image: string | null
          market_price: number
          new_price: number
          old_price: number
          product_name: string
          sku: string | null
          source: string
          tenant_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          category_name?: string | null
          description?: string | null
          id?: string
          image?: string | null
          market_price: number
          new_price?: number
          old_price?: number
          product_name: string
          sku?: string | null
          source?: string
          tenant_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          category_name?: string | null
          description?: string | null
          id?: string
          image?: string | null
          market_price?: number
          new_price?: number
          old_price?: number
          product_name?: string
          sku?: string | null
          source?: string
          tenant_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          branch_id: string
          category_id: string | null
          cost_price: number
          created_at: string
          id: string
          image: string | null
          low_stock_alert: number
          market_price: number
          name: string
          old_price: number
          quantity: number
          selling_price: number
          sku: string
          tenant_id: string | null
        }
        Insert: {
          branch_id: string
          category_id?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          image?: string | null
          low_stock_alert?: number
          market_price?: number
          name: string
          old_price?: number
          quantity?: number
          selling_price?: number
          sku: string
          tenant_id?: string | null
        }
        Update: {
          branch_id?: string
          category_id?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          image?: string | null
          low_stock_alert?: number
          market_price?: number
          name?: string
          old_price?: number
          quantity?: number
          selling_price?: number
          sku?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string | null
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          name: string
          tenant_id?: string | null
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          id: string
          product_id: string | null
          quantity: number
          refund: number
          return_id: string
          tenant_id: string | null
        }
        Insert: {
          id?: string
          product_id?: string | null
          quantity: number
          refund: number
          return_id: string
          tenant_id?: string | null
        }
        Update: {
          id?: string
          product_id?: string | null
          quantity?: number
          refund?: number
          return_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string
          id: string
          invoice_id: string
          reason: string
          tenant_id: string | null
          total_refund: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by: string
          id?: string
          invoice_id: string
          reason: string
          tenant_id?: string | null
          total_refund: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string
          reason?: string
          tenant_id?: string | null
          total_refund?: number
        }
        Relationships: [
          {
            foreignKeyName: "returns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salaries: {
        Row: {
          advance_deduct: number
          base_salary: number
          bonuses: number
          deductions: number
          employee_id: string
          id: string
          month: string
          net_salary: number
          paid_at: string
          paid_by: string
          tenant_id: string | null
        }
        Insert: {
          advance_deduct?: number
          base_salary: number
          bonuses?: number
          deductions?: number
          employee_id: string
          id?: string
          month: string
          net_salary: number
          paid_at?: string
          paid_by: string
          tenant_id?: string | null
        }
        Update: {
          advance_deduct?: number
          base_salary?: number
          bonuses?: number
          deductions?: number
          employee_id?: string
          id?: string
          month?: string
          net_salary?: number
          paid_at?: string
          paid_by?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salaries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salaries_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          tenant_id: string | null
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          cost_price: number
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          shipment_id: string
          tenant_id: string | null
          total: number
        }
        Insert: {
          cost_price: number
          id?: string
          product_id?: string | null
          product_name: string
          quantity: number
          shipment_id: string
          tenant_id?: string | null
          total: number
        }
        Update: {
          cost_price?: number
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          shipment_id?: string
          tenant_id?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          admin_cost: number
          arrival_date: string
          branch_id: string
          created_at: string
          id: string
          notes: string | null
          received_by: string
          shipping_cost: number
          supplier_id: string
          tenant_id: string | null
          total_cost: number
        }
        Insert: {
          admin_cost?: number
          arrival_date: string
          branch_id: string
          created_at?: string
          id?: string
          notes?: string | null
          received_by: string
          shipping_cost?: number
          supplier_id: string
          tenant_id?: string | null
          total_cost?: number
        }
        Update: {
          admin_cost?: number
          arrival_date?: string
          branch_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          received_by?: string
          shipping_cost?: number
          supplier_id?: string
          tenant_id?: string | null
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "shipments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          confirmed_by: string | null
          created_at: string
          from_branch_id: string
          id: string
          product_id: string
          quantity: number
          reason: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string | null
          to_branch_id: string
          transferred_by: string
        }
        Insert: {
          confirmed_by?: string | null
          created_at?: string
          from_branch_id: string
          id?: string
          product_id: string
          quantity: number
          reason?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string | null
          to_branch_id: string
          transferred_by: string
        }
        Update: {
          confirmed_by?: string | null
          created_at?: string
          from_branch_id?: string
          id?: string
          product_id?: string
          quantity?: number
          reason?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string | null
          to_branch_id?: string
          transferred_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_branch_id_fkey"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_branch_id_fkey"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          id: string
          notes: string | null
          paid_at: string
          paid_by: string
          supplier_id: string
          tenant_id: string | null
          treasury_id: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by: string
          supplier_id: string
          tenant_id?: string | null
          treasury_id?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string
          supplier_id?: string
          tenant_id?: string | null
          treasury_id?: string | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          balance: number
          company_name: string
          contact_name: string | null
          created_at: string
          id: string
          notes: string | null
          phone: string | null
          tenant_id: string | null
        }
        Insert: {
          address?: string | null
          balance?: number
          company_name: string
          contact_name?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string | null
        }
        Update: {
          address?: string | null
          balance?: number
          company_name?: string
          contact_name?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          max_branches: number | null
          max_products: number | null
          max_users: number | null
          name: string
          plan: string
          primary_color: string | null
          slug: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          max_branches?: number | null
          max_products?: number | null
          max_users?: number | null
          name: string
          plan?: string
          primary_color?: string | null
          slug: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          max_branches?: number | null
          max_products?: number | null
          max_users?: number | null
          name?: string
          plan?: string
          primary_color?: string | null
          slug?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      treasury: {
        Row: {
          amount: number
          branch_id: string
          category: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          reference_id: string | null
          tenant_id: string | null
          type: Database["public"]["Enums"]["treasury_type"]
        }
        Insert: {
          amount: number
          branch_id: string
          category: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          reference_id?: string | null
          tenant_id?: string | null
          type: Database["public"]["Enums"]["treasury_type"]
        }
        Update: {
          amount?: number
          branch_id?: string
          category?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          tenant_id?: string | null
          type?: Database["public"]["Enums"]["treasury_type"]
        }
        Relationships: [
          {
            foreignKeyName: "treasury_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_transfers: {
        Row: {
          amount: number
          created_at: string
          from_branch_id: string
          id: string
          reason: string | null
          tenant_id: string | null
          to_branch_id: string
          transferred_by: string
        }
        Insert: {
          amount: number
          created_at?: string
          from_branch_id: string
          id?: string
          reason?: string | null
          tenant_id?: string | null
          to_branch_id: string
          transferred_by: string
        }
        Update: {
          amount?: number
          created_at?: string
          from_branch_id?: string
          id?: string
          reason?: string | null
          tenant_id?: string | null
          to_branch_id?: string
          transferred_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_transfers_from_branch_id_fkey"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_to_branch_id_fkey"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_active: { Args: never; Returns: boolean }
      current_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      next_branch_code: { Args: never; Returns: string }
      next_invoice_number: { Args: never; Returns: string }
      next_sku: { Args: never; Returns: string }
      process_sale: {
        Args: {
          p_branch_id: string
          p_customer_id: string
          p_discount_amount: number
          p_discount_percent: number
          p_discount_reason: string
          p_items: Json
          p_payment_method: string
          p_subtotal: number
          p_total: number
        }
        Returns: string
      }
      tenant_founder_admin: { Args: { _tenant_id: string }; Returns: string }
      transfer_stock_atomic: {
        Args: {
          p_from_branch: string
          p_product_id: string
          p_quantity: number
          p_reason: string
          p_to_branch: string
        }
        Returns: string
      }
      transfer_treasury_atomic: {
        Args: {
          p_amount: number
          p_from_branch: string
          p_reason: string
          p_to_branch: string
        }
        Returns: string
      }
      user_in_branch: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      advance_request_status:
        | "pending_branch_manager"
        | "pending_admin"
        | "approved"
        | "rejected"
      app_role:
        | "admin"
        | "branch_manager"
        | "cashier"
        | "warehouse"
        | "accountant"
        | "super_admin"
      invoice_status: "active" | "cancelled"
      transfer_status: "pending" | "confirmed" | "rejected"
      treasury_type: "income" | "expense"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      advance_request_status: [
        "pending_branch_manager",
        "pending_admin",
        "approved",
        "rejected",
      ],
      app_role: [
        "admin",
        "branch_manager",
        "cashier",
        "warehouse",
        "accountant",
        "super_admin",
      ],
      invoice_status: ["active", "cancelled"],
      transfer_status: ["pending", "confirmed", "rejected"],
      treasury_type: ["income", "expense"],
    },
  },
} as const
