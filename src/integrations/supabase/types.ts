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
      approval_requests: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          admin_id: string | null
          admin_note: string | null
          branch_id: string | null
          created_at: string
          decided_at: string | null
          entity_id: string
          entity_label: string
          entity_type: string
          id: string
          payload: Json | null
          reason: string | null
          requested_by: string
          requested_by_name: string
          status: Database["public"]["Enums"]["approval_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          admin_id?: string | null
          admin_note?: string | null
          branch_id?: string | null
          created_at?: string
          decided_at?: string | null
          entity_id: string
          entity_label: string
          entity_type: string
          id?: string
          payload?: Json | null
          reason?: string | null
          requested_by: string
          requested_by_name: string
          status?: Database["public"]["Enums"]["approval_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          admin_id?: string | null
          admin_note?: string | null
          branch_id?: string | null
          created_at?: string
          decided_at?: string | null
          entity_id?: string
          entity_label?: string
          entity_type?: string
          id?: string
          payload?: Json | null
          reason?: string | null
          requested_by?: string
          requested_by_name?: string
          status?: Database["public"]["Enums"]["approval_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      attendance: {
        Row: {
          branch_id: string
          check_in: string | null
          check_out: string | null
          created_at: string
          created_by: string | null
          date: string
          employee_id: string
          employee_name: string
          id: string
          notes: string | null
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          employee_id: string
          employee_name: string
          id?: string
          notes?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          employee_id?: string
          employee_name?: string
          id?: string
          notes?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
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
          low_balance_threshold: number
          monthly_sales_target: number
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
          low_balance_threshold?: number
          monthly_sales_target?: number
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
          low_balance_threshold?: number
          monthly_sales_target?: number
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
      contacts: {
        Row: {
          address: string | null
          balance: number
          branch_id: string | null
          contact_person: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string | null
          type: string
        }
        Insert: {
          address?: string | null
          balance?: number
          branch_id?: string | null
          contact_person?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string | null
          type?: string
        }
        Update: {
          address?: string | null
          balance?: number
          branch_id?: string | null
          contact_person?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_tenant_id_fkey"
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
          has_system_access: boolean
          hire_date: string
          id: string
          is_active: boolean
          job_title: string
          late_grace_minutes: number
          login_password: string | null
          name: string
          national_id: string | null
          national_id_back_url: string | null
          national_id_front_url: string | null
          notes: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          tenant_id: string | null
          user_id: string | null
          work_days: Json
          work_end: string | null
          work_start: string | null
        }
        Insert: {
          address?: string | null
          base_salary?: number
          branch_id: string
          created_at?: string
          email?: string | null
          has_system_access?: boolean
          hire_date: string
          id?: string
          is_active?: boolean
          job_title: string
          late_grace_minutes?: number
          login_password?: string | null
          name: string
          national_id?: string | null
          national_id_back_url?: string | null
          national_id_front_url?: string | null
          notes?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string | null
          user_id?: string | null
          work_days?: Json
          work_end?: string | null
          work_start?: string | null
        }
        Update: {
          address?: string | null
          base_salary?: number
          branch_id?: string
          created_at?: string
          email?: string | null
          has_system_access?: boolean
          hire_date?: string
          id?: string
          is_active?: boolean
          job_title?: string
          late_grace_minutes?: number
          login_password?: string | null
          name?: string
          national_id?: string | null
          national_id_back_url?: string | null
          national_id_front_url?: string | null
          notes?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string | null
          user_id?: string | null
          work_days?: Json
          work_end?: string | null
          work_start?: string | null
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
          is_fee: boolean
          payment_method: string
          reference_number: string | null
          tenant_id: string | null
          transfer_from_account: string | null
          transfer_to_account: string | null
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
          is_fee?: boolean
          payment_method?: string
          reference_number?: string | null
          tenant_id?: string | null
          transfer_from_account?: string | null
          transfer_to_account?: string | null
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
          is_fee?: boolean
          payment_method?: string
          reference_number?: string | null
          tenant_id?: string | null
          transfer_from_account?: string | null
          transfer_to_account?: string | null
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
      inventory_adjustments: {
        Row: {
          adjustment_amount: number
          created_at: string
          created_by: string
          id: string
          product_id: string
          reason: string | null
          session_id: string
        }
        Insert: {
          adjustment_amount: number
          created_at?: string
          created_by: string
          id?: string
          product_id: string
          reason?: string | null
          session_id: string
        }
        Update: {
          adjustment_amount?: number
          created_at?: string
          created_by?: string
          id?: string
          product_id?: string
          reason?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_session_items: {
        Row: {
          actual_quantity: number | null
          created_at: string
          difference: number | null
          id: string
          notes: string | null
          product_code: string
          product_id: string
          product_name: string
          reason: string | null
          session_id: string
          system_quantity: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          actual_quantity?: number | null
          created_at?: string
          difference?: number | null
          id?: string
          notes?: string | null
          product_code: string
          product_id: string
          product_name: string
          reason?: string | null
          session_id: string
          system_quantity: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          actual_quantity?: number | null
          created_at?: string
          difference?: number | null
          id?: string
          notes?: string | null
          product_code?: string
          product_id?: string
          product_name?: string
          reason?: string | null
          session_id?: string
          system_quantity?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sessions: {
        Row: {
          accountant_id: string | null
          approved_at: string | null
          approved_by: string | null
          branch_id: string
          closed_at: string | null
          counted_at: string | null
          created_at: string
          created_by: string
          id: string
          notes: string | null
          reject_reason: string | null
          reviewed_at: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          accountant_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          branch_id: string
          closed_at?: string | null
          counted_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Update: {
          accountant_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string
          closed_at?: string | null
          counted_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          cost_price: number
          id: string
          invoice_id: string
          line_discount: number
          market_price: number
          price_list_cost: number | null
          price_list_item_id: string | null
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
          line_discount?: number
          market_price?: number
          price_list_cost?: number | null
          price_list_item_id?: string | null
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
          line_discount?: number
          market_price?: number
          price_list_cost?: number | null
          price_list_item_id?: string | null
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
      invoice_payments: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          fee_amount: number
          fee_on_customer: boolean
          id: string
          invoice_id: string
          payment_method: string
          received_by_name: string | null
          reference_number: string | null
          tenant_id: string | null
          transfer_from_account: string | null
          transfer_to_account: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          fee_amount?: number
          fee_on_customer?: boolean
          id?: string
          invoice_id: string
          payment_method: string
          received_by_name?: string | null
          reference_number?: string | null
          tenant_id?: string | null
          transfer_from_account?: string | null
          transfer_to_account?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          fee_amount?: number
          fee_on_customer?: boolean
          id?: string
          invoice_id?: string
          payment_method?: string
          received_by_name?: string | null
          reference_number?: string | null
          tenant_id?: string | null
          transfer_from_account?: string | null
          transfer_to_account?: string | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          branch_id: string
          cancel_reason: string | null
          cashier_id: string
          contact_id: string | null
          created_at: string
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
          contact_id?: string | null
          created_at?: string
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
          contact_id?: string | null
          created_at?: string
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
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
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
      payment_installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          installment_number: number
          notes: string | null
          paid_amount: number
          paid_at: string | null
          payment_plan_id: string
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_plan_id: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_plan_id?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_installments_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_plans: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string
          entity_id: string
          entity_name: string
          entity_type: string
          fee_on_customer: boolean
          id: string
          notes: string | null
          paid_amount: number
          plan_type: string
          reference_id: string | null
          reference_type: string | null
          remaining_amount: number
          status: string
          tenant_id: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by: string
          entity_id: string
          entity_name: string
          entity_type: string
          fee_on_customer?: boolean
          id?: string
          notes?: string | null
          paid_amount?: number
          plan_type?: string
          reference_id?: string | null
          reference_type?: string | null
          remaining_amount?: number
          status?: string
          tenant_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string
          entity_id?: string
          entity_name?: string
          entity_type?: string
          fee_on_customer?: boolean
          id?: string
          notes?: string | null
          paid_amount?: number
          plan_type?: string
          reference_id?: string | null
          reference_type?: string | null
          remaining_amount?: number
          status?: string
          tenant_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount: number
          branch_id: string
          contact_id: string | null
          created_at: string
          created_by: string
          direction: string
          fee_amount: number
          fee_treasury_id: string | null
          fee_type: string | null
          id: string
          installment_id: string | null
          payment_method: string
          payment_plan_id: string | null
          received_by_name: string | null
          reference_number: string | null
          tenant_id: string | null
          total_with_fee: number
          transfer_from_account: string | null
          transfer_to_account: string | null
          treasury_id: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          contact_id?: string | null
          created_at?: string
          created_by: string
          direction: string
          fee_amount?: number
          fee_treasury_id?: string | null
          fee_type?: string | null
          id?: string
          installment_id?: string | null
          payment_method: string
          payment_plan_id?: string | null
          received_by_name?: string | null
          reference_number?: string | null
          tenant_id?: string | null
          total_with_fee: number
          transfer_from_account?: string | null
          transfer_to_account?: string | null
          treasury_id?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string
          direction?: string
          fee_amount?: number
          fee_treasury_id?: string | null
          fee_type?: string | null
          id?: string
          installment_id?: string | null
          payment_method?: string
          payment_plan_id?: string | null
          received_by_name?: string | null
          reference_number?: string | null
          tenant_id?: string | null
          total_with_fee?: number
          transfer_from_account?: string | null
          transfer_to_account?: string | null
          treasury_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "payment_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_order_transactions: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          created_by: string
          id: string
          payment_method: string
          pre_order_id: string
          received_by_name: string | null
          reference_number: string | null
          tenant_id: string
          transfer_from_account: string | null
          transfer_to_account: string | null
          treasury_id: string | null
          type: Database["public"]["Enums"]["pre_order_tx_type"]
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          created_by: string
          id?: string
          payment_method?: string
          pre_order_id: string
          received_by_name?: string | null
          reference_number?: string | null
          tenant_id: string
          transfer_from_account?: string | null
          transfer_to_account?: string | null
          treasury_id?: string | null
          type: Database["public"]["Enums"]["pre_order_tx_type"]
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          created_by?: string
          id?: string
          payment_method?: string
          pre_order_id?: string
          received_by_name?: string | null
          reference_number?: string | null
          tenant_id?: string
          transfer_from_account?: string | null
          transfer_to_account?: string | null
          treasury_id?: string | null
          type?: Database["public"]["Enums"]["pre_order_tx_type"]
        }
        Relationships: [
          {
            foreignKeyName: "pre_order_transactions_pre_order_id_fkey"
            columns: ["pre_order_id"]
            isOneToOne: false
            referencedRelation: "pre_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_orders: {
        Row: {
          branch_id: string
          contact_id: string | null
          created_at: string
          created_by: string
          created_by_name: string | null
          customer_name: string
          customer_phone: string | null
          deposit_amount: number
          deposit_refunded: boolean
          expected_price: number
          id: string
          invoice_id: string | null
          model_code: string | null
          notes: string | null
          order_number: string
          price_list_item_id: string | null
          product_name: string
          quantity: number
          status: Database["public"]["Enums"]["pre_order_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          contact_id?: string | null
          created_at?: string
          created_by: string
          created_by_name?: string | null
          customer_name: string
          customer_phone?: string | null
          deposit_amount?: number
          deposit_refunded?: boolean
          expected_price?: number
          id?: string
          invoice_id?: string | null
          model_code?: string | null
          notes?: string | null
          order_number?: string
          price_list_item_id?: string | null
          product_name: string
          quantity: number
          status?: Database["public"]["Enums"]["pre_order_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string
          created_by_name?: string | null
          customer_name?: string
          customer_phone?: string | null
          deposit_amount?: number
          deposit_refunded?: boolean
          expected_price?: number
          id?: string
          invoice_id?: string | null
          model_code?: string | null
          notes?: string | null
          order_number?: string
          price_list_item_id?: string | null
          product_name?: string
          quantity?: number
          status?: Database["public"]["Enums"]["pre_order_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pre_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list_items: {
        Row: {
          category: string | null
          cost_price: number
          created_at: string
          display_price: number
          id: string
          is_active: boolean
          model_code: string | null
          product_name: string
          source_id: string
          suggested_sell_price: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          cost_price?: number
          created_at?: string
          display_price?: number
          id?: string
          is_active?: boolean
          model_code?: string | null
          product_name: string
          source_id: string
          suggested_sell_price?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          cost_price?: number
          created_at?: string
          display_price?: number
          id?: string
          is_active?: boolean
          model_code?: string | null
          product_name?: string
          source_id?: string
          suggested_sell_price?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_list_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_list_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list_sources: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_updated: string | null
          supplier_name: string
          tenant_id: string
          updated_by_id: string | null
          updated_by_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_updated?: string | null
          supplier_name: string
          tenant_id: string
          updated_by_id?: string | null
          updated_by_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_updated?: string | null
          supplier_name?: string
          tenant_id?: string
          updated_by_id?: string | null
          updated_by_name?: string | null
        }
        Relationships: []
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
      purchase_return_items: {
        Row: {
          id: string
          product_id: string
          product_name: string
          purchase_return_id: string
          quantity: number
          total: number
          unit_cost: number
        }
        Insert: {
          id?: string
          product_id: string
          product_name: string
          purchase_return_id: string
          quantity: number
          total: number
          unit_cost: number
        }
        Update: {
          id?: string
          product_id?: string
          product_name?: string
          purchase_return_id?: string
          quantity?: number
          total?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_items_purchase_return_id_fkey"
            columns: ["purchase_return_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_returns: {
        Row: {
          branch_id: string
          contact_id: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          reason: string
          refund_account: string | null
          refund_balance_amount: number
          refund_cash_amount: number
          refund_method: string
          refund_reference: string | null
          refund_transfer_amount: number
          return_number: string
          shipment_id: string | null
          status: string
          tenant_id: string | null
          total_amount: number
        }
        Insert: {
          branch_id: string
          contact_id: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          reason: string
          refund_account?: string | null
          refund_balance_amount?: number
          refund_cash_amount?: number
          refund_method?: string
          refund_reference?: string | null
          refund_transfer_amount?: number
          return_number?: string
          shipment_id?: string | null
          status?: string
          tenant_id?: string | null
          total_amount?: number
        }
        Update: {
          branch_id?: string
          contact_id?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          reason?: string
          refund_account?: string | null
          refund_balance_amount?: number
          refund_cash_amount?: number
          refund_method?: string
          refund_reference?: string | null
          refund_transfer_amount?: number
          return_number?: string
          shipment_id?: string | null
          status?: string
          tenant_id?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_returns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          quote_id: string
          total: number
          unit_price: number
        }
        Insert: {
          id?: string
          product_id?: string | null
          product_name: string
          quantity: number
          quote_id: string
          total: number
          unit_price: number
        }
        Update: {
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          quote_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          branch_id: string
          contact_id: string | null
          created_at: string
          created_by: string
          customer_name: string | null
          discount: number
          id: string
          notes: string | null
          quote_number: string
          status: string
          subtotal: number
          tenant_id: string | null
          total: number
          valid_until: string | null
        }
        Insert: {
          branch_id: string
          contact_id?: string | null
          created_at?: string
          created_by: string
          customer_name?: string | null
          discount?: number
          id?: string
          notes?: string | null
          quote_number: string
          status?: string
          subtotal?: number
          tenant_id?: string | null
          total?: number
          valid_until?: string | null
        }
        Update: {
          branch_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string
          customer_name?: string | null
          discount?: number
          id?: string
          notes?: string | null
          quote_number?: string
          status?: string
          subtotal?: number
          tenant_id?: string | null
          total?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
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
          notes: string | null
          reason: string
          refund_account: string | null
          refund_balance_amount: number
          refund_cash_amount: number
          refund_method: string
          refund_reference: string | null
          refund_transfer_amount: number
          return_number: string
          status: string
          tenant_id: string | null
          total_refund: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by: string
          id?: string
          invoice_id: string
          notes?: string | null
          reason: string
          refund_account?: string | null
          refund_balance_amount?: number
          refund_cash_amount?: number
          refund_method?: string
          refund_reference?: string | null
          refund_transfer_amount?: number
          return_number?: string
          status?: string
          tenant_id?: string | null
          total_refund: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string
          notes?: string | null
          reason?: string
          refund_account?: string | null
          refund_balance_amount?: number
          refund_cash_amount?: number
          refund_method?: string
          refund_reference?: string | null
          refund_transfer_amount?: number
          return_number?: string
          status?: string
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
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          permission_key: string
          role: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_key: string
          role: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_key?: string
          role?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
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
      scheduled_reports: {
        Row: {
          created_at: string
          id: string
          period: string
          period_end: string
          period_start: string
          summary: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          period?: string
          period_end: string
          period_start: string
          summary?: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          period?: string
          period_end?: string
          period_start?: string
          summary?: Json
          tenant_id?: string
        }
        Relationships: []
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
          discount_amount: number
          discount_percent: number
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
          discount_amount?: number
          discount_percent?: number
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
          discount_amount?: number
          discount_percent?: number
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
          contact_id: string
          created_at: string
          id: string
          notes: string | null
          received_by: string
          shipment_number: string
          shipping_cost: number
          tenant_id: string | null
          total_cost: number
        }
        Insert: {
          admin_cost?: number
          arrival_date: string
          branch_id: string
          contact_id: string
          created_at?: string
          id?: string
          notes?: string | null
          received_by: string
          shipment_number?: string
          shipping_cost?: number
          tenant_id?: string | null
          total_cost?: number
        }
        Update: {
          admin_cost?: number
          arrival_date?: string
          branch_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          received_by?: string
          shipment_number?: string
          shipping_cost?: number
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
            foreignKeyName: "shipments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
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
      stock_adjustment_items: {
        Row: {
          actual_quantity: number
          adjustment_id: string
          difference: number
          id: string
          product_id: string
          product_name: string
          system_quantity: number
          unit_cost: number
        }
        Insert: {
          actual_quantity: number
          adjustment_id: string
          difference: number
          id?: string
          product_id: string
          product_name: string
          system_quantity: number
          unit_cost?: number
        }
        Update: {
          actual_quantity?: number
          adjustment_id?: string
          difference?: number
          id?: string
          product_id?: string
          product_name?: string
          system_quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_items_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjustment_number: string
          branch_id: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          reason: string
          tenant_id: string | null
        }
        Insert: {
          adjustment_number: string
          branch_id: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          reason: string
          tenant_id?: string | null
        }
        Update: {
          adjustment_number?: string
          branch_id?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          reason?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_tenant_id_fkey"
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
          group_id: string | null
          id: string
          product_id: string
          quantity: number
          reason: string | null
          received_quantity: number | null
          status: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string | null
          to_branch_id: string
          transferred_by: string
        }
        Insert: {
          confirmed_by?: string | null
          created_at?: string
          from_branch_id: string
          group_id?: string | null
          id?: string
          product_id: string
          quantity: number
          reason?: string | null
          received_quantity?: number | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string | null
          to_branch_id: string
          transferred_by: string
        }
        Update: {
          confirmed_by?: string | null
          created_at?: string
          from_branch_id?: string
          group_id?: string | null
          id?: string
          product_id?: string
          quantity?: number
          reason?: string | null
          received_quantity?: number | null
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
          contact_id: string
          created_at: string
          id: string
          notes: string | null
          paid_at: string
          paid_by: string
          tenant_id: string | null
          treasury_id: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          contact_id: string
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by: string
          tenant_id?: string | null
          treasury_id?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string
          tenant_id?: string | null
          treasury_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_suspended: boolean
          logo_url: string | null
          max_branches: number | null
          max_products: number | null
          max_users: number | null
          name: string
          plan: string
          primary_color: string | null
          slug: string
          suspended_at: string | null
          suspension_reason: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_suspended?: boolean
          logo_url?: string | null
          max_branches?: number | null
          max_products?: number | null
          max_users?: number | null
          name: string
          plan?: string
          primary_color?: string | null
          slug: string
          suspended_at?: string | null
          suspension_reason?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_suspended?: boolean
          logo_url?: string | null
          max_branches?: number | null
          max_products?: number | null
          max_users?: number | null
          name?: string
          plan?: string
          primary_color?: string | null
          slug?: string
          suspended_at?: string | null
          suspension_reason?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transfer_fees: {
        Row: {
          created_at: string
          fee_type: string
          fee_value: number
          id: string
          is_enabled: boolean
          label: string | null
          payment_method: string
          tenant_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          fee_type?: string
          fee_value?: number
          id?: string
          is_enabled?: boolean
          label?: string | null
          payment_method: string
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          fee_type?: string
          fee_value?: number
          id?: string
          is_enabled?: boolean
          label?: string | null
          payment_method?: string
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
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
          is_fee: boolean
          payment_method: string
          reference_id: string | null
          reference_number: string | null
          tenant_id: string | null
          transfer_from_account: string | null
          transfer_to_account: string | null
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
          is_fee?: boolean
          payment_method?: string
          reference_id?: string | null
          reference_number?: string | null
          tenant_id?: string | null
          transfer_from_account?: string | null
          transfer_to_account?: string | null
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
          is_fee?: boolean
          payment_method?: string
          reference_id?: string | null
          reference_number?: string | null
          tenant_id?: string | null
          transfer_from_account?: string | null
          transfer_to_account?: string | null
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
          acknowledged_at: string | null
          acknowledged_by: string | null
          amount: number
          created_at: string
          fee_actually_charged: boolean
          fee_amount: number
          from_branch_id: string
          id: string
          payment_method: string | null
          reason: string | null
          received_by: string | null
          reference_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          tenant_id: string | null
          to_branch_id: string
          transfer_to_account: string | null
          transferred_by: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amount: number
          created_at?: string
          fee_actually_charged?: boolean
          fee_amount?: number
          from_branch_id: string
          id?: string
          payment_method?: string | null
          reason?: string | null
          received_by?: string | null
          reference_number?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          tenant_id?: string | null
          to_branch_id: string
          transfer_to_account?: string | null
          transferred_by: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amount?: number
          created_at?: string
          fee_actually_charged?: boolean
          fee_amount?: number
          from_branch_id?: string
          id?: string
          payment_method?: string | null
          reason?: string | null
          received_by?: string | null
          reference_number?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          tenant_id?: string | null
          to_branch_id?: string
          transfer_to_account?: string | null
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
      user_presence: {
        Row: {
          last_login_at: string | null
          last_seen_at: string
          tenant_id: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          last_login_at?: string | null
          last_seen_at?: string
          tenant_id: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          last_login_at?: string | null
          last_seen_at?: string
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
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
      voucher_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          parent_id: string | null
          system_key: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["voucher_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          parent_id?: string | null
          system_key?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["voucher_type"]
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          parent_id?: string | null
          system_key?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["voucher_type"]
        }
        Relationships: [
          {
            foreignKeyName: "voucher_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "voucher_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_sequences: {
        Row: {
          last_number: number
          tenant_id: string
          type: Database["public"]["Enums"]["voucher_type"]
        }
        Insert: {
          last_number?: number
          tenant_id: string
          type: Database["public"]["Enums"]["voucher_type"]
        }
        Update: {
          last_number?: number
          tenant_id?: string
          type?: Database["public"]["Enums"]["voucher_type"]
        }
        Relationships: [
          {
            foreignKeyName: "voucher_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          amount: number
          branch_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category_id: string
          created_at: string
          created_by: string
          created_by_name: string | null
          description: string | null
          fee_amount: number
          id: string
          party_id: string | null
          party_name: string | null
          party_type: Database["public"]["Enums"]["voucher_party_type"] | null
          payment_method: string
          reference_number: string | null
          source: Database["public"]["Enums"]["voucher_source"]
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["voucher_status"]
          tenant_id: string
          transferred_from: string | null
          transferred_to: string | null
          treasury_id: string | null
          type: Database["public"]["Enums"]["voucher_type"]
          voucher_date: string
          voucher_number: string
        }
        Insert: {
          amount: number
          branch_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id: string
          created_at?: string
          created_by: string
          created_by_name?: string | null
          description?: string | null
          fee_amount?: number
          id?: string
          party_id?: string | null
          party_name?: string | null
          party_type?: Database["public"]["Enums"]["voucher_party_type"] | null
          payment_method: string
          reference_number?: string | null
          source: Database["public"]["Enums"]["voucher_source"]
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["voucher_status"]
          tenant_id: string
          transferred_from?: string | null
          transferred_to?: string | null
          treasury_id?: string | null
          type: Database["public"]["Enums"]["voucher_type"]
          voucher_date?: string
          voucher_number: string
        }
        Update: {
          amount?: number
          branch_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string
          created_at?: string
          created_by?: string
          created_by_name?: string | null
          description?: string | null
          fee_amount?: number
          id?: string
          party_id?: string | null
          party_name?: string | null
          party_type?: Database["public"]["Enums"]["voucher_party_type"] | null
          payment_method?: string
          reference_number?: string | null
          source?: Database["public"]["Enums"]["voucher_source"]
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["voucher_status"]
          tenant_id?: string
          transferred_from?: string | null
          transferred_to?: string | null
          treasury_id?: string | null
          type?: Database["public"]["Enums"]["voucher_type"]
          voucher_date?: string
          voucher_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "voucher_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      price_list_items_public: {
        Row: {
          category: string | null
          display_price: number | null
          id: string | null
          is_active: boolean | null
          model_code: string | null
          product_name: string | null
          source_id: string | null
          supplier_name: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "price_list_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_treasury_balances: {
        Row: {
          balance: number | null
          branch_id: string | null
          payment_method: string | null
          tenant_id: string | null
          total_in: number | null
          total_out: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acknowledge_treasury_transfer: {
        Args: { p_transfer_id: string }
        Returns: undefined
      }
      admin_reset_branch_data: {
        Args: { p_branch_id: string; p_options: Json }
        Returns: Json
      }
      apply_price_list_update: {
        Args: { p_items: Json; p_source_id: string }
        Returns: Json
      }
      apply_supplier_credit: {
        Args: {
          p_branch_id: string
          p_contact_id: string
          p_payment_plan_id: string
        }
        Returns: number
      }
      approve_advance_request: {
        Args: { p_decision: string; p_note?: string; p_request_id: string }
        Returns: Json
      }
      approve_inventory_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      calculate_payment_fee: {
        Args: { p_amount: number; p_method: string }
        Returns: number
      }
      can_manage_attendance_for: {
        Args: { _target_employee_id: string }
        Returns: boolean
      }
      cancel_pre_order: {
        Args: { p_pre_order_id: string; p_refund: boolean }
        Returns: undefined
      }
      cancel_voucher: {
        Args: { p_reason: string; p_voucher_id: string }
        Returns: undefined
      }
      complete_pre_order_sale: {
        Args: { p_payment_method?: string; p_pre_order_id: string }
        Returns: string
      }
      confirm_transfer_group: { Args: { p_group: string }; Returns: number }
      contact_balance_apply: {
        Args: { _contact: string; _delta: number }
        Returns: undefined
      }
      create_inventory_session: {
        Args: { p_branch_id: string; p_notes?: string }
        Returns: string
      }
      create_manual_voucher:
        | {
            Args: {
              p_amount: number
              p_branch_id: string
              p_category_id: string
              p_description?: string
              p_fee_amount?: number
              p_party_id?: string
              p_party_name?: string
              p_party_type?: Database["public"]["Enums"]["voucher_party_type"]
              p_payment_method: string
              p_reference_number?: string
              p_transferred_to?: string
              p_type: Database["public"]["Enums"]["voucher_type"]
              p_voucher_date?: string
            }
            Returns: string
          }
        | {
            Args: {
              p_amount: number
              p_branch_id: string
              p_category_id: string
              p_description?: string
              p_fee_amount?: number
              p_party_id?: string
              p_party_name?: string
              p_party_type?: Database["public"]["Enums"]["voucher_party_type"]
              p_payment_method: string
              p_reference_number?: string
              p_transferred_from?: string
              p_transferred_to?: string
              p_type: Database["public"]["Enums"]["voucher_type"]
              p_voucher_date?: string
            }
            Returns: string
          }
      create_pre_order:
        | {
            Args: {
              p_branch_id: string
              p_customer_id: string
              p_customer_name: string
              p_customer_phone: string
              p_deposit_amount: number
              p_expected_price: number
              p_model_code: string
              p_notes: string
              p_payment_method: string
              p_price_list_item_id: string
              p_product_name: string
              p_quantity: number
            }
            Returns: string
          }
        | {
            Args: {
              p_branch_id: string
              p_customer_id: string
              p_customer_name: string
              p_customer_phone: string
              p_deposit_amount: number
              p_expected_price: number
              p_model_code: string
              p_notes: string
              p_payment_method: string
              p_price_list_item_id: string
              p_product_name: string
              p_quantity: number
              p_received_by_name?: string
              p_reference_number?: string
              p_transfer_to_account?: string
            }
            Returns: string
          }
      current_tenant_active: { Args: never; Returns: boolean }
      current_tenant_id: { Args: never; Returns: string }
      current_tenant_is_suspended: { Args: never; Returns: boolean }
      disburse_pending_advance: {
        Args: { p_request_id: string }
        Returns: string
      }
      edit_invoice: {
        Args: { _customer_id: string; _invoice_id: string; _items: Json }
        Returns: undefined
      }
      edit_shipment: {
        Args: { p_header: Json; p_items: Json; p_shipment_id: string }
        Returns: Json
      }
      get_branch_wallet_balances: {
        Args: { p_branch_id: string }
        Returns: {
          bank_balance: number
          cash_balance: number
          instapay_balance: number
          total_balance: number
          vodafone_balance: number
        }[]
      }
      get_system_category: {
        Args: {
          _key: string
          _tenant: string
          _type: Database["public"]["Enums"]["voucher_type"]
        }
        Returns: string
      }
      hard_delete_invoice: { Args: { _invoice_id: string }; Returns: undefined }
      has_permission: {
        Args: { _key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      historical_stock_at: {
        Args: { _as_of: string; _branch_id: string }
        Returns: {
          name: string
          product_id: string
          quantity_at_date: number
          sku: string
        }[]
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      map_treasury_to_category_key: {
        Args: { _t: Database["public"]["Tables"]["treasury"]["Row"] }
        Returns: string
      }
      mark_overdue_installments: { Args: never; Returns: number }
      next_branch_code: { Args: never; Returns: string }
      next_invoice_number: { Args: never; Returns: string }
      next_pre_order_number: { Args: never; Returns: string }
      next_purchase_return_number: { Args: never; Returns: string }
      next_sale_return_number: { Args: never; Returns: string }
      next_shipment_number: { Args: never; Returns: string }
      next_sku: { Args: never; Returns: string }
      next_voucher_number: {
        Args: {
          _tenant: string
          _type: Database["public"]["Enums"]["voucher_type"]
        }
        Returns: string
      }
      partial_confirm_transfer: {
        Args: { p_received: number; p_transfer_id: string }
        Returns: Json
      }
      payment_plans_summary: {
        Args: { p_tenant_id: string }
        Returns: {
          due_this_month: number
          due_this_week: number
          entity_type: string
          overdue_amount: number
          plans_count: number
          total_owed: number
        }[]
      }
      process_sale: {
        Args: {
          p_branch_id: string
          p_customer_id: string
          p_discount_amount: number
          p_discount_percent: number
          p_discount_reason: string
          p_items: Json
          p_payment_method: string
          p_payments?: Json
          p_subtotal: number
          p_total: number
        }
        Returns: string
      }
      record_contact_payment: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_contact_id: string
          p_direction: string
          p_fee_amount: number
          p_fee_on_customer: boolean
          p_fee_type: string
          p_notes?: string
          p_payment_method: string
          p_received_by_name: string
          p_reference_number: string
          p_transfer_from_account?: string
          p_transfer_to_account: string
        }
        Returns: string
      }
      record_payment_transaction: {
        Args: {
          p_amount: number
          p_direction: string
          p_fee_amount: number
          p_fee_on_customer: boolean
          p_fee_type: string
          p_installment_id: string
          p_payment_method: string
          p_payment_plan_id: string
          p_received_by_name: string
          p_reference_number: string
          p_transfer_from_account?: string
          p_transfer_to_account: string
        }
        Returns: string
      }
      reject_transfer_group: { Args: { p_group: string }; Returns: number }
      reject_treasury_transfer: {
        Args: { p_reason: string; p_transfer_id: string }
        Returns: undefined
      }
      seed_voucher_categories: { Args: { _tenant: string }; Returns: undefined }
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
      transfer_stock_multi_atomic: {
        Args: {
          p_from_branch: string
          p_items: Json
          p_reason: string
          p_to_branch: string
        }
        Returns: string
      }
      transfer_treasury_atomic:
        | {
            Args: {
              p_amount: number
              p_fee_amount?: number
              p_from_branch: string
              p_payment_method?: string
              p_reason: string
              p_reference_number?: string
              p_to_branch: string
              p_transfer_to_account?: string
            }
            Returns: string
          }
        | {
            Args: {
              p_amount: number
              p_fee_actually_charged?: boolean
              p_fee_amount?: number
              p_from_branch: string
              p_payment_method?: string
              p_reason: string
              p_reference_number?: string
              p_to_branch: string
              p_transfer_to_account?: string
            }
            Returns: string
          }
      user_in_branch: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      verify_employee_password: {
        Args: { _employee_id: string; _password: string }
        Returns: boolean
      }
    }
    Enums: {
      advance_request_status:
        | "pending_branch_manager"
        | "pending_admin"
        | "approved"
        | "rejected"
        | "approved_pending_funds"
      app_role:
        | "admin"
        | "branch_manager"
        | "cashier"
        | "warehouse"
        | "accountant"
        | "super_admin"
        | "viewer"
        | "supervisor"
        | "worker"
        | "driver"
      approval_action: "delete" | "update"
      approval_status: "pending" | "approved" | "rejected"
      invoice_status: "active" | "cancelled"
      pre_order_status: "pending" | "received" | "completed" | "cancelled"
      pre_order_tx_type:
        | "deposit_received"
        | "deposit_refunded"
        | "final_payment"
      transfer_status: "pending" | "confirmed" | "rejected"
      treasury_type: "income" | "expense"
      voucher_party_type: "customer" | "supplier" | "employee" | "other"
      voucher_source: "manual" | "system"
      voucher_status: "active" | "cancelled"
      voucher_type: "receipt" | "payment"
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
        "approved_pending_funds",
      ],
      app_role: [
        "admin",
        "branch_manager",
        "cashier",
        "warehouse",
        "accountant",
        "super_admin",
        "viewer",
        "supervisor",
        "worker",
        "driver",
      ],
      approval_action: ["delete", "update"],
      approval_status: ["pending", "approved", "rejected"],
      invoice_status: ["active", "cancelled"],
      pre_order_status: ["pending", "received", "completed", "cancelled"],
      pre_order_tx_type: [
        "deposit_received",
        "deposit_refunded",
        "final_payment",
      ],
      transfer_status: ["pending", "confirmed", "rejected"],
      treasury_type: ["income", "expense"],
      voucher_party_type: ["customer", "supplier", "employee", "other"],
      voucher_source: ["manual", "system"],
      voucher_status: ["active", "cancelled"],
      voucher_type: ["receipt", "payment"],
    },
  },
} as const
