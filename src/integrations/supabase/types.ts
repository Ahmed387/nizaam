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
      attachments: {
        Row: {
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          original_size: number | null
          record_id: string
          record_type: string
          tenant_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          original_size?: number | null
          record_id: string
          record_type: string
          tenant_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          original_size?: number | null
          record_id?: string
          record_type?: string
          tenant_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      bank_accounts: {
        Row: {
          account_number: string | null
          bank_name: string | null
          created_at: string
          currency: string
          gl_account_id: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          opening_balance: number
          opening_date: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          currency?: string
          gl_account_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          opening_date?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          currency?: string
          gl_account_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          opening_date?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          bank_account_id: string
          created_at: string
          credit: number
          debit: number
          description: string | null
          id: string
          is_matched: boolean
          matched_at: string | null
          matched_by: string | null
          matched_journal_line_id: string | null
          notes: string | null
          reference: string | null
          statement_id: string
          txn_date: string
          updated_at: string
        }
        Insert: {
          bank_account_id: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          is_matched?: boolean
          matched_at?: string | null
          matched_by?: string | null
          matched_journal_line_id?: string | null
          notes?: string | null
          reference?: string | null
          statement_id: string
          txn_date: string
          updated_at?: string
        }
        Update: {
          bank_account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          is_matched?: boolean
          matched_at?: string | null
          matched_by?: string | null
          matched_journal_line_id?: string | null
          notes?: string | null
          reference?: string | null
          statement_id?: string
          txn_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_matched_journal_line_id_fkey"
            columns: ["matched_journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_entry_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statements: {
        Row: {
          bank_account_id: string
          closing_balance: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          opening_balance: number
          period_end: string
          period_start: string
          statement_date: string
          status: string
          updated_at: string
        }
        Insert: {
          bank_account_id: string
          closing_balance?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          opening_balance?: number
          period_end: string
          period_start: string
          statement_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          bank_account_id?: string
          closing_balance?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          opening_balance?: number
          period_end?: string
          period_start?: string
          statement_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_capital_allocations: {
        Row: {
          allocation_date: string
          amount: number
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allocation_date?: string
          amount: number
          branch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allocation_date?: string
          amount?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_capital_allocations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_capital_allocations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
        ]
      }
      branch_closures: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          reason: string | null
          start_date: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          reason?: string | null
          start_date: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          reason?: string | null
          start_date?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_closures_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_closures_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "branch_closures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_schedules: {
        Row: {
          auto_close_hours: number
          block_open_on_off_day: boolean
          branch_id: string
          close_grace_minutes: number
          close_time: string | null
          created_at: string
          id: string
          open_time: string | null
          pre_close_warn_minutes: number
          reminder_hours: number
          tenant_id: string
          updated_at: string
          weekly_off: number[]
        }
        Insert: {
          auto_close_hours?: number
          block_open_on_off_day?: boolean
          branch_id: string
          close_grace_minutes?: number
          close_time?: string | null
          created_at?: string
          id?: string
          open_time?: string | null
          pre_close_warn_minutes?: number
          reminder_hours?: number
          tenant_id: string
          updated_at?: string
          weekly_off?: number[]
        }
        Update: {
          auto_close_hours?: number
          block_open_on_off_day?: boolean
          branch_id?: string
          close_grace_minutes?: number
          close_time?: string | null
          created_at?: string
          id?: string
          open_time?: string | null
          pre_close_warn_minutes?: number
          reminder_hours?: number
          tenant_id?: string
          updated_at?: string
          weekly_off?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "branch_schedules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_schedules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "branch_schedules_tenant_id_fkey"
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
            foreignKeyName: "branch_users_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      budgets: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          fiscal_period_id: string
          id: string
          notes: string | null
          planned_amount: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          fiscal_period_id: string
          id?: string
          notes?: string | null
          planned_amount?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          fiscal_period_id?: string
          id?: string
          notes?: string | null
          planned_amount?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "budgets_fiscal_period_id_fkey"
            columns: ["fiscal_period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      capacities: {
        Row: {
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: []
      }
      cashier_shifts: {
        Row: {
          branch_id: string
          cash_sales: number | null
          cashier_id: string
          close_notes: string | null
          closed_at: string | null
          closed_by: string | null
          closing_cash: number | null
          created_at: string
          expected_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          variance: number | null
        }
        Insert: {
          branch_id: string
          cash_sales?: number | null
          cashier_id: string
          close_notes?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closing_cash?: number | null
          created_at?: string
          expected_cash?: number | null
          id?: string
          open_notes?: string | null
          opened_at?: string
          opening_cash?: number
          pre_close_warned_at?: string | null
          reminder_sent_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          variance?: number | null
        }
        Update: {
          branch_id?: string
          cash_sales?: number | null
          cashier_id?: string
          close_notes?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closing_cash?: number | null
          created_at?: string
          expected_cash?: number | null
          id?: string
          open_notes?: string | null
          opened_at?: string
          opening_cash?: number
          pre_close_warned_at?: string | null
          reminder_sent_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cashier_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashier_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "cashier_shifts_tenant_id_fkey"
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
      chart_of_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          name_ar: string | null
          normal_balance: Database["public"]["Enums"]["normal_balance"]
          parent_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          name_ar?: string | null
          normal_balance: Database["public"]["Enums"]["normal_balance"]
          parent_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          name_ar?: string | null
          normal_balance?: Database["public"]["Enums"]["normal_balance"]
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
        ]
      }
      colors: {
        Row: {
          created_at: string
          hex: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          hex?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          hex?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          address: string | null
          branch_id: string | null
          contact_person: string | null
          created_at: string
          credit_balance: number
          id: string
          is_migrated: boolean
          name: string
          notes: string | null
          opening_balance: number
          phone: string | null
          refund_status: string
          tenant_id: string | null
          type: string
        }
        Insert: {
          address?: string | null
          branch_id?: string | null
          contact_person?: string | null
          created_at?: string
          credit_balance?: number
          id?: string
          is_migrated?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          refund_status?: string
          tenant_id?: string | null
          type?: string
        }
        Update: {
          address?: string | null
          branch_id?: string | null
          contact_person?: string | null
          created_at?: string
          credit_balance?: number
          id?: string
          is_migrated?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          refund_status?: string
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
            foreignKeyName: "contacts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      customer_credit_log: {
        Row: {
          amount: number
          contact_id: string
          created_at: string
          created_by: string
          id: string
          invoice_id: string | null
          notes: string | null
          tenant_id: string | null
          type: string
        }
        Insert: {
          amount: number
          contact_id: string
          created_at?: string
          created_by: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          tenant_id?: string | null
          type: string
        }
        Update: {
          amount?: number
          contact_id?: string
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          tenant_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_credit_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "customer_credit_log_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      depreciation_entries: {
        Row: {
          amount: number
          asset_id: string
          created_at: string
          id: string
          journal_entry_id: string | null
          period_month: string
          posted_at: string
          tenant_id: string
        }
        Insert: {
          amount: number
          asset_id: string
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          period_month: string
          posted_at?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          asset_id?: string
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          period_month?: string
          posted_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_entries_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_approval_requests: {
        Row: {
          admin_note: string | null
          branch_id: string
          cashier_id: string
          cashier_name: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          discount_percent: number
          draft_payload: Json | null
          id: string
          invoice_id: string | null
          original_price: number
          product_id: string | null
          product_name: string
          quantity: number
          reason: string | null
          requested_price: number
          status: string
          tenant_id: string | null
        }
        Insert: {
          admin_note?: string | null
          branch_id: string
          cashier_id: string
          cashier_name: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          discount_percent: number
          draft_payload?: Json | null
          id?: string
          invoice_id?: string | null
          original_price: number
          product_id?: string | null
          product_name: string
          quantity?: number
          reason?: string | null
          requested_price: number
          status?: string
          tenant_id?: string | null
        }
        Update: {
          admin_note?: string | null
          branch_id?: string
          cashier_id?: string
          cashier_name?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          discount_percent?: number
          draft_payload?: Json | null
          id?: string
          invoice_id?: string | null
          original_price?: number
          product_id?: string | null
          product_name?: string
          quantity?: number
          reason?: string | null
          requested_price?: number
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discount_approval_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_approval_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "discount_approval_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      equity_partners: {
        Row: {
          capital_share: number
          created_at: string
          id: string
          initial_capital: number
          is_active: boolean
          name: string
          operating_share: number
          partner_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capital_share?: number
          created_at?: string
          id?: string
          initial_capital?: number
          is_active?: boolean
          name: string
          operating_share?: number
          partner_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capital_share?: number
          created_at?: string
          id?: string
          initial_capital?: number
          is_active?: boolean
          name?: string
          operating_share?: number
          partner_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equity_partners_tenant_id_fkey"
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
            foreignKeyName: "expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      fiscal_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_entry_id: string | null
          created_at: string
          id: string
          name: string
          net_profit: number | null
          notes: string | null
          period_end: string
          period_start: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_entry_id?: string | null
          created_at?: string
          id?: string
          name: string
          net_profit?: number | null
          notes?: string | null
          period_end: string
          period_start: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_entry_id?: string | null
          created_at?: string
          id?: string
          name?: string
          net_profit?: number | null
          notes?: string | null
          period_end?: string
          period_start?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_periods_closing_entry_id_fkey"
            columns: ["closing_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          accum_depreciation_account_id: string | null
          acquisition_date: string
          asset_account_id: string | null
          category: string | null
          code: string
          cost: number
          created_at: string
          depreciation_expense_account_id: string | null
          depreciation_method: string
          disposal_amount: number | null
          disposal_date: string | null
          disposal_journal_entry_id: string | null
          id: string
          name: string
          notes: string | null
          salvage_value: number
          status: string
          tenant_id: string
          updated_at: string
          useful_life_months: number
        }
        Insert: {
          accum_depreciation_account_id?: string | null
          acquisition_date: string
          asset_account_id?: string | null
          category?: string | null
          code: string
          cost: number
          created_at?: string
          depreciation_expense_account_id?: string | null
          depreciation_method?: string
          disposal_amount?: number | null
          disposal_date?: string | null
          disposal_journal_entry_id?: string | null
          id?: string
          name: string
          notes?: string | null
          salvage_value?: number
          status?: string
          tenant_id: string
          updated_at?: string
          useful_life_months: number
        }
        Update: {
          accum_depreciation_account_id?: string | null
          acquisition_date?: string
          asset_account_id?: string | null
          category?: string | null
          code?: string
          cost?: number
          created_at?: string
          depreciation_expense_account_id?: string | null
          depreciation_method?: string
          disposal_amount?: number | null
          disposal_date?: string | null
          disposal_journal_entry_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          salvage_value?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          useful_life_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_accum_depreciation_account_id_fkey"
            columns: ["accum_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_accum_depreciation_account_id_fkey"
            columns: ["accum_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "fixed_assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "fixed_assets_depreciation_expense_account_id_fkey"
            columns: ["depreciation_expense_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_depreciation_expense_account_id_fkey"
            columns: ["depreciation_expense_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
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
      inventory_reservations: {
        Row: {
          branch_id: string
          capacity: string | null
          cashier_id: string | null
          cashier_name: string | null
          color: string | null
          created_at: string
          expires_at: string
          id: string
          invoice_draft_id: string
          product_id: string
          product_type: string | null
          released_at: string | null
          reserved_quantity: number
          size: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          branch_id: string
          capacity?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          color?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invoice_draft_id: string
          product_id: string
          product_type?: string | null
          released_at?: string | null
          reserved_quantity?: number
          size?: string | null
          status?: string
          tenant_id?: string | null
        }
        Update: {
          branch_id?: string
          capacity?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          color?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invoice_draft_id?: string
          product_id?: string
          product_type?: string | null
          released_at?: string | null
          reserved_quantity?: number
          size?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reservations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "inventory_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_session_items: {
        Row: {
          actual_quantity: number | null
          capacity: string | null
          color: string | null
          created_at: string
          difference: number | null
          id: string
          notes: string | null
          product_code: string
          product_id: string
          product_name: string
          product_type: string | null
          reason: string | null
          session_id: string
          size: string | null
          system_quantity: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          actual_quantity?: number | null
          capacity?: string | null
          color?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          notes?: string | null
          product_code: string
          product_id: string
          product_name: string
          product_type?: string | null
          reason?: string | null
          session_id: string
          size?: string | null
          system_quantity: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          actual_quantity?: number | null
          capacity?: string | null
          color?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          notes?: string | null
          product_code?: string
          product_id?: string
          product_name?: string
          product_type?: string | null
          reason?: string | null
          session_id?: string
          size?: string | null
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
          {
            foreignKeyName: "inventory_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          batch_id: string | null
          batches_consumed: Json | null
          capacity: string | null
          color: string | null
          cost_price: number
          discount_approval_note: string | null
          discount_approved_by: string | null
          discount_percent: number
          final_price: number | null
          fully_returned: boolean
          id: string
          invoice_id: string
          line_discount: number
          market_price: number
          net_quantity: number | null
          original_price: number | null
          original_unit_cost: number | null
          price_list_cost: number | null
          price_list_item_id: string | null
          product_id: string | null
          product_name: string
          product_type: string | null
          quantity: number
          returned_quantity: number
          selling_price: number
          size: string | null
          tenant_id: string | null
          total: number
          unit_cost_at_sale: number
        }
        Insert: {
          batch_id?: string | null
          batches_consumed?: Json | null
          capacity?: string | null
          color?: string | null
          cost_price?: number
          discount_approval_note?: string | null
          discount_approved_by?: string | null
          discount_percent?: number
          final_price?: number | null
          fully_returned?: boolean
          id?: string
          invoice_id: string
          line_discount?: number
          market_price?: number
          net_quantity?: number | null
          original_price?: number | null
          original_unit_cost?: number | null
          price_list_cost?: number | null
          price_list_item_id?: string | null
          product_id?: string | null
          product_name: string
          product_type?: string | null
          quantity: number
          returned_quantity?: number
          selling_price?: number
          size?: string | null
          tenant_id?: string | null
          total?: number
          unit_cost_at_sale?: number
        }
        Update: {
          batch_id?: string | null
          batches_consumed?: Json | null
          capacity?: string | null
          color?: string | null
          cost_price?: number
          discount_approval_note?: string | null
          discount_approved_by?: string | null
          discount_percent?: number
          final_price?: number | null
          fully_returned?: boolean
          id?: string
          invoice_id?: string
          line_discount?: number
          market_price?: number
          net_quantity?: number | null
          original_price?: number | null
          original_unit_cost?: number | null
          price_list_cost?: number | null
          price_list_item_id?: string | null
          product_id?: string | null
          product_name?: string
          product_type?: string | null
          quantity?: number
          returned_quantity?: number
          selling_price?: number
          size?: string | null
          tenant_id?: string | null
          total?: number
          unit_cost_at_sale?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
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
          reverses_payment_id: string | null
          tenant_id: string | null
          transfer_from_account: string | null
          transfer_to_account: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_by_payment_id: string | null
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
          reverses_payment_id?: string | null
          tenant_id?: string | null
          transfer_from_account?: string | null
          transfer_to_account?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_payment_id?: string | null
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
          reverses_payment_id?: string | null
          tenant_id?: string | null
          transfer_from_account?: string | null
          transfer_to_account?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_reverses_payment_id_fkey"
            columns: ["reverses_payment_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_voided_by_payment_id_fkey"
            columns: ["voided_by_payment_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          branch_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cashier_id: string
          contact_id: string | null
          created_at: string
          current_balance: number | null
          discount_amount: number
          discount_percent: number
          discount_reason: string | null
          id: string
          invoice_date: string
          invoice_number: string
          is_migrated: boolean
          migration_source: string | null
          notes: string | null
          payment_method: string
          previous_balance: number | null
          refund_amount: number
          refund_method: string | null
          refund_processed_at: string | null
          refund_processed_by: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tenant_id: string | null
          total: number
          total_paid_before_cancel: number
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          branch_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cashier_id: string
          contact_id?: string | null
          created_at?: string
          current_balance?: number | null
          discount_amount?: number
          discount_percent?: number
          discount_reason?: string | null
          id?: string
          invoice_date?: string
          invoice_number: string
          is_migrated?: boolean
          migration_source?: string | null
          notes?: string | null
          payment_method?: string
          previous_balance?: number | null
          refund_amount?: number
          refund_method?: string | null
          refund_processed_at?: string | null
          refund_processed_by?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tenant_id?: string | null
          total?: number
          total_paid_before_cancel?: number
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          branch_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cashier_id?: string
          contact_id?: string | null
          created_at?: string
          current_balance?: number | null
          discount_amount?: number
          discount_percent?: number
          discount_reason?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          is_migrated?: boolean
          migration_source?: string | null
          notes?: string | null
          payment_method?: string
          previous_balance?: number | null
          refund_amount?: number
          refund_method?: string | null
          refund_processed_at?: string | null
          refund_processed_by?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tenant_id?: string | null
          total?: number
          total_paid_before_cancel?: number
          vat_amount?: number
          vat_rate?: number
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
            foreignKeyName: "invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
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
      journal_entries: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          entry_date: string
          entry_number: string
          id: string
          reversed_by: string | null
          source_id: string | null
          source_type: string | null
          status: string
          tenant_id: string
          total_credit: number
          total_debit: number
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number: string
          id?: string
          reversed_by?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: string
          tenant_id: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          reversed_by?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: string
          tenant_id?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          description: string | null
          entry_id: string
          id: string
          line_order: number
          tenant_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          entry_id: string
          id?: string
          line_order?: number
          tenant_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          entry_id?: string
          id?: string
          line_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "journal_entry_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
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
      owner_expenses_access: {
        Row: {
          can_edit: boolean
          can_view: boolean
          created_at: string
          granted_user_id: string
          id: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          granted_user_id: string
          id?: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          granted_user_id?: string
          id?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      owner_personal_expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          created_by: string
          description: string
          expense_datetime: string
          id: string
          notes: string | null
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          created_by?: string
          description: string
          expense_datetime?: string
          id?: string
          notes?: string | null
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          created_by?: string
          description?: string
          expense_datetime?: string
          id?: string
          notes?: string | null
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      partner_advance_installments: {
        Row: {
          advance_id: string
          amount: number
          created_at: string
          due_date: string
          id: string
          installment_number: number
          paid_amount: number
          paid_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          advance_id: string
          amount: number
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          paid_amount?: number
          paid_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          advance_id?: string
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          paid_amount?: number
          paid_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_advance_installments_advance_id_fkey"
            columns: ["advance_id"]
            isOneToOne: false
            referencedRelation: "partner_advances"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_advance_payments: {
        Row: {
          advance_id: string
          amount: number
          created_at: string
          created_by: string | null
          id: string
          installment_id: string | null
          notes: string | null
          payment_date: string
          payment_method: string
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          advance_id: string
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          installment_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          advance_id?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          installment_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_advance_payments_advance_id_fkey"
            columns: ["advance_id"]
            isOneToOne: false
            referencedRelation: "partner_advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_advance_payments_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "partner_advance_installments"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_advances: {
        Row: {
          advance_date: string
          amount: number
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          installments_count: number
          monthly_deduction: number | null
          notes: string | null
          partner_id: string
          reason: string | null
          remaining_amount: number
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          advance_date?: string
          amount: number
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          installments_count?: number
          monthly_deduction?: number | null
          notes?: string | null
          partner_id: string
          reason?: string | null
          remaining_amount: number
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          advance_date?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          installments_count?: number
          monthly_deduction?: number | null
          notes?: string | null
          partner_id?: string
          reason?: string | null
          remaining_amount?: number
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_advances_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "equity_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_advances_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "v_partner_balances"
            referencedColumns: ["partner_id"]
          },
        ]
      }
      partner_share_history: {
        Row: {
          capital_share: number
          change_reason: string | null
          changed_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          operating_share: number
          partner_id: string
          tenant_id: string
        }
        Insert: {
          capital_share?: number
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          operating_share?: number
          partner_id: string
          tenant_id: string
        }
        Update: {
          capital_share?: number
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          operating_share?: number
          partner_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_share_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_share_history_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "equity_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_share_history_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "v_partner_balances"
            referencedColumns: ["partner_id"]
          },
          {
            foreignKeyName: "partner_share_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_transactions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_void: boolean
          month_year: string | null
          partner_id: string
          related_treasury_id: string | null
          related_voucher_id: string | null
          tenant_id: string
          transaction_type: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_void?: boolean
          month_year?: string | null
          partner_id: string
          related_treasury_id?: string | null
          related_voucher_id?: string | null
          tenant_id: string
          transaction_type: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_void?: boolean
          month_year?: string | null
          partner_id?: string
          related_treasury_id?: string | null
          related_voucher_id?: string | null
          tenant_id?: string
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_transactions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "equity_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_transactions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "v_partner_balances"
            referencedColumns: ["partner_id"]
          },
          {
            foreignKeyName: "partner_transactions_related_treasury_id_fkey"
            columns: ["related_treasury_id"]
            isOneToOne: false
            referencedRelation: "treasury"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_transactions_related_voucher_id_fkey"
            columns: ["related_voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_users: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          partner_id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          partner_id: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          partner_id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_users_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "equity_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_users_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "v_partner_balances"
            referencedColumns: ["partner_id"]
          },
          {
            foreignKeyName: "partner_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_installments: {
        Row: {
          adjusted_at: string | null
          adjustment_reason: string | null
          amount: number
          cancelled_at: string | null
          cancelled_by: string | null
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
          adjusted_at?: string | null
          adjustment_reason?: string | null
          amount: number
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          adjusted_at?: string | null
          adjustment_reason?: string | null
          amount?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          invoice_id: string | null
          payment_method: string
          payment_plan_id: string | null
          received_by_name: string | null
          reference_number: string | null
          reverses_tx_id: string | null
          tenant_id: string | null
          total_with_fee: number
          transfer_from_account: string | null
          transfer_to_account: string | null
          treasury_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_by_tx_id: string | null
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
          invoice_id?: string | null
          payment_method: string
          payment_plan_id?: string | null
          received_by_name?: string | null
          reference_number?: string | null
          reverses_tx_id?: string | null
          tenant_id?: string | null
          total_with_fee: number
          transfer_from_account?: string | null
          transfer_to_account?: string | null
          treasury_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_tx_id?: string | null
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
          invoice_id?: string | null
          payment_method?: string
          payment_plan_id?: string | null
          received_by_name?: string | null
          reference_number?: string | null
          reverses_tx_id?: string | null
          tenant_id?: string | null
          total_with_fee?: number
          transfer_from_account?: string | null
          transfer_to_account?: string | null
          treasury_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_tx_id?: string | null
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
            foreignKeyName: "payment_transactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "payment_transactions_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "payment_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_reverses_tx_id_fkey"
            columns: ["reverses_tx_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_voided_by_tx_id_fkey"
            columns: ["voided_by_tx_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
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
          capacity: string | null
          color: string | null
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
          product_type: string | null
          quantity: number
          size: string | null
          status: Database["public"]["Enums"]["pre_order_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          capacity?: string | null
          color?: string | null
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
          product_type?: string | null
          quantity: number
          size?: string | null
          status?: Database["public"]["Enums"]["pre_order_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          capacity?: string | null
          color?: string | null
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
          product_type?: string | null
          quantity?: number
          size?: string | null
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
          {
            foreignKeyName: "pre_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
          },
        ]
      }
      price_audit_log: {
        Row: {
          branch_id: string | null
          change_reason: string | null
          changed_by: string | null
          changed_by_name: string | null
          changed_by_role: string | null
          created_at: string
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          id: string
          new_value: number | null
          old_value: number | null
          price_type: string
          quantity_at_change: number | null
          source: string
          tenant_id: string | null
        }
        Insert: {
          branch_id?: string | null
          change_reason?: string | null
          changed_by?: string | null
          changed_by_name?: string | null
          changed_by_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          price_type: string
          quantity_at_change?: number | null
          source?: string
          tenant_id?: string | null
        }
        Update: {
          branch_id?: string | null
          change_reason?: string | null
          changed_by?: string | null
          changed_by_name?: string | null
          changed_by_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          price_type?: string
          quantity_at_change?: number | null
          source?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      product_batches: {
        Row: {
          base_purchase_price: number
          batch_type: string
          branch_id: string
          cost_price: number
          created_at: string
          id: string
          last_restored_at: string | null
          product_id: string
          quantity_purchased: number
          quantity_remaining: number
          restore_count: number
          shipment_id: string | null
          shipping_cost_per_unit: number
          tenant_id: string | null
          transferred_from_branch_id: string | null
          true_unit_cost: number
        }
        Insert: {
          base_purchase_price?: number
          batch_type?: string
          branch_id: string
          cost_price?: number
          created_at?: string
          id?: string
          last_restored_at?: string | null
          product_id: string
          quantity_purchased?: number
          quantity_remaining?: number
          restore_count?: number
          shipment_id?: string | null
          shipping_cost_per_unit?: number
          tenant_id?: string | null
          transferred_from_branch_id?: string | null
          true_unit_cost?: number
        }
        Update: {
          base_purchase_price?: number
          batch_type?: string
          branch_id?: string
          cost_price?: number
          created_at?: string
          id?: string
          last_restored_at?: string | null
          product_id?: string
          quantity_purchased?: number
          quantity_remaining?: number
          restore_count?: number
          shipment_id?: string | null
          shipping_cost_per_unit?: number
          tenant_id?: string | null
          transferred_from_branch_id?: string | null
          true_unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_transferred_from_branch_id_fkey"
            columns: ["transferred_from_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_transferred_from_branch_id_fkey"
            columns: ["transferred_from_branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
        ]
      }
      product_types: {
        Row: {
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          branch_id: string
          capacity: string | null
          category_id: string | null
          color: string | null
          cost_price: number
          created_at: string
          id: string
          image: string | null
          is_migrated: boolean
          legacy_code: string | null
          low_stock_alert: number
          market_price: number
          min_stock_level: number
          name: string
          old_price: number
          product_type: string | null
          quantity: number
          selling_price: number
          size: string | null
          sku: string
          tenant_id: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          branch_id: string
          capacity?: string | null
          category_id?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          image?: string | null
          is_migrated?: boolean
          legacy_code?: string | null
          low_stock_alert?: number
          market_price?: number
          min_stock_level?: number
          name: string
          old_price?: number
          product_type?: string | null
          quantity?: number
          selling_price?: number
          size?: string | null
          sku: string
          tenant_id?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          branch_id?: string
          capacity?: string | null
          category_id?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          image?: string | null
          is_migrated?: boolean
          legacy_code?: string | null
          low_stock_alert?: number
          market_price?: number
          min_stock_level?: number
          name?: string
          old_price?: number
          product_type?: string | null
          quantity?: number
          selling_price?: number
          size?: string | null
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
            foreignKeyName: "products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      profit_distribution_lines: {
        Row: {
          amount: number
          created_at: string
          distribution_id: string
          id: string
          partner_id: string
          partner_transaction_id: string | null
          share_percentage: number
        }
        Insert: {
          amount: number
          created_at?: string
          distribution_id: string
          id?: string
          partner_id: string
          partner_transaction_id?: string | null
          share_percentage: number
        }
        Update: {
          amount?: number
          created_at?: string
          distribution_id?: string
          id?: string
          partner_id?: string
          partner_transaction_id?: string | null
          share_percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "profit_distribution_lines_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "profit_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profit_distribution_lines_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "equity_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profit_distribution_lines_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "v_partner_balances"
            referencedColumns: ["partner_id"]
          },
          {
            foreignKeyName: "profit_distribution_lines_partner_transaction_id_fkey"
            columns: ["partner_transaction_id"]
            isOneToOne: false
            referencedRelation: "partner_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      profit_distributions: {
        Row: {
          created_at: string
          created_by: string | null
          distribution_date: string
          fiscal_period_id: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          status: string
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          distribution_date?: string
          fiscal_period_id?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          status?: string
          tenant_id: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          distribution_date?: string
          fiscal_period_id?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          status?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profit_distributions_fiscal_period_id_fkey"
            columns: ["fiscal_period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profit_distributions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_return_items: {
        Row: {
          capacity: string | null
          color: string | null
          id: string
          product_id: string
          product_name: string
          product_type: string | null
          purchase_return_id: string
          quantity: number
          size: string | null
          total: number
          unit_cost: number
        }
        Insert: {
          capacity?: string | null
          color?: string | null
          id?: string
          product_id: string
          product_name: string
          product_type?: string | null
          purchase_return_id: string
          quantity: number
          size?: string | null
          total: number
          unit_cost: number
        }
        Update: {
          capacity?: string | null
          color?: string | null
          id?: string
          product_id?: string
          product_name?: string
          product_type?: string | null
          purchase_return_id?: string
          quantity?: number
          size?: string | null
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
          invoice_date: string
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
          invoice_date?: string
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
          invoice_date?: string
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
            foreignKeyName: "purchase_returns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "purchase_returns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
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
          capacity: string | null
          color: string | null
          id: string
          product_id: string | null
          product_name: string
          product_type: string | null
          quantity: number
          quote_id: string
          size: string | null
          total: number
          unit_price: number
        }
        Insert: {
          capacity?: string | null
          color?: string | null
          id?: string
          product_id?: string | null
          product_name: string
          product_type?: string | null
          quantity: number
          quote_id: string
          size?: string | null
          total: number
          unit_price: number
        }
        Update: {
          capacity?: string | null
          color?: string | null
          id?: string
          product_id?: string | null
          product_name?: string
          product_type?: string | null
          quantity?: number
          quote_id?: string
          size?: string | null
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
            foreignKeyName: "quotes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
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
          capacity: string | null
          color: string | null
          id: string
          product_id: string | null
          product_type: string | null
          quantity: number
          refund: number
          return_id: string
          size: string | null
          tenant_id: string | null
        }
        Insert: {
          capacity?: string | null
          color?: string | null
          id?: string
          product_id?: string | null
          product_type?: string | null
          quantity: number
          refund: number
          return_id: string
          size?: string | null
          tenant_id?: string | null
        }
        Update: {
          capacity?: string | null
          color?: string | null
          id?: string
          product_id?: string | null
          product_type?: string | null
          quantity?: number
          refund?: number
          return_id?: string
          size?: string | null
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
          invoice_date: string
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
          invoice_date?: string
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
          invoice_date?: string
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
            foreignKeyName: "returns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
          base_unit_price: number
          capacity: string | null
          color: string | null
          cost_price: number
          discount_amount: number
          discount_percent: number
          id: string
          product_id: string | null
          product_name: string
          product_type: string | null
          quantity: number
          shipment_id: string
          shipping_cost_per_unit: number
          size: string | null
          tenant_id: string | null
          total: number
          true_unit_cost: number
        }
        Insert: {
          base_unit_price?: number
          capacity?: string | null
          color?: string | null
          cost_price: number
          discount_amount?: number
          discount_percent?: number
          id?: string
          product_id?: string | null
          product_name: string
          product_type?: string | null
          quantity: number
          shipment_id: string
          shipping_cost_per_unit?: number
          size?: string | null
          tenant_id?: string | null
          total: number
          true_unit_cost?: number
        }
        Update: {
          base_unit_price?: number
          capacity?: string | null
          color?: string | null
          cost_price?: number
          discount_amount?: number
          discount_percent?: number
          id?: string
          product_id?: string | null
          product_name?: string
          product_type?: string | null
          quantity?: number
          shipment_id?: string
          shipping_cost_per_unit?: number
          size?: string | null
          tenant_id?: string | null
          total?: number
          true_unit_cost?: number
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
          current_balance: number | null
          customs_cost: number
          id: string
          invoice_date: string
          notes: string | null
          other_cost: number
          other_cost_description: string | null
          previous_balance: number | null
          received_by: string
          shipment_number: string
          shipping_cost: number
          tenant_id: string | null
          total_cost: number
          total_extra_costs: number
        }
        Insert: {
          admin_cost?: number
          arrival_date: string
          branch_id: string
          contact_id: string
          created_at?: string
          current_balance?: number | null
          customs_cost?: number
          id?: string
          invoice_date?: string
          notes?: string | null
          other_cost?: number
          other_cost_description?: string | null
          previous_balance?: number | null
          received_by: string
          shipment_number?: string
          shipping_cost?: number
          tenant_id?: string | null
          total_cost?: number
          total_extra_costs?: number
        }
        Update: {
          admin_cost?: number
          arrival_date?: string
          branch_id?: string
          contact_id?: string
          created_at?: string
          current_balance?: number | null
          customs_cost?: number
          id?: string
          invoice_date?: string
          notes?: string | null
          other_cost?: number
          other_cost_description?: string | null
          previous_balance?: number | null
          received_by?: string
          shipment_number?: string
          shipping_cost?: number
          tenant_id?: string | null
          total_cost?: number
          total_extra_costs?: number
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
            foreignKeyName: "shipments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "shipments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
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
      sizes: {
        Row: {
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: []
      }
      stock_adjustment_items: {
        Row: {
          actual_quantity: number
          adjustment_id: string
          capacity: string | null
          color: string | null
          difference: number
          id: string
          product_id: string
          product_name: string
          product_type: string | null
          size: string | null
          system_quantity: number
          unit_cost: number
        }
        Insert: {
          actual_quantity: number
          adjustment_id: string
          capacity?: string | null
          color?: string | null
          difference: number
          id?: string
          product_id: string
          product_name: string
          product_type?: string | null
          size?: string | null
          system_quantity: number
          unit_cost?: number
        }
        Update: {
          actual_quantity?: number
          adjustment_id?: string
          capacity?: string | null
          color?: string | null
          difference?: number
          id?: string
          product_id?: string
          product_name?: string
          product_type?: string | null
          size?: string | null
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
            foreignKeyName: "stock_adjustments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
          capacity: string | null
          color: string | null
          confirmed_by: string | null
          cost_price_at_transfer: number | null
          created_at: string
          from_branch_id: string
          group_id: string | null
          id: string
          product_id: string
          product_type: string | null
          quantity: number
          reason: string | null
          received_quantity: number | null
          size: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string | null
          to_branch_id: string
          total_value_at_transfer: number | null
          transferred_by: string
        }
        Insert: {
          capacity?: string | null
          color?: string | null
          confirmed_by?: string | null
          cost_price_at_transfer?: number | null
          created_at?: string
          from_branch_id: string
          group_id?: string | null
          id?: string
          product_id: string
          product_type?: string | null
          quantity: number
          reason?: string | null
          received_quantity?: number | null
          size?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string | null
          to_branch_id: string
          total_value_at_transfer?: number | null
          transferred_by: string
        }
        Update: {
          capacity?: string | null
          color?: string | null
          confirmed_by?: string | null
          cost_price_at_transfer?: number | null
          created_at?: string
          from_branch_id?: string
          group_id?: string | null
          id?: string
          product_id?: string
          product_type?: string | null
          quantity?: number
          reason?: string | null
          received_quantity?: number | null
          size?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string | null
          to_branch_id?: string
          total_value_at_transfer?: number | null
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
            foreignKeyName: "stock_transfers_from_branch_id_fkey"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
          {
            foreignKeyName: "stock_transfers_to_branch_id_fkey"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
          {
            foreignKeyName: "supplier_payments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
          },
        ]
      }
      system_backups: {
        Row: {
          created_at: string
          error: string | null
          filename: string
          id: string
          size_bytes: number
          status: string
          storage_path: string | null
          table_counts: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          filename: string
          id?: string
          size_bytes?: number
          status?: string
          storage_path?: string | null
          table_counts?: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          filename?: string
          id?: string
          size_bytes?: number
          status?: string
          storage_path?: string | null
          table_counts?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_backups_tenant_id_fkey"
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
          is_suspended: boolean
          logo_url: string | null
          max_branches: number | null
          max_products: number | null
          max_users: number | null
          name: string
          owner_user_id: string | null
          plan: string
          primary_color: string | null
          setup_completed: boolean
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
          owner_user_id?: string | null
          plan?: string
          primary_color?: string | null
          setup_completed?: boolean
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
          owner_user_id?: string | null
          plan?: string
          primary_color?: string | null
          setup_completed?: boolean
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
            foreignKeyName: "treasury_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
            foreignKeyName: "treasury_transfers_from_branch_id_fkey"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
          {
            foreignKeyName: "treasury_transfers_to_branch_id_fkey"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      voucher_attachments: {
        Row: {
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          uploaded_at: string
          uploaded_by: string | null
          voucher_id: string
        }
        Insert: {
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          voucher_id: string
        }
        Update: {
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_attachments_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_categories: {
        Row: {
          created_at: string
          gl_account_code: string | null
          id: string
          is_active: boolean
          is_deductible_from_profit: boolean
          is_system: boolean
          name: string
          parent_id: string | null
          system_key: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["voucher_type"]
        }
        Insert: {
          created_at?: string
          gl_account_code?: string | null
          id?: string
          is_active?: boolean
          is_deductible_from_profit?: boolean
          is_system?: boolean
          name: string
          parent_id?: string | null
          system_key?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["voucher_type"]
        }
        Update: {
          created_at?: string
          gl_account_code?: string | null
          id?: string
          is_active?: boolean
          is_deductible_from_profit?: boolean
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
            foreignKeyName: "vouchers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      v_account_balances: {
        Row: {
          account_id: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          balance: number | null
          code: string | null
          name: string | null
          name_ar: string | null
          normal_balance: Database["public"]["Enums"]["normal_balance"] | null
          tenant_id: string | null
          total_credit: number | null
          total_debit: number | null
        }
        Relationships: []
      }
      v_contact_balances: {
        Row: {
          contact_id: string | null
          credit_balance: number | null
          last_transaction_date: string | null
          ledger_balance: number | null
          name: string | null
          opening_balance: number | null
          overdue_amount: number | null
          tenant_id: string | null
          total_balance: number | null
          total_invoiced: number | null
          total_paid: number | null
          total_purchase_returns: number | null
          total_returned: number | null
          total_shipments: number | null
          total_supplier_paid: number | null
          total_voucher_payments: number | null
          total_voucher_receipts: number | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_partner_balances: {
        Row: {
          current_balance: number | null
          partner_id: string | null
          tenant_id: string | null
          total_contributions: number | null
          total_drawings: number | null
          total_profit_share: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equity_partners_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_shifts_history: {
        Row: {
          branch_id: string | null
          branch_name: string | null
          cash_sales: number | null
          cashier_id: string | null
          cashier_name: string | null
          close_notes: string | null
          closed_at: string | null
          closed_by: string | null
          closing_cash: number | null
          created_at: string | null
          expected_cash: number | null
          id: string | null
          open_notes: string | null
          opened_at: string | null
          opening_cash: number | null
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          variance: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cashier_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashier_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "cashier_shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_supplier_ledger: {
        Row: {
          amount: number | null
          branch_id: string | null
          branch_name: string | null
          contact_id: string | null
          direction: string | null
          id: string | null
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          received_by_name: string | null
          reference_number: string | null
          source: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_treasury_balances: {
        Row: {
          branch_id: string | null
          branch_name: string | null
          current_balance: number | null
          last_transaction_date: string | null
          tenant_id: string | null
          total_payments: number | null
          total_receipts: number | null
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
            foreignKeyName: "vouchers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
      _audit_user_info: {
        Args: { _uid: string }
        Returns: {
          uname: string
          urole: string
        }[]
      }
      _audit_write: {
        Args: {
          _branch: string
          _eid: string
          _ename: string
          _etype: string
          _new: number
          _old: number
          _ptype: string
          _qty?: number
          _reason: string
          _source: string
          _tenant: string
        }
        Returns: undefined
      }
      _validate_transfer_payment: {
        Args: {
          p_from: string
          p_method: string
          p_reference: string
          p_to: string
        }
        Returns: undefined
      }
      acknowledge_treasury_transfer: {
        Args: { p_transfer_id: string }
        Returns: undefined
      }
      add_invoice_payment: {
        Args: {
          p_amount: number
          p_fee_amount?: number
          p_fee_on_customer?: boolean
          p_invoice_id: string
          p_payment_method: string
          p_received_by_name?: string
          p_reference_number?: string
          p_transfer_from_account?: string
          p_transfer_to_account?: string
        }
        Returns: string
      }
      admin_reset_branch_data: {
        Args: { p_branch_id: string; p_options: Json }
        Returns: Json
      }
      admin_reset_price_audit: { Args: { p_branch_id?: string }; Returns: Json }
      admin_reset_vouchers: { Args: { p_branch_id?: string }; Returns: Json }
      admin_set_product_quantity: {
        Args: {
          p_actual_quantity: number
          p_notes?: string
          p_product_id: string
          p_reason?: string
        }
        Returns: Json
      }
      allocate_capital_to_branch: {
        Args: {
          _allocation_date?: string
          _amount: number
          _branch_id: string
          _notes?: string
        }
        Returns: string
      }
      apply_price_list_update: {
        Args: { p_items: Json; p_source_id: string }
        Returns: Json
      }
      apply_return_batch_tracking: {
        Args: { _invoice_id: string; _items: Json }
        Returns: undefined
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
      archive_product: { Args: { _product_id: string }; Returns: undefined }
      backfill_missing_journals: { Args: never; Returns: Json }
      calculate_payment_fee: {
        Args: { p_amount: number; p_method: string }
        Returns: number
      }
      can_manage_attendance_for: {
        Args: { _target_employee_id: string }
        Returns: boolean
      }
      cancel_invoice_with_refund: {
        Args: { _invoice_id: string; _reason: string; _refund_method?: string }
        Returns: Json
      }
      cancel_pre_order: {
        Args: { p_pre_order_id: string; p_refund: boolean }
        Returns: undefined
      }
      cancel_voucher: {
        Args: { p_reason: string; p_voucher_id: string }
        Returns: undefined
      }
      close_cashier_shift: {
        Args: {
          p_auto?: boolean
          p_closing_cash: number
          p_notes?: string
          p_shift_id: string
        }
        Returns: {
          branch_id: string
          cash_sales: number | null
          cashier_id: string
          close_notes: string | null
          closed_at: string | null
          closed_by: string | null
          closing_cash: number | null
          created_at: string
          expected_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          variance: number | null
        }
        SetofOptions: {
          from: "*"
          to: "cashier_shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_fiscal_period:
        | { Args: { p_period_id: string }; Returns: Json }
        | { Args: { p_period_id: string; p_reason?: string }; Returns: Json }
      complete_pre_order_sale: {
        Args: { p_payment_method?: string; p_pre_order_id: string }
        Returns: string
      }
      compute_net_profit_for_period: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: Json
      }
      confirm_transfer_group: { Args: { p_group: string }; Returns: number }
      consume_product_batches: {
        Args: { _branch_id: string; _product_id: string; _quantity: number }
        Returns: number
      }
      consume_product_batches_json: {
        Args: { _branch_id: string; _product_id: string; _quantity: number }
        Returns: Json
      }
      create_inventory_session: {
        Args: { p_branch_id: string; p_notes?: string }
        Returns: string
      }
      create_journal_entry: {
        Args: {
          p_description: string
          p_entry_date: string
          p_lines: Json
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: string
      }
      create_manual_voucher: {
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
      create_partner_advance: {
        Args: {
          _advance_date: string
          _amount: number
          _custom_installments?: Json
          _first_due_date: string
          _installments_count: number
          _notes?: string
          _partner_id: string
          _reason?: string
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
      create_product_with_opening_stock: {
        Args: { p_product: Json }
        Returns: Json
      }
      current_tenant_active: { Args: never; Returns: boolean }
      current_tenant_id: { Args: never; Returns: string }
      current_tenant_is_suspended: { Args: never; Returns: boolean }
      decide_payment_void_request: {
        Args: { p_approve: boolean; p_note?: string; p_request_id: string }
        Returns: Json
      }
      delete_voucher_admin: {
        Args: { p_reason?: string; p_voucher_id: string }
        Returns: Json
      }
      detect_orphaned_batches: {
        Args: never
        Returns: {
          orphan_batches: number
          orphan_quantity_remaining: number
          product_id: string
          product_name: string
        }[]
      }
      disburse_pending_advance: {
        Args: { p_request_id: string }
        Returns: string
      }
      dispose_fixed_asset: {
        Args: {
          _asset_id: string
          _disposal_amount: number
          _disposal_date: string
        }
        Returns: string
      }
      distribute_profits: {
        Args: {
          p_distribution_date?: string
          p_fiscal_period_id: string
          p_notes?: string
          p_tenant_id: string
          p_total_amount: number
        }
        Returns: Json
      }
      edit_invoice:
        | {
            Args: { _customer_id: string; _invoice_id: string; _items: Json }
            Returns: undefined
          }
        | {
            Args: {
              _customer_id: string
              _invoice_id: string
              _items: Json
              _vat_rate?: number
            }
            Returns: undefined
          }
        | {
            Args: {
              _customer_id: string
              _discount_amount?: number
              _invoice_id: string
              _items: Json
              _vat_rate?: number
            }
            Returns: undefined
          }
      edit_invoice_payment: {
        Args: {
          p_amount: number
          p_fee_amount?: number
          p_fee_on_customer?: boolean
          p_payment_id: string
          p_payment_method: string
          p_reason?: string
          p_received_by_name?: string
          p_reference_number?: string
          p_transfer_from_account?: string
          p_transfer_to_account?: string
        }
        Returns: string
      }
      edit_payment_transaction: {
        Args: {
          p_amount: number
          p_fee_amount?: number
          p_payment_method: string
          p_reason?: string
          p_received_by_name?: string
          p_reference_number?: string
          p_transfer_from_account?: string
          p_transfer_to_account?: string
          p_tx_id: string
        }
        Returns: string
      }
      edit_shipment: {
        Args: { p_header: Json; p_items: Json; p_shipment_id: string }
        Returns: Json
      }
      edit_voucher:
        | {
            Args: {
              p_amount: number
              p_category_id: string
              p_description?: string
              p_edit_reason?: string
              p_fee_amount?: number
              p_party_id?: string
              p_party_name?: string
              p_party_type?: Database["public"]["Enums"]["voucher_party_type"]
              p_payment_method: string
              p_reference_number?: string
              p_transferred_to?: string
              p_voucher_date: string
              p_voucher_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_amount: number
              p_category_id: string
              p_description?: string
              p_edit_reason?: string
              p_fee_amount?: number
              p_party_id?: string
              p_party_name?: string
              p_party_type?: Database["public"]["Enums"]["voucher_party_type"]
              p_payment_method: string
              p_reference_number?: string
              p_transferred_from?: string
              p_transferred_to?: string
              p_voucher_date: string
              p_voucher_id: string
            }
            Returns: Json
          }
      expire_old_reservations: { Args: never; Returns: number }
      generate_alerts: {
        Args: never
        Returns: {
          low_stock_count: number
          overdue_count: number
        }[]
      }
      get_available_quantity: {
        Args: { p_branch_id: string; p_product_id: string }
        Returns: number
      }
      get_bank_reconciliation_summary: {
        Args: {
          p_bank_account_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: Json
      }
      get_branch_financial_position: {
        Args: { _branch_id: string; _from?: string; _to?: string }
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
      get_budget_variance: {
        Args: { _fiscal_period_id: string }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          account_type: string
          actual_amount: number
          planned_amount: number
          variance: number
          variance_pct: number
        }[]
      }
      get_financial_kpis: {
        Args: { _end_date: string; _start_date: string }
        Returns: Json
      }
      get_open_shift: {
        Args: { p_branch_id: string }
        Returns: {
          branch_id: string
          cash_sales: number | null
          cashier_id: string
          close_notes: string | null
          closed_at: string | null
          closed_by: string | null
          closing_cash: number | null
          created_at: string
          expected_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          variance: number | null
        }
        SetofOptions: {
          from: "*"
          to: "cashier_shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_opening_balances: { Args: never; Returns: Json }
      get_partner_net_balance: { Args: { p_partner_id: string }; Returns: Json }
      get_product_references_count: {
        Args: { _product_id: string }
        Returns: Json
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
      is_owner:
        | { Args: { _user_id: string }; Returns: boolean }
        | { Args: { _tenant_id: string; _user_id: string }; Returns: boolean }
      is_partner_owner: { Args: { _partner_id: string }; Returns: boolean }
      is_personal_owner: { Args: never; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      map_treasury_to_category_key: {
        Args: { _t: Database["public"]["Tables"]["treasury"]["Row"] }
        Returns: string
      }
      mark_overdue_installments: { Args: never; Returns: number }
      mark_partner_advance_installments_overdue: {
        Args: never
        Returns: number
      }
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
      open_cashier_shift: {
        Args: { p_branch_id: string; p_notes?: string; p_opening_cash: number }
        Returns: {
          branch_id: string
          cash_sales: number | null
          cashier_id: string
          close_notes: string | null
          closed_at: string | null
          closed_by: string | null
          closing_cash: number | null
          created_at: string
          expected_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          variance: number | null
        }
        SetofOptions: {
          from: "*"
          to: "cashier_shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      partial_confirm_transfer: {
        Args: { p_received: number; p_transfer_id: string }
        Returns: Json
      }
      partner_withdraw_from_distribution: {
        Args: {
          p_amount: number
          p_date?: string
          p_notes?: string
          p_partner_id: string
          p_tenant_id: string
        }
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
      peek_product_fifo_cost: {
        Args: { _branch_id: string; _product_id: string; _quantity: number }
        Returns: number
      }
      personal_access_level: { Args: { _owner: string }; Returns: string }
      post_invoice_cogs: { Args: { p_invoice_id: string }; Returns: undefined }
      post_journal: {
        Args: {
          p_description: string
          p_entry_date: string
          p_lines: Json
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: string
      }
      post_monthly_depreciation: {
        Args: { _period_month: string; _tenant_id: string }
        Returns: {
          amount: number
          asset_id: string
          journal_entry_id: string
        }[]
      }
      post_opening_balances: {
        Args: {
          p_cash?: Json
          p_contacts?: Json
          p_date: string
          p_inventory?: Json
        }
        Returns: Json
      }
      preview_flexible_distribution: {
        Args: {
          p_amount?: number
          p_from: string
          p_tenant_id: string
          p_to: string
        }
        Returns: Json
      }
      process_sale:
        | {
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
        | {
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
              p_vat_amount?: number
              p_vat_rate?: number
            }
            Returns: string
          }
      recalc_contact_balance: {
        Args: { p_contact_id: string }
        Returns: undefined
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
          p_invoice_id?: string
          p_notes?: string
          p_payment_method: string
          p_received_by_name: string
          p_reference_number: string
          p_transfer_from_account?: string
          p_transfer_to_account: string
        }
        Returns: string
      }
      record_partner_advance_payment: {
        Args: {
          _advance_id: string
          _amount: number
          _notes?: string
          _payment_date?: string
          _payment_method?: string
          _reference_id?: string
          _reference_type?: string
        }
        Returns: string
      }
      record_partner_transaction: {
        Args: {
          _amount: number
          _description?: string
          _month_year?: string
          _partner_id: string
          _transaction_type: string
          _treasury_id?: string
          _voucher_id?: string
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
      record_shipment: {
        Args: { p_header: Json; p_lines: Json }
        Returns: Json
      }
      redistribute_installments_after_return: {
        Args: { _invoice_id: string }
        Returns: Json
      }
      register_sale_return: {
        Args: {
          _invoice_id: string
          _items: Json
          _notes?: string
          _reason?: string
          _refund_method?: string
        }
        Returns: string
      }
      register_sale_return_full: {
        Args: {
          _invoice_id: string
          _items: Json
          _notes: string
          _reason: string
          _refund_account: string
          _refund_balance_amount: number
          _refund_cash_amount: number
          _refund_method: string
          _refund_reference: string
          _refund_transfer_amount: number
          _status: string
        }
        Returns: Json
      }
      reject_transfer: { Args: { p_transfer_id: string }; Returns: Json }
      reject_transfer_group: { Args: { p_group: string }; Returns: number }
      reject_treasury_transfer: {
        Args: { p_reason: string; p_transfer_id: string }
        Returns: undefined
      }
      release_reservation: {
        Args: { p_id: string; p_status?: string }
        Returns: undefined
      }
      release_reservations_for_draft: {
        Args: { p_draft_id: string; p_status?: string }
        Returns: undefined
      }
      repost_invoice_journal: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      request_void_payment_transaction: {
        Args: { p_reason: string; p_tx_id: string }
        Returns: Json
      }
      reserve_stock: {
        Args: {
          p_branch_id: string
          p_cashier_name?: string
          p_draft_id: string
          p_product_id: string
          p_quantity: number
        }
        Returns: Json
      }
      restore_batches_from_item: {
        Args: { _invoice_item_id: string }
        Returns: undefined
      }
      restore_invoice_batches: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      restore_product: { Args: { _product_id: string }; Returns: undefined }
      reverse_journal_for_source: {
        Args: {
          p_reason: string
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      reverse_profit_distribution: {
        Args: {
          p_distribution_id: string
          p_reason?: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      run_shift_maintenance: {
        Args: never
        Returns: {
          auto_closed: number
          reminded: number
          warned: number
        }[]
      }
      safe_delete_product: { Args: { _product_id: string }; Returns: undefined }
      seed_default_chart_of_accounts: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_voucher_categories: { Args: { _tenant: string }; Returns: undefined }
      set_scheduled_reports_cron: {
        Args: { _day: number; _hour: number }
        Returns: undefined
      }
      shift_cash_movement: { Args: { p_shift_id: string }; Returns: number }
      shift_cash_sales: { Args: { p_shift_id: string }; Returns: number }
      system_health_check: { Args: never; Returns: Json }
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
      update_product_price_with_reason: {
        Args: {
          _cost_price?: number
          _market_price?: number
          _product_id: string
          _reason?: string
          _selling_price?: number
        }
        Returns: undefined
      }
      upsert_inventory_counts: {
        Args: { _items: Json; _session_id: string }
        Returns: number
      }
      user_in_branch: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      verify_employee_password: {
        Args: { _employee_id: string; _password: string }
        Returns: boolean
      }
      void_invoice_payment: {
        Args: { p_payment_id: string; p_reason?: string }
        Returns: string
      }
      void_payment_transaction: {
        Args: { p_reason?: string; p_tx_id: string }
        Returns: string
      }
    }
    Enums: {
      account_type: "asset" | "liability" | "equity" | "revenue" | "expense"
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
        | "partner"
        | "owner"
      approval_action: "delete" | "update"
      approval_status: "pending" | "approved" | "rejected"
      invoice_status: "active" | "cancelled"
      normal_balance: "debit" | "credit"
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
      account_type: ["asset", "liability", "equity", "revenue", "expense"],
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
        "partner",
        "owner",
      ],
      approval_action: ["delete", "update"],
      approval_status: ["pending", "approved", "rejected"],
      invoice_status: ["active", "cancelled"],
      normal_balance: ["debit", "credit"],
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
