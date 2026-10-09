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
      ai_ask_log: {
        Row: {
          answer: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          question: string | null
          rows_returned: number | null
          sql_text: string | null
          steps: Json | null
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          answer?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          question?: string | null
          rows_returned?: number | null
          sql_text?: string | null
          steps?: Json | null
          tenant_id?: string | null
          user_id?: string
        }
        Update: {
          answer?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          question?: string | null
          rows_returned?: number | null
          sql_text?: string | null
          steps?: Json | null
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: []
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
          auto_checkout: boolean
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
          auto_checkout?: boolean
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
          auto_checkout?: boolean
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
        Relationships: [
          {
            foreignKeyName: "attendance_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
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
          source: string
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
          source?: string
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
          source?: string
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
      backup_settings: {
        Row: {
          created_at: string
          drive_connected: boolean
          drive_file_id: string | null
          drive_file_name: string
          drive_folder_id: string | null
          drive_folder_name: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          refresh_token_encrypted: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          drive_connected?: boolean
          drive_file_id?: string | null
          drive_file_name?: string
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          refresh_token_encrypted?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          drive_connected?: boolean
          drive_file_id?: string | null
          drive_file_name?: string
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          refresh_token_encrypted?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
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
          access_level: string
          branch_id: string
          id: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          access_level?: string
          branch_id: string
          id?: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          access_level?: string
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
          is_system: boolean
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
          is_system?: boolean
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
          is_system?: boolean
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
      brands: {
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
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: []
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
          expected_opening_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          opening_status: string
          overridden_at: string | null
          overridden_by: string | null
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          reported_opening_cash: number | null
          schedule_id: string | null
          soft_close_at: string | null
          soft_closed_at: string | null
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
          expected_opening_cash?: number | null
          id?: string
          open_notes?: string | null
          opened_at?: string
          opening_cash?: number
          opening_status?: string
          overridden_at?: string | null
          overridden_by?: string | null
          pre_close_warned_at?: string | null
          reminder_sent_at?: string | null
          reported_opening_cash?: number | null
          schedule_id?: string | null
          soft_close_at?: string | null
          soft_closed_at?: string | null
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
          expected_opening_cash?: number | null
          id?: string
          open_notes?: string | null
          opened_at?: string
          opening_cash?: number
          opening_status?: string
          overridden_at?: string | null
          overridden_by?: string | null
          pre_close_warned_at?: string | null
          reminder_sent_at?: string | null
          reported_opening_cash?: number | null
          schedule_id?: string | null
          soft_close_at?: string | null
          soft_closed_at?: string | null
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
            foreignKeyName: "cashier_shifts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "shift_schedules"
            referencedColumns: ["id"]
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
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_fk"
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
          email: string | null
          id: string
          is_archived: boolean
          is_migrated: boolean
          merged_into: string | null
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
          email?: string | null
          id?: string
          is_archived?: boolean
          is_migrated?: boolean
          merged_into?: string | null
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
          email?: string | null
          id?: string
          is_archived?: boolean
          is_migrated?: boolean
          merged_into?: string | null
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
          balance_delta: number | null
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
          balance_delta?: number | null
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
          balance_delta?: number | null
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
          notes: string | null
          operating_share: number
          partner_type: string
          partnership_start_date: string | null
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
          notes?: string | null
          operating_share?: number
          partner_type: string
          partnership_start_date?: string | null
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
          notes?: string | null
          operating_share?: number
          partner_type?: string
          partnership_start_date?: string | null
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
      health_check_runs: {
        Row: {
          created_at: string
          details: Json | null
          failure_count: number
          failures: Json
          id: string
          source: string
          status: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          failure_count?: number
          failures?: Json
          id?: string
          source?: string
          status: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          failure_count?: number
          failures?: Json
          id?: string
          source?: string
          status?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      historical_invoice_items: {
        Row: {
          branch_id: string | null
          branch_name: string
          created_at: string | null
          date: string
          discount: number | null
          id: string
          invoice_id: string | null
          item_code: string | null
          item_name: string
          price: number | null
          profit: number | null
          qty: number | null
          tenant_id: string | null
          total: number | null
          unit: string | null
          year: number
        }
        Insert: {
          branch_id?: string | null
          branch_name: string
          created_at?: string | null
          date: string
          discount?: number | null
          id?: string
          invoice_id?: string | null
          item_code?: string | null
          item_name: string
          price?: number | null
          profit?: number | null
          qty?: number | null
          tenant_id?: string | null
          total?: number | null
          unit?: string | null
          year: number
        }
        Update: {
          branch_id?: string | null
          branch_name?: string
          created_at?: string | null
          date?: string
          discount?: number | null
          id?: string
          invoice_id?: string | null
          item_code?: string | null
          item_name?: string
          price?: number | null
          profit?: number | null
          qty?: number | null
          tenant_id?: string | null
          total?: number | null
          unit?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "historical_invoice_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_invoice_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "historical_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "historical_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_invoice_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_invoices: {
        Row: {
          branch_id: string | null
          branch_name: string
          created_at: string | null
          credit: number | null
          date: string
          discount: number | null
          doc_type: string
          due: number | null
          id: string
          invoice_no: string | null
          month: number
          paid_cash: number | null
          party_name: string | null
          payment_method: string | null
          profit: number | null
          returned_invoice_no: string | null
          tenant_id: string | null
          total_amount: number | null
          total_qty: number | null
          warehouse_name: string | null
          year: number
        }
        Insert: {
          branch_id?: string | null
          branch_name: string
          created_at?: string | null
          credit?: number | null
          date: string
          discount?: number | null
          doc_type: string
          due?: number | null
          id?: string
          invoice_no?: string | null
          month: number
          paid_cash?: number | null
          party_name?: string | null
          payment_method?: string | null
          profit?: number | null
          returned_invoice_no?: string | null
          tenant_id?: string | null
          total_amount?: number | null
          total_qty?: number | null
          warehouse_name?: string | null
          year: number
        }
        Update: {
          branch_id?: string | null
          branch_name?: string
          created_at?: string | null
          credit?: number | null
          date?: string
          discount?: number | null
          doc_type?: string
          due?: number | null
          id?: string
          invoice_no?: string | null
          month?: number
          paid_cash?: number | null
          party_name?: string | null
          payment_method?: string | null
          profit?: number | null
          returned_invoice_no?: string | null
          tenant_id?: string | null
          total_amount?: number | null
          total_qty?: number | null
          warehouse_name?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "historical_invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "historical_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_vouchers: {
        Row: {
          amount: number | null
          branch_id: string | null
          branch_name: string
          category: string | null
          created_at: string | null
          date: string
          id: string
          month: number
          movement_name: string | null
          notes: string | null
          party_name: string | null
          tenant_id: string | null
          treasury_name: string | null
          voucher_no: string | null
          voucher_type: string
          year: number
        }
        Insert: {
          amount?: number | null
          branch_id?: string | null
          branch_name: string
          category?: string | null
          created_at?: string | null
          date: string
          id?: string
          month: number
          movement_name?: string | null
          notes?: string | null
          party_name?: string | null
          tenant_id?: string | null
          treasury_name?: string | null
          voucher_no?: string | null
          voucher_type: string
          year: number
        }
        Update: {
          amount?: number | null
          branch_id?: string | null
          branch_name?: string
          category?: string | null
          created_at?: string | null
          date?: string
          id?: string
          month?: number
          movement_name?: string | null
          notes?: string | null
          party_name?: string | null
          tenant_id?: string | null
          treasury_name?: string | null
          voucher_no?: string | null
          voucher_type?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "historical_vouchers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_vouchers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "historical_vouchers_tenant_id_fkey"
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
      inventory_count_batch_moves: {
        Row: {
          batch_id: string
          created_at: string
          created_batch: boolean
          delta: number
          id: string
          product_id: string
          session_id: string
          tenant_id: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_batch?: boolean
          delta: number
          id?: string
          product_id: string
          session_id: string
          tenant_id?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_batch?: boolean
          delta?: number
          id?: string
          product_id?: string
          session_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_batch_moves_session_id_fkey"
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
          brand: string | null
          capacity: string | null
          cashier_id: string | null
          cashier_name: string | null
          color: string | null
          created_at: string
          expires_at: string
          id: string
          invoice_draft_id: string
          model: string | null
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
          brand?: string | null
          capacity?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          color?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invoice_draft_id: string
          model?: string | null
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
          brand?: string | null
          capacity?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          color?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invoice_draft_id?: string
          model?: string | null
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
          brand: string | null
          capacity: string | null
          color: string | null
          created_at: string
          difference: number | null
          id: string
          model: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          model?: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          model?: string | null
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
          brand: string | null
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
          model: string | null
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
          brand?: string | null
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
          model?: string | null
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
          brand?: string | null
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
          model?: string | null
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
            foreignKeyName: "invoice_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
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
          legacy_number: string | null
          migration_batch_id: string | null
          migration_source: string | null
          notes: string | null
          payment_method: string
          previous_balance: number | null
          recipient_name: string | null
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
          legacy_number?: string | null
          migration_batch_id?: string | null
          migration_source?: string | null
          notes?: string | null
          payment_method?: string
          previous_balance?: number | null
          recipient_name?: string | null
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
          legacy_number?: string | null
          migration_batch_id?: string | null
          migration_source?: string | null
          notes?: string | null
          payment_method?: string
          previous_balance?: number | null
          recipient_name?: string | null
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
      ledger_credit_balance_snapshot: {
        Row: {
          contact_id: string
          contact_type: string | null
          ledger_customer_advance: number | null
          ledger_supplier_advance: number | null
          old_credit_balance: number | null
          taken_at: string
          tenant_id: string
        }
        Insert: {
          contact_id: string
          contact_type?: string | null
          ledger_customer_advance?: number | null
          ledger_supplier_advance?: number | null
          old_credit_balance?: number | null
          taken_at?: string
          tenant_id: string
        }
        Update: {
          contact_id?: string
          contact_type?: string | null
          ledger_customer_advance?: number | null
          ledger_supplier_advance?: number | null
          old_credit_balance?: number | null
          taken_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_credit_balance_snapshot_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_credit_balance_snapshot_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
          },
        ]
      }
      ledger_gl_links: {
        Row: {
          created_at: string
          id: number
          journal_id: string
          part: string
          ref_id: string
          ref_type: string
          reversal_journal_id: string | null
          reversed_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          journal_id: string
          part?: string
          ref_id: string
          ref_type: string
          reversal_journal_id?: string | null
          reversed_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: number
          journal_id?: string
          part?: string
          ref_id?: string
          ref_type?: string
          reversal_journal_id?: string | null
          reversed_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_gl_links_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_gl_links_reversal_journal_id_fkey"
            columns: ["reversal_journal_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_gl_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_gl_skipped: {
        Row: {
          created_at: string
          entry_date: string
          id: number
          reason: string
          ref_id: string
          ref_type: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          id?: number
          reason: string
          ref_id: string
          ref_type: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: number
          reason?: string
          ref_id?: string
          ref_type?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ledger_sync_errors: {
        Row: {
          contact_id: string | null
          context: string
          created_at: string
          error: string
          id: number
          invoice_id: string | null
          tenant_id: string | null
        }
        Insert: {
          contact_id?: string | null
          context: string
          created_at?: string
          error: string
          id?: number
          invoice_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          contact_id?: string | null
          context?: string
          created_at?: string
          error?: string
          id?: number
          invoice_id?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      migration_batches: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          docs_failed: number
          docs_ok: number
          docs_total: number
          file_name: string | null
          id: string
          kind: string
          label: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          docs_failed?: number
          docs_ok?: number
          docs_total?: number
          file_name?: string | null
          id?: string
          kind: string
          label: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          docs_failed?: number
          docs_ok?: number
          docs_total?: number
          file_name?: string | null
          id?: string
          kind?: string
          label?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_batches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_batches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
        ]
      }
      money_movements: {
        Row: {
          amount: number
          branch_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          direction: string | null
          effect: string
          id: string
          is_cash: boolean | null
          kind: string
          method: string | null
          movement_date: string
          notes: string | null
          side: string
          source_id: string
          source_table: string
          status: string
          target_doc_id: string | null
          target_doc_type: string | null
          tenant_id: string
          treasury_id: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          effect: string
          id?: string
          is_cash?: boolean | null
          kind: string
          method?: string | null
          movement_date: string
          notes?: string | null
          side: string
          source_id: string
          source_table: string
          status?: string
          target_doc_id?: string | null
          target_doc_type?: string | null
          tenant_id: string
          treasury_id?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          effect?: string
          id?: string
          is_cash?: boolean | null
          kind?: string
          method?: string | null
          movement_date?: string
          notes?: string | null
          side?: string
          source_id?: string
          source_table?: string
          status?: string
          target_doc_id?: string | null
          target_doc_type?: string | null
          tenant_id?: string
          treasury_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "money_movements_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_movements_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "money_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_movements_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasury"
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
      onboarding_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          section_key: string
          skipped: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          section_key: string
          skipped?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          section_key?: string
          skipped?: boolean
          updated_at?: string
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
      owner_personal_deposits: {
        Row: {
          amount: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string | null
          created_at: string
          created_by: string
          deposit_datetime: string
          description: string
          id: string
          notes: string | null
          owner_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          created_at?: string
          created_by?: string
          deposit_datetime?: string
          description?: string
          id?: string
          notes?: string | null
          owner_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          created_at?: string
          created_by?: string
          deposit_datetime?: string
          description?: string
          id?: string
          notes?: string | null
          owner_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      owner_personal_expenses: {
        Row: {
          amount: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string | null
          created_at: string
          created_by: string
          description: string
          expense_datetime: string
          id: string
          notes: string | null
          owner_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          created_at?: string
          created_by?: string
          description: string
          expense_datetime?: string
          id?: string
          notes?: string | null
          owner_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          created_at?: string
          created_by?: string
          description?: string
          expense_datetime?: string
          id?: string
          notes?: string | null
          owner_user_id?: string
          status?: string
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
      payment_allocations: {
        Row: {
          amount: number
          clearing_journal_id: string | null
          contact_id: string | null
          created_at: string
          debt_branch_id: string
          debt_id: string
          debt_type: string
          effective_date: string
          id: string
          is_cross_branch: boolean | null
          mode: string
          movement_branch_id: string
          movement_id: string
          run_id: string
          side: string
          status: string
          superseded_at: string | null
          superseded_by_run: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          clearing_journal_id?: string | null
          contact_id?: string | null
          created_at?: string
          debt_branch_id: string
          debt_id: string
          debt_type: string
          effective_date: string
          id?: string
          is_cross_branch?: boolean | null
          mode: string
          movement_branch_id: string
          movement_id: string
          run_id: string
          side: string
          status?: string
          superseded_at?: string | null
          superseded_by_run?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          clearing_journal_id?: string | null
          contact_id?: string | null
          created_at?: string
          debt_branch_id?: string
          debt_id?: string
          debt_type?: string
          effective_date?: string
          id?: string
          is_cross_branch?: boolean | null
          mode?: string
          movement_branch_id?: string
          movement_id?: string
          run_id?: string
          side?: string
          status?: string
          superseded_at?: string | null
          superseded_by_run?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_clearing_journal_id_fkey"
            columns: ["clearing_journal_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_balances"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "payment_allocations_debt_branch_id_fkey"
            columns: ["debt_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_debt_branch_id_fkey"
            columns: ["debt_branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "payment_allocations_movement_branch_id_fkey"
            columns: ["movement_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_movement_branch_id_fkey"
            columns: ["movement_branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "payment_allocations_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "money_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
            foreignKeyName: "payment_transactions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
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
            foreignKeyName: "payment_transactions_fee_treasury_id_fkey"
            columns: ["fee_treasury_id"]
            isOneToOne: false
            referencedRelation: "treasury"
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
            foreignKeyName: "payment_transactions_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasury"
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
      platform_flags: {
        Row: {
          enabled: boolean
          key: string
          note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          key: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          key?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
          brand: string | null
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
          model: string | null
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
          brand?: string | null
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
          model?: string | null
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
          brand?: string | null
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
          model?: string | null
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
          effective_at: string
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
          effective_at?: string
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
          effective_at?: string
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
          brand: string | null
          capacity: string | null
          category_id: string | null
          color: string | null
          cost_price: number
          created_at: string
          id: string
          image: string | null
          initial_stock_date: string
          is_migrated: boolean
          legacy_code: string | null
          low_stock_alert: number
          market_price: number
          min_stock_level: number
          model: string | null
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
          brand?: string | null
          capacity?: string | null
          category_id?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          image?: string | null
          initial_stock_date?: string
          is_migrated?: boolean
          legacy_code?: string | null
          low_stock_alert?: number
          market_price?: number
          min_stock_level?: number
          model?: string | null
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
          brand?: string | null
          capacity?: string | null
          category_id?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          image?: string | null
          initial_stock_date?: string
          is_migrated?: boolean
          legacy_code?: string | null
          low_stock_alert?: number
          market_price?: number
          min_stock_level?: number
          model?: string | null
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
          period_from: string | null
          period_to: string | null
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
          period_from?: string | null
          period_to?: string | null
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
          period_from?: string | null
          period_to?: string | null
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
          brand: string | null
          capacity: string | null
          color: string | null
          id: string
          model: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          id?: string
          model?: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          id?: string
          model?: string | null
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
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          contact_id: string
          created_at: string
          created_by: string
          id: string
          invoice_date: string
          legacy_number: string | null
          migration_batch_id: string | null
          notes: string | null
          reason: string
          recipient_name: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contact_id: string
          created_at?: string
          created_by: string
          id?: string
          invoice_date?: string
          legacy_number?: string | null
          migration_batch_id?: string | null
          notes?: string | null
          reason: string
          recipient_name?: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string
          id?: string
          invoice_date?: string
          legacy_number?: string | null
          migration_batch_id?: string | null
          notes?: string | null
          reason?: string
          recipient_name?: string | null
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
          brand: string | null
          capacity: string | null
          color: string | null
          id: string
          model: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          id?: string
          model?: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          id?: string
          model?: string | null
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
          brand: string | null
          capacity: string | null
          color: string | null
          id: string
          model: string | null
          product_id: string | null
          product_type: string | null
          quantity: number
          refund: number
          return_id: string
          size: string | null
          tenant_id: string | null
        }
        Insert: {
          brand?: string | null
          capacity?: string | null
          color?: string | null
          id?: string
          model?: string | null
          product_id?: string | null
          product_type?: string | null
          quantity: number
          refund: number
          return_id: string
          size?: string | null
          tenant_id?: string | null
        }
        Update: {
          brand?: string | null
          capacity?: string | null
          color?: string | null
          id?: string
          model?: string | null
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
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          id: string
          invoice_date: string
          invoice_id: string | null
          legacy_number: string | null
          migration_batch_id: string | null
          notes: string | null
          reason: string
          recipient_name: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          invoice_date?: string
          invoice_id?: string | null
          legacy_number?: string | null
          migration_batch_id?: string | null
          notes?: string | null
          reason: string
          recipient_name?: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          invoice_date?: string
          invoice_id?: string | null
          legacy_number?: string | null
          migration_batch_id?: string | null
          notes?: string | null
          reason?: string
          recipient_name?: string | null
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
      sale_requests: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string
          id: string
          invoice_id: string | null
          tenant_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by: string
          id: string
          invoice_id?: string | null
          tenant_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "sale_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_requests_tenant_id_fkey"
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
      security_rpc_allowlist: {
        Row: {
          added_in: string
          function_name: string
          note: string | null
        }
        Insert: {
          added_in: string
          function_name: string
          note?: string | null
        }
        Update: {
          added_in?: string
          function_name?: string
          note?: string | null
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
      shift_cash_handovers: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          created_by: string | null
          from_cashier_id: string
          id: string
          notes: string | null
          occurred_at: string
          shift_id: string
          tenant_id: string
          to_manager_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          created_by?: string | null
          from_cashier_id: string
          id?: string
          notes?: string | null
          occurred_at?: string
          shift_id: string
          tenant_id: string
          to_manager_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          from_cashier_id?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          shift_id?: string
          tenant_id?: string
          to_manager_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_cash_handovers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cashier_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_cash_handovers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_history"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_schedules: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          is_active: boolean
          is_extra: boolean
          shift_date: string | null
          shift_name: string
          start_time: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          is_active?: boolean
          is_extra?: boolean
          shift_date?: string | null
          shift_name: string
          start_time: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          is_active?: boolean
          is_extra?: boolean
          shift_date?: string | null
          shift_name?: string
          start_time?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_schedules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_schedules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          base_unit_price: number
          brand: string | null
          capacity: string | null
          color: string | null
          cost_price: number
          discount_amount: number
          discount_percent: number
          id: string
          model: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          cost_price: number
          discount_amount?: number
          discount_percent?: number
          id?: string
          model?: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          cost_price?: number
          discount_amount?: number
          discount_percent?: number
          id?: string
          model?: string | null
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
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          contact_id: string
          created_at: string
          current_balance: number | null
          customs_cost: number
          discount_amount: number
          discount_type: string
          discount_value: number
          id: string
          invoice_date: string
          is_migrated: boolean
          legacy_number: string | null
          migration_batch_id: string | null
          migration_source: string | null
          notes: string | null
          other_cost: number
          other_cost_description: string | null
          previous_balance: number | null
          received_by: string
          shipment_number: string
          shipping_cost: number
          status: string | null
          tenant_id: string | null
          total_cost: number
          total_extra_costs: number
          vat_amount: number
          vat_type: string
          vat_value: number
        }
        Insert: {
          admin_cost?: number
          arrival_date: string
          branch_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contact_id: string
          created_at?: string
          current_balance?: number | null
          customs_cost?: number
          discount_amount?: number
          discount_type?: string
          discount_value?: number
          id?: string
          invoice_date?: string
          is_migrated?: boolean
          legacy_number?: string | null
          migration_batch_id?: string | null
          migration_source?: string | null
          notes?: string | null
          other_cost?: number
          other_cost_description?: string | null
          previous_balance?: number | null
          received_by: string
          shipment_number?: string
          shipping_cost?: number
          status?: string | null
          tenant_id?: string | null
          total_cost?: number
          total_extra_costs?: number
          vat_amount?: number
          vat_type?: string
          vat_value?: number
        }
        Update: {
          admin_cost?: number
          arrival_date?: string
          branch_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contact_id?: string
          created_at?: string
          current_balance?: number | null
          customs_cost?: number
          discount_amount?: number
          discount_type?: string
          discount_value?: number
          id?: string
          invoice_date?: string
          is_migrated?: boolean
          legacy_number?: string | null
          migration_batch_id?: string | null
          migration_source?: string | null
          notes?: string | null
          other_cost?: number
          other_cost_description?: string | null
          previous_balance?: number | null
          received_by?: string
          shipment_number?: string
          shipping_cost?: number
          status?: string | null
          tenant_id?: string | null
          total_cost?: number
          total_extra_costs?: number
          vat_amount?: number
          vat_type?: string
          vat_value?: number
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
          brand: string | null
          capacity: string | null
          color: string | null
          difference: number
          id: string
          model: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          difference: number
          id?: string
          model?: string | null
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
          brand?: string | null
          capacity?: string | null
          color?: string | null
          difference?: number
          id?: string
          model?: string | null
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
      stock_movements: {
        Row: {
          balance_after: number
          balance_before: number | null
          branch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          movement_date: string
          movement_type: string
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          tenant_id: string | null
        }
        Insert: {
          balance_after: number
          balance_before?: number | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          movement_date?: string
          movement_type: string
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          tenant_id?: string | null
        }
        Update: {
          balance_after?: number
          balance_before?: number | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          movement_date?: string
          movement_type?: string
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          brand: string | null
          capacity: string | null
          color: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          cost_price_at_transfer: number | null
          created_at: string
          from_branch_id: string
          group_id: string | null
          hidden_for_branches: string[]
          id: string
          model: string | null
          notes: string | null
          product_id: string
          product_type: string | null
          quantity: number
          reason: string | null
          received_quantity: number | null
          recipient_name: string | null
          rejection_reason: string | null
          size: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string | null
          to_branch_id: string
          total_value_at_transfer: number | null
          transfer_date: string | null
          transferred_by: string
        }
        Insert: {
          brand?: string | null
          capacity?: string | null
          color?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          cost_price_at_transfer?: number | null
          created_at?: string
          from_branch_id: string
          group_id?: string | null
          hidden_for_branches?: string[]
          id?: string
          model?: string | null
          notes?: string | null
          product_id: string
          product_type?: string | null
          quantity: number
          reason?: string | null
          received_quantity?: number | null
          recipient_name?: string | null
          rejection_reason?: string | null
          size?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string | null
          to_branch_id: string
          total_value_at_transfer?: number | null
          transfer_date?: string | null
          transferred_by: string
        }
        Update: {
          brand?: string | null
          capacity?: string | null
          color?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          cost_price_at_transfer?: number | null
          created_at?: string
          from_branch_id?: string
          group_id?: string | null
          hidden_for_branches?: string[]
          id?: string
          model?: string | null
          notes?: string | null
          product_id?: string
          product_type?: string | null
          quantity?: number
          reason?: string | null
          received_quantity?: number | null
          recipient_name?: string | null
          rejection_reason?: string | null
          size?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string | null
          to_branch_id?: string
          total_value_at_transfer?: number | null
          transfer_date?: string | null
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
            foreignKeyName: "supplier_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_balances"
            referencedColumns: ["branch_id"]
          },
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
          {
            foreignKeyName: "supplier_payments_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasury"
            referencedColumns: ["id"]
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
      system_cron_tokens: {
        Row: {
          created_at: string
          name: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          name: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          name?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
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
          transaction_date: string
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
          transaction_date?: string
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
          transaction_date?: string
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
          dest_credited_at: string | null
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
          dest_credited_at?: string | null
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
          dest_credited_at?: string | null
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
      user_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          permission_key: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_key: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_key?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          is_added_to_profit: boolean
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
          is_added_to_profit?: boolean
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
          is_added_to_profit?: boolean
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
          flow_class: string | null
          id: string
          party_id: string | null
          party_name: string | null
          party_type: Database["public"]["Enums"]["voucher_party_type"] | null
          payment_method: string
          recipient_name: string | null
          reference_number: string | null
          source: Database["public"]["Enums"]["voucher_source"]
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["voucher_status"]
          tenant_id: string
          transferred_from: string | null
          transferred_to: string | null
          treasury_id: string
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
          flow_class?: string | null
          id?: string
          party_id?: string | null
          party_name?: string | null
          party_type?: Database["public"]["Enums"]["voucher_party_type"] | null
          payment_method: string
          recipient_name?: string | null
          reference_number?: string | null
          source: Database["public"]["Enums"]["voucher_source"]
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["voucher_status"]
          tenant_id: string
          transferred_from?: string | null
          transferred_to?: string | null
          treasury_id: string
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
          flow_class?: string | null
          id?: string
          party_id?: string | null
          party_name?: string | null
          party_type?: Database["public"]["Enums"]["voucher_party_type"] | null
          payment_method?: string
          recipient_name?: string | null
          reference_number?: string | null
          source?: Database["public"]["Enums"]["voucher_source"]
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["voucher_status"]
          tenant_id?: string
          transferred_from?: string | null
          transferred_to?: string | null
          treasury_id?: string
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
          {
            foreignKeyName: "vouchers_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasury"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ledger_document_balances: {
        Row: {
          amount: number | null
          branch_id: string | null
          contact_id: string | null
          doc_date: string | null
          doc_id: string | null
          doc_type: string | null
          paid_direct: number | null
          paid_fifo: number | null
          paid_from_other_branches: number | null
          remaining: number | null
          side: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
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
          total_settlement: number | null
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
          closed_by_name: string | null
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
      v_treasury_gl_variance: {
        Row: {
          branch_id: string | null
          branch_name: string | null
          gl_balance: number | null
          tenant_id: string | null
          treasury_balance: number | null
          variance: number | null
        }
        Relationships: []
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
      _void_payment_transaction_exec: {
        Args: { p_reason: string; p_tx_id: string }
        Returns: string
      }
      acknowledge_treasury_transfer: {
        Args: { p_transfer_id: string }
        Returns: undefined
      }
      add_invoice_payment: {
        Args: {
          p_amount: number
          p_fee_amount: number
          p_fee_on_customer: boolean
          p_invoice_id: string
          p_payment_method: string
          p_received_by_name: string
          p_reference_number: string
          p_transfer_from_account: string
          p_transfer_to_account: string
        }
        Returns: string
      }
      admin_reset_branch_data: {
        Args: { p_branch_id: string; p_options: Json }
        Returns: Json
      }
      admin_reset_branch_data_impl: {
        Args: { p_branch_id: string; p_options: Json }
        Returns: Json
      }
      admin_reset_go_live_extras: {
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
      ai_report: { Args: { p_params?: Json; p_report: string }; Returns: Json }
      ai_report_catalog: { Args: never; Returns: Json }
      ai_sql: { Args: { query: string }; Returns: Json }
      allocate_capital_to_branch: {
        Args: {
          _allocation_date?: string
          _amount: number
          _branch_id: string
          _notes?: string
        }
        Returns: string
      }
      apply_customer_credit: {
        Args: {
          p_branch_id: string
          p_contact_id: string
          p_invoice_id?: string
        }
        Returns: number
      }
      apply_low_stock_default: { Args: { p_value: number }; Returns: number }
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
      ask_me_access_level: { Args: { _user_id: string }; Returns: string }
      ask_me_allowed_tables: { Args: { _user_id: string }; Returns: string[] }
      ask_me_schema: {
        Args: never
        Returns: {
          columns: string
          table_name: string
        }[]
      }
      assert_access: {
        Args: { p_branch_id: string; p_permission: string }
        Returns: undefined
      }
      assert_can_edit_invoice: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      assert_can_import_opening_debt: { Args: never; Returns: undefined }
      assert_company_access: { Args: { p_permission: string }; Returns: string }
      assert_same_tenant: { Args: { p_tenant: string }; Returns: undefined }
      available_to_distribute: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: Json
      }
      backup_fetch_page:
        | {
            Args: {
              _limit: number
              _offset: number
              _table: string
              _tenant: string
            }
            Returns: Json
          }
        | {
            Args: {
              _limit: number
              _offset: number
              _order_by?: string
              _table: string
              _tenant: string
            }
            Returns: Json
          }
      backup_table_ctid_check: {
        Args: { _tables: string[] }
        Returns: {
          has_ctid: boolean
          table_name: string
        }[]
      }
      backup_table_manifest: {
        Args: never
        Returns: {
          filter_sql: string
          ord: number
          scope: string
          table_name: string
        }[]
      }
      backup_tenant_filter: {
        Args: { _alias: string; _depth?: number; _table: string }
        Returns: string
      }
      branch_cycle_count_status: {
        Args: { p_branch_id: string; p_stale_days?: number }
        Returns: {
          critical_count: number
          last_session: string
          overdue_count: number
        }[]
      }
      branch_handover_managers: {
        Args: { p_branch_id: string }
        Returns: {
          id: string
          name: string
          role: string
        }[]
      }
      bulk_update_products: {
        Args: { p_ids: string[]; p_patch: Json; p_reason?: string }
        Returns: number
      }
      cairo_today: { Args: never; Returns: string }
      calculate_payment_fee: {
        Args: { p_amount: number; p_method: string }
        Returns: number
      }
      can_access_employee_file: {
        Args: { _object_name: string }
        Returns: boolean
      }
      can_manage_attendance_for: {
        Args: { _target_employee_id: string }
        Returns: boolean
      }
      can_use_ask_me: { Args: { _user_id: string }; Returns: boolean }
      cancel_inventory_session: {
        Args: { p_reason?: string; p_session_id: string }
        Returns: Json
      }
      cancel_invoice_with_refund: {
        Args: { _invoice_id: string; _reason: string; _refund_method?: string }
        Returns: Json
      }
      cancel_partner_advance: {
        Args: { _advance_id: string; _reason?: string }
        Returns: Json
      }
      cancel_personal_entry: {
        Args: { p_id: string; p_kind: string; p_reason: string }
        Returns: undefined
      }
      cancel_pre_order: {
        Args: { p_pre_order_id: string; p_refund: boolean }
        Returns: undefined
      }
      cancel_purchase_invoice: {
        Args: { p_reason: string; p_shipment_id: string }
        Returns: Json
      }
      cancel_purchase_return: {
        Args: { _reason: string; _return_id: string }
        Returns: Json
      }
      cancel_sale_return: {
        Args: { _reason: string; _return_id: string }
        Returns: Json
      }
      cancel_voucher: {
        Args: { p_reason: string; p_voucher_id: string }
        Returns: undefined
      }
      clear_opening_treasury: { Args: never; Returns: number }
      close_cashier_shift: {
        Args: {
          p_auto?: boolean
          p_auto_checkout?: boolean
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
          expected_opening_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          opening_status: string
          overridden_at: string | null
          overridden_by: string | null
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          reported_opening_cash: number | null
          schedule_id: string | null
          soft_close_at: string | null
          soft_closed_at: string | null
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
      close_fiscal_period: {
        Args: { p_period_id: string; p_reason?: string }
        Returns: Json
      }
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
      contact_branch_balances: {
        Args: { p_branch_id: string }
        Returns: {
          balance: number
          contact_id: string
          overdue: number
        }[]
      }
      contact_has_legacy_docs: { Args: { p_contact: string }; Returns: boolean }
      contact_side_balances: {
        Args: { p_branch_id?: string; p_contact_ids: string[] }
        Returns: {
          contact_id: string
          customer_advance: number
          customer_balance: number
          customer_open: number
          customer_overdue: number
          supplier_advance: number
          supplier_balance: number
          supplier_open: number
          supplier_overdue: number
        }[]
      }
      contacts_page: {
        Args: {
          p_balance?: string[]
          p_branch_id: string
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_type?: string
        }
        Returns: Json
      }
      create_contact_credit_deposit: {
        Args: {
          p_amount: number
          p_contact_id: string
          p_description?: string
          p_method: string
          p_reference_number?: string
          p_transferred_from?: string
          p_transferred_to?: string
          p_voucher_date?: string
        }
        Returns: string
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
      create_partner_from_employee: {
        Args: {
          _capital_share: number
          _employee_id: string
          _initial_capital: number
          _notes?: string
          _operating_share: number
          _partner_type: string
          _start_date?: string
        }
        Returns: string
      }
      create_payment_plan: {
        Args: {
          p_existing_plan_id?: string
          p_fee_on_customer?: boolean
          p_installments?: Json
          p_plan_type?: string
          p_reference_id: string
          p_reference_type: string
          p_total: number
        }
        Returns: string
      }
      create_pre_order: {
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
        Args: { p_initial_stock_date?: string; p_product: Json }
        Returns: Json
      }
      create_purchase_return: {
        Args: { p_header: Json; p_items: Json }
        Returns: Json
      }
      create_stock_adjustment: {
        Args: {
          p_branch_id: string
          p_lines: Json
          p_notes: string
          p_reason: string
        }
        Returns: Json
      }
      current_shift_schedule: {
        Args: { p_at?: string; p_branch_id: string }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          is_active: boolean
          is_extra: boolean
          shift_date: string | null
          shift_name: string
          start_time: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_shift_schedule__unguarded: {
        Args: { p_at?: string; p_branch_id: string }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          is_active: boolean
          is_extra: boolean
          shift_date: string | null
          shift_name: string
          start_time: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_tenant_active: { Args: never; Returns: boolean }
      current_tenant_id: { Args: never; Returns: string }
      current_tenant_is_suspended: { Args: never; Returns: boolean }
      decide_payment_void_request: {
        Args: { p_approve: boolean; p_note?: string; p_request_id: string }
        Returns: Json
      }
      delete_contact: { Args: { p_id: string }; Returns: undefined }
      delete_products: { Args: { p_ids: string[] }; Returns: number }
      detect_anomalies: { Args: never; Returns: number }
      detect_anomalies__unguarded: { Args: never; Returns: number }
      detect_orphaned_batches: {
        Args: never
        Returns: {
          orphan_batches: number
          orphan_quantity_remaining: number
          product_id: string
          product_name: string
        }[]
      }
      detect_orphaned_batches__unguarded: {
        Args: never
        Returns: {
          orphan_batches: number
          orphan_quantity_remaining: number
          product_id: string
          product_name: string
        }[]
      }
      disburse_employee_advance: {
        Args: {
          p_amount: number
          p_employee_id: string
          p_fee_amount?: number
          p_monthly_deduct: number
          p_payment_method?: string
          p_reason?: string
          p_reference_number?: string
          p_transfer_from_account?: string
          p_transfer_to_account?: string
        }
        Returns: Json
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
          p_period_from?: string
          p_period_to?: string
          p_tenant_id: string
          p_total_amount: number
        }
        Returns: Json
      }
      doc_ledger_allocation: {
        Args: {
          p_as_of?: string
          p_branch_id: string
          p_cash_only?: boolean
          p_contact_ids: string[]
          p_kind: string
        }
        Returns: {
          amount: number
          contact_id: string
          doc_date: string
          doc_id: string
          paid: number
          remaining: number
        }[]
      }
      edit_invoice: {
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
          p_fee_amount: number
          p_fee_on_customer: boolean
          p_payment_id: string
          p_payment_method: string
          p_reason: string
          p_received_by_name: string
          p_reference_number: string
          p_transfer_from_account: string
          p_transfer_to_account: string
        }
        Returns: string
      }
      edit_partner_transaction: {
        Args: {
          _amount: number
          _created_at?: string
          _description?: string
          _month_year?: string
          _transaction_type: string
          _tx_id: string
        }
        Returns: undefined
      }
      edit_payment_transaction: {
        Args: {
          p_amount: number
          p_fee_amount: number
          p_payment_method: string
          p_reason: string
          p_received_by_name: string
          p_reference_number: string
          p_transfer_from_account: string
          p_transfer_to_account: string
          p_tx_id: string
        }
        Returns: string
      }
      edit_shipment: {
        Args: { p_header: Json; p_items: Json; p_shipment_id: string }
        Returns: Json
      }
      edit_voucher: {
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
      effective_permission: {
        Args: { _key: string; _uid: string }
        Returns: boolean
      }
      enforce_cycle_counts: { Args: { p_stale_days?: number }; Returns: number }
      ensure_account: {
        Args: {
          _code: string
          _name: string
          _tenant: string
          _type: Database["public"]["Enums"]["account_type"]
        }
        Returns: string
      }
      ensure_count_variance_accounts: {
        Args: { p_tenant: string }
        Returns: undefined
      }
      expected_opening_cash: { Args: { p_branch_id: string }; Returns: number }
      expected_opening_cash__unguarded: {
        Args: { p_branch_id: string }
        Returns: number
      }
      expire_old_reservations: { Args: never; Returns: number }
      finalize_sale_pricing: {
        Args: { p_discount_request_ids?: string[]; p_invoice_id: string }
        Returns: number
      }
      generate_alerts: {
        Args: never
        Returns: {
          low_stock_count: number
          overdue_count: number
        }[]
      }
      generate_alerts__unguarded: {
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
      get_available_quantity__unguarded: {
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
      get_bank_reconciliation_summary__unguarded: {
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
          other_balance: number
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
      get_budget_variance__unguarded: {
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
          expected_opening_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          opening_status: string
          overridden_at: string | null
          overridden_by: string | null
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          reported_opening_cash: number | null
          schedule_id: string | null
          soft_close_at: string | null
          soft_closed_at: string | null
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
      get_owner_expense_delegates: {
        Args: never
        Returns: {
          can_edit: boolean
          can_view: boolean
          created_at: string
          email: string
          full_name: string
          granted_user_id: string
        }[]
      }
      get_partner_net_balance: { Args: { p_partner_id: string }; Returns: Json }
      get_product_references_count: {
        Args: { _product_id: string }
        Returns: Json
      }
      get_product_references_count__unguarded: {
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
      guard_admin: { Args: never; Returns: boolean }
      guard_company_object: {
        Args: { p_admin_only?: boolean; p_tenant: string }
        Returns: boolean
      }
      guard_is_system_call: { Args: never; Returns: boolean }
      guard_read_branch: { Args: { p_branch: string }; Returns: boolean }
      guard_read_product: {
        Args: { p_permission?: string; p_product: string }
        Returns: boolean
      }
      guard_read_shift: { Args: { p_shift: string }; Returns: boolean }
      has_central_access: { Args: { _uid: string }; Returns: boolean }
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
      hide_rejected_transfer: {
        Args: { _branch_id: string; _transfer_id: string }
        Returns: undefined
      }
      historical_branch_id_for: { Args: { p_name: string }; Returns: string }
      historical_stock_at: {
        Args: { _as_of: string; _branch_id: string }
        Returns: {
          name: string
          product_id: string
          quantity_at_date: number
          sku: string
        }[]
      }
      historical_stock_at__unguarded: {
        Args: { _as_of: string; _branch_id: string }
        Returns: {
          name: string
          product_id: string
          quantity_at_date: number
          sku: string
        }[]
      }
      import_opening_debt: {
        Args: {
          p_batch_id?: string
          p_branch_id: string
          p_contact_id: string
          p_date: string
          p_kind: string
          p_legacy_number: string
          p_notes?: string
          p_paid: number
          p_total: number
        }
        Returns: Json
      }
      invoice_outstanding_debt: {
        Args: { _exclude_return_id?: string; _invoice_id: string }
        Returns: number
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_owner: { Args: { _user_id: string }; Returns: boolean }
      is_partner_owner: { Args: { _partner_id: string }; Returns: boolean }
      is_personal_owner: { Args: never; Returns: boolean }
      is_return_canceller: {
        Args: { _tenant: string; _uid: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_viewer: { Args: { _user_id: string }; Returns: boolean }
      ledger_aging: {
        Args: { p_as_of?: string; p_branch_id?: string; p_side: string }
        Returns: {
          advance: number
          contact_id: string
          contact_name: string
          contact_type: string
          d0_30: number
          d120_plus: number
          d31_60: number
          d61_90: number
          d91_120: number
          oldest_date: string
          total_open: number
        }[]
      }
      ledger_allocate: {
        Args: {
          p_contact: string
          p_invoice?: string
          p_side: string
          p_tenant: string
        }
        Returns: Json
      }
      ledger_archive_cancel_lines: {
        Args: { p_invoice: string }
        Returns: Json
      }
      ledger_archive_cancel_parts: {
        Args: { p_invoice: string }
        Returns: {
          branch_id: string
          cancel_day: string
          cash: number
          contact_id: string
          forfeit: number
          invoice_number: string
          j: number
          net: number
          r1200: number
          tenant_id: string
          vat: number
        }[]
      }
      ledger_archive_due_at_cutoff: {
        Args: { p_invoice: string }
        Returns: number
      }
      ledger_archive_paid_in_ledger: {
        Args: { p_invoice: string }
        Returns: number
      }
      ledger_archive_shipment_due: {
        Args: { p_shipment: string }
        Returns: {
          due: number
        }[]
      }
      ledger_archive_shipment_parts: {
        Args: { p_shipment: string }
        Returns: {
          branch_id: string
          cancel_day: string
          contact_id: string
          due: number
          inc: number
          k: number
          paid_before: number
        }[]
      }
      ledger_backfill: { Args: { p_tenant?: string }; Returns: Json }
      ledger_can_see_side: { Args: { p_side: string }; Returns: boolean }
      ledger_cash_account: { Args: { p_method: string }; Returns: string }
      ledger_contact_documents: {
        Args: {
          p_as_of?: string
          p_branch_id?: string
          p_contact: string
          p_side: string
        }
        Returns: {
          branch_id: string
          branch_name: string
          cancel_reason: string
          doc_date: string
          doc_id: string
          doc_number: string
          doc_type: string
          paid_by_returns: number
          paid_from_other_branches: number
          paid_money: number
          remaining: number
          state: string
          total: number
        }[]
      }
      ledger_contact_money: {
        Args: { p_branch_id?: string; p_contact: string; p_side: string }
        Returns: {
          allocated: number
          amount: number
          branch_id: string
          branch_name: string
          cancel_reason: string
          effect: string
          kind: string
          kind_label: string
          method: string
          movement_date: string
          movement_id: string
          reference: string
          source_id: string
          source_table: string
          status: string
          target_doc_number: string
          unallocated: number
          used_in_other_branches: number
        }[]
      }
      ledger_contact_overview: {
        Args: { p_branch_id?: string; p_contact: string }
        Returns: Json
      }
      ledger_contact_side_balance: {
        Args: { p_contact: string; p_side: string }
        Returns: number
      }
      ledger_contact_statement: {
        Args: {
          p_branch_id?: string
          p_contact: string
          p_from?: string
          p_side: string
          p_to?: string
        }
        Returns: {
          balance: number
          branch_id: string
          branch_name: string
          credit: number
          debit: number
          description: string
          doc_id: string
          doc_type: string
          line_date: string
          line_no: number
          line_type: string
          reference: string
        }[]
      }
      ledger_contact_tenant_check: {
        Args: { p_contact: string; p_tenant: string }
        Returns: undefined
      }
      ledger_credit_rows: {
        Args: { p_contact?: string; p_tenant: string }
        Returns: {
          allocated: number
          amount: number
          branch_id: string
          contact_id: string
          created_at: string
          kind: string
          movement_date: string
          movement_id: string
          side: string
          unallocated: number
          used_in_other_branches: number
        }[]
      }
      ledger_cutoff: { Args: never; Returns: string }
      ledger_day: { Args: { ts: string }; Returns: string }
      ledger_debt_rows: {
        Args: { p_contact?: string; p_tenant: string }
        Returns: {
          allocated: number
          amount: number
          branch_id: string
          contact_id: string
          created_at: string
          debt_id: string
          debt_type: string
          doc_date: string
          paid_by_returns: number
          paid_from_other_branches: number
          remaining: number
          side: string
        }[]
      }
      ledger_desired_movements: {
        Args: { p_contact: string }
        Returns: {
          amount: number
          branch_id: string
          effect: string
          fallback_branch: boolean
          kind: string
          method: string
          movement_date: string
          side: string
          source_id: string
          source_table: string
          target_doc_id: string
          target_doc_type: string
          treasury_id: string
        }[]
      }
      ledger_doc_open: {
        Args: { p_doc_id: string; p_doc_type: string }
        Returns: number
      }
      ledger_doc_paid: {
        Args: { p_doc_id: string; p_doc_type: string }
        Returns: Record<string, unknown>
      }
      ledger_document_status: {
        Args: { p_as_of?: string; p_doc_type: string; p_ids: string[] }
        Returns: {
          doc_id: string
          paid: number
          paid_by_returns: number
          paid_from_other_branches: number
          paid_money: number
          remaining: number
          state: string
          total: number
        }[]
      }
      ledger_effective_date: {
        Args: { p_day: string; p_tenant: string }
        Returns: string
      }
      ledger_fallback_branch: {
        Args: { p_contact: string; p_tenant: string }
        Returns: string
      }
      ledger_gl_backfill: { Args: { p_tenant?: string }; Returns: Json }
      ledger_gl_post: {
        Args: {
          p_branch: string
          p_day: string
          p_desc: string
          p_lines: Json
          p_source_id: string
          p_source_type: string
          p_tenant: string
        }
        Returns: string
      }
      ledger_gl_reconciliation: { Args: { p_tenant?: string }; Returns: Json }
      ledger_gl_retire_old: { Args: { p_tenant: string }; Returns: Json }
      ledger_gl_reverse: {
        Args: { p_journal: string; p_reason: string }
        Returns: string
      }
      ledger_gl_sync: {
        Args: { p_contact: string; p_invoice?: string; p_tenant: string }
        Returns: Json
      }
      ledger_invoice_is_archive: {
        Args: {
          p_batch: string
          p_created_at: string
          p_doc_date: string
          p_is_migrated: boolean
        }
        Returns: boolean
      }
      ledger_ip_is_voided_mirror: { Args: { p_ip: string }; Returns: boolean }
      ledger_kind_label: {
        Args: { p_effect: string; p_kind: string; p_side: string }
        Returns: string
      }
      ledger_mirror_credit_balance: {
        Args: { p_contact: string }
        Returns: number
      }
      ledger_money_flow: {
        Args: {
          p_branch_id: string
          p_contact?: string
          p_from?: string
          p_side: string
          p_to?: string
        }
        Returns: {
          method: string
          money_in: number
          money_out: number
          movements: number
        }[]
      }
      ledger_movement_ref: {
        Args: { p_source_id: string; p_source_table: string }
        Returns: string
      }
      ledger_old_entry_is_contact_money: {
        Args: { p_journal: string }
        Returns: boolean
      }
      ledger_opening_branch: {
        Args: { p_contact: string; p_tenant: string }
        Returns: string
      }
      ledger_opening_branch_is_fallback: {
        Args: { p_contact: string; p_tenant: string }
        Returns: boolean
      }
      ledger_overdue_rows: {
        Args: { p_branch?: string; p_contact?: string; p_tenant: string }
        Returns: {
          contact_id: string
          overdue: number
          side: string
        }[]
      }
      ledger_period_closed: {
        Args: { p_day: string; p_tenant: string }
        Returns: boolean
      }
      ledger_position: { Args: { p_branch_id?: string }; Returns: Json }
      ledger_read_scope: {
        Args: { p_branch: string; p_side: string }
        Returns: string
      }
      ledger_reconciliation: {
        Args: { p_tenant?: string }
        Returns: {
          c_advance_use_rows: number
          c_before_cutoff: number
          c_cancel_cash_refunds: number
          c_credit_use_not_money: number
          c_deposits_now_counted: number
          c_netting_settlement: number
          c_opening_without_branch: number
          c_plan_payments_now_counted: number
          c_voided_plan_mirrors: number
          contact_id: string
          contact_name: string
          contact_type: string
          difference: number
          fallback_branch_rows: number
          new_balance: number
          old_balance: number
          old_prepaid_credit: number
          side: string
          tenant_id: string
          unexplained: number
        }[]
      }
      ledger_reconciliation_summary: {
        Args: { p_tenant?: string }
        Returns: Json
      }
      ledger_refresh_contact: {
        Args: { p_contact: string }
        Returns: undefined
      }
      ledger_side_advance: {
        Args: { p_contact: string; p_side: string }
        Returns: number
      }
      ledger_side_balances: {
        Args: { p_branch?: string; p_contact?: string; p_tenant: string }
        Returns: {
          advance: number
          balance: number
          contact_id: string
          open_docs: number
          open_remaining: number
          side: string
        }[]
      }
      ledger_simulate_as_of: {
        Args: {
          p_as_of: string
          p_contact: string
          p_invoice?: string
          p_side: string
          p_tenant: string
        }
        Returns: {
          allocated: number
          amount: number
          branch_id: string
          by_returns: number
          debt_id: string
          debt_type: string
          doc_date: string
          from_other_branches: number
          remaining: number
          row_kind: string
        }[]
      }
      ledger_sync_contact: { Args: { p_contact: string }; Returns: Json }
      ledger_sync_safe: {
        Args: { p_contact: string; p_context: string; p_invoice: string }
        Returns: undefined
      }
      ledger_sync_walkin: { Args: { p_invoice: string }; Returns: Json }
      ledger_voucher_is_contact_money: {
        Args: { p_voucher: string }
        Returns: boolean
      }
      log_audit_event: {
        Args: {
          p_action: string
          p_branch_id?: string
          p_details?: Json
          p_entity: string
          p_entity_id?: string
        }
        Returns: string
      }
      manage_owner_expense_access: {
        Args: {
          allow_edit: boolean
          allow_view: boolean
          target_user_id: string
        }
        Returns: undefined
      }
      map_treasury_to_category_key: {
        Args: { _t: Database["public"]["Tables"]["treasury"]["Row"] }
        Returns: string
      }
      mark_invoice_migrated: {
        Args: {
          p_batch_id: string
          p_invoice_date: string
          p_invoice_id: string
          p_legacy_number: string
          p_notes?: string
          p_source: string
        }
        Returns: undefined
      }
      mark_overdue_installments: { Args: never; Returns: number }
      mark_partner_advance_installments_overdue: {
        Args: never
        Returns: number
      }
      next_branch_code: { Args: never; Returns: string }
      next_invoice_number: { Args: never; Returns: string }
      next_journal_number: {
        Args: { p_entry_date: string; p_tenant_id: string }
        Returns: string
      }
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
      normalize_ar_name: { Args: { t: string }; Returns: string }
      normalize_search_text: { Args: { p: string }; Returns: string }
      notify_tenant_admins: {
        Args: {
          p_body: string
          p_dedupe_hours?: number
          p_entity?: string
          p_entity_id?: string
          p_link?: string
          p_roles?: Database["public"]["Enums"]["app_role"][]
          p_tenant_id: string
          p_title: string
          p_type?: string
        }
        Returns: number
      }
      open_cashier_shift: {
        Args: {
          p_auto_attendance?: boolean
          p_branch_id: string
          p_notes?: string
          p_opening_cash: number
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
          expected_opening_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          opening_status: string
          overridden_at: string | null
          overridden_by: string | null
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          reported_opening_cash: number | null
          schedule_id: string | null
          soft_close_at: string | null
          soft_closed_at: string | null
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
      open_cashier_shift_secure: {
        Args: {
          p_auto_attendance?: boolean
          p_branch_id: string
          p_notes?: string
          p_reported_cash: number
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
          expected_opening_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          opening_status: string
          overridden_at: string | null
          overridden_by: string | null
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          reported_opening_cash: number | null
          schedule_id: string | null
          soft_close_at: string | null
          soft_closed_at: string | null
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
      opening_balances_reconciliation: {
        Args: never
        Returns: {
          contact_id: string
          contact_name: string
          contact_type: string
          ledger_advance_now: number
          old_prepaid_credit: number
          opening_in_contact: number
          opening_in_ledger: number
          side: string
          status: string
        }[]
      }
      opening_balances_summary: { Args: never; Returns: Json }
      opening_entry_section: { Args: { p_entry: string }; Returns: string }
      opening_section_key: {
        Args: { p_branch?: string; p_section: string; p_tenant: string }
        Returns: string
      }
      override_shift_opening: {
        Args: { p_note?: string; p_shift_id: string }
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
          expected_opening_cash: number | null
          id: string
          open_notes: string | null
          opened_at: string
          opening_cash: number
          opening_status: string
          overridden_at: string | null
          overridden_by: string | null
          pre_close_warned_at: string | null
          reminder_sent_at: string | null
          reported_opening_cash: number | null
          schedule_id: string | null
          soft_close_at: string | null
          soft_closed_at: string | null
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
      pay_employee_salary: {
        Args: {
          p_advance_deduct?: number
          p_bonuses?: number
          p_deductions?: number
          p_employee_id: string
          p_fee_amount?: number
          p_month: string
          p_notes?: string
          p_payment_method?: string
          p_reference_number?: string
          p_transfer_from_account?: string
          p_transfer_to_account?: string
        }
        Returns: string
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
      personal_identity: { Args: never; Returns: string }
      personal_ledger_owner_id: { Args: never; Returns: string }
      personal_owner_info: {
        Args: never
        Returns: {
          access: string
          owner_id: string
          owner_name: string
        }[]
      }
      plan_recompute: {
        Args: { p_extra_paid?: number; p_plan: string }
        Returns: number
      }
      plan_recompute_supplier_spread: {
        Args: { p_contact: string }
        Returns: undefined
      }
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
      post_journal_lines: {
        Args: {
          _branch_id?: string
          _date: string
          _description: string
          _lines: Json
          _source_id: string
          _source_type: string
          _tenant: string
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
      post_voucher_journal: {
        Args: { p_voucher_id: string }
        Returns: undefined
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
      preview_flexible_distribution__unguarded: {
        Args: {
          p_amount?: number
          p_from: string
          p_tenant_id: string
          p_to: string
        }
        Returns: Json
      }
      process_sale: {
        Args: {
          p_branch_id: string
          p_customer_id: string
          p_discount_amount: number
          p_discount_percent: number
          p_discount_reason: string
          p_invoice_date?: string
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
      process_sale_full: {
        Args: {
          p_branch_id: string
          p_credit_to_apply?: number
          p_customer_id: string
          p_discount_amount: number
          p_discount_percent: number
          p_discount_reason: string
          p_invoice_date: string
          p_items: Json
          p_notes?: string
          p_payment_method: string
          p_payments: Json
          p_received_by_name?: string
          p_recipient?: string
          p_subtotal: number
          p_total: number
          p_vat_amount: number
          p_vat_rate: number
        }
        Returns: string
      }
      process_sale_once: {
        Args: {
          p_branch_id: string
          p_client_request_id: string
          p_credit_to_apply?: number
          p_customer_id: string
          p_discount_amount: number
          p_discount_percent: number
          p_discount_reason: string
          p_invoice_date: string
          p_items: Json
          p_notes?: string
          p_payment_method: string
          p_payments: Json
          p_received_by_name?: string
          p_recipient?: string
          p_subtotal: number
          p_total: number
          p_vat_amount: number
          p_vat_rate: number
        }
        Returns: string
      }
      purge_ai_ask_log: { Args: never; Returns: number }
      purge_orphan_journal_entries: {
        Args: { p_tenant: string }
        Returns: number
      }
      rebalance_partner_shares: {
        Args: { _pending_capital?: number; _tenant_id?: string }
        Returns: Json
      }
      recalc_contact_balance: {
        Args: { p_contact_id: string }
        Returns: undefined
      }
      recompute_contact_credit: {
        Args: { p_contact_id: string }
        Returns: number
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
      record_mid_shift_handover: {
        Args: {
          p_amount_received?: number
          p_manager_id?: string
          p_notes?: string
          p_shift_id: string
        }
        Returns: {
          amount: number
          branch_id: string
          created_at: string
          created_by: string | null
          from_cashier_id: string
          id: string
          notes: string | null
          occurred_at: string
          shift_id: string
          tenant_id: string
          to_manager_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift_cash_handovers"
          isOneToOne: true
          isSetofReturn: false
        }
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
          p_payment_date?: string
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
        Args: { p_header: Json; p_lines: Json; p_plan?: Json }
        Returns: Json
      }
      record_shipment_with_credit: {
        Args: { p_header: Json; p_lines: Json; p_plan?: Json }
        Returns: Json
      }
      redistribute_installments_after_return: {
        Args: { _invoice_id: string }
        Returns: Json
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
      reject_transfer: {
        Args: { p_reason?: string; p_transfer_id: string }
        Returns: Json
      }
      reject_transfer_group:
        | { Args: { p_group: string }; Returns: number }
        | { Args: { p_group: string; p_reason?: string }; Returns: number }
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
      restore_product__unguarded: {
        Args: { _product_id: string }
        Returns: undefined
      }
      restore_tenant_snapshot: {
        Args: { _payload: Json; _tenant: string }
        Returns: Json
      }
      reverse_journal_for_source: {
        Args: {
          p_reason: string
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      reverse_opening_entry: {
        Args: { p_entry: string; p_reason: string }
        Returns: string
      }
      reverse_profit_distribution: {
        Args: {
          p_distribution_id: string
          p_reason?: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      revoke_owner_expense_access: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      role_permission_default: {
        Args: { p_key: string; p_role: string }
        Returns: boolean
      }
      run_regression_checks: { Args: { p_source?: string }; Returns: string }
      run_shift_maintenance: {
        Args: never
        Returns: {
          auto_closed: number
          reminded: number
          warned: number
        }[]
      }
      safe_delete_product: { Args: { _product_id: string }; Returns: undefined }
      save_contact: { Args: { p_data: Json; p_id: string }; Returns: Json }
      save_personal_entry: {
        Args: { p_data: Json; p_id: string; p_kind: string }
        Returns: string
      }
      search_branch_contacts: {
        Args: {
          p_branch_id: string
          p_ids?: string[]
          p_kind?: string
          p_limit?: number
          p_query?: string
        }
        Returns: {
          branch_id: string
          id: string
          name: string
          phone: string
          type: string
        }[]
      }
      security_exposed_definer_functions: {
        Args: never
        Returns: {
          function_signature: string
        }[]
      }
      seed_default_chart_of_accounts: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_voucher_categories: { Args: { _tenant: string }; Returns: undefined }
      set_document_annotations: {
        Args: {
          p_id: string
          p_kind: string
          p_notes: string
          p_recipient: string
        }
        Returns: undefined
      }
      set_invoice_meta: {
        Args: {
          p_invoice_date?: string
          p_invoice_id: string
          p_notes?: string
        }
        Returns: {
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
          legacy_number: string | null
          migration_batch_id: string | null
          migration_source: string | null
          notes: string | null
          payment_method: string
          previous_balance: number | null
          recipient_name: string | null
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
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_partner_capital: {
        Args: { _amount: number; _partner_id: string; _rebalance?: boolean }
        Returns: Json
      }
      set_scheduled_reports_cron: {
        Args: { _day: number; _hour: number }
        Returns: undefined
      }
      set_transfer_group_date: {
        Args: { p_date: string; p_group_id: string }
        Returns: Json
      }
      settle_contact_invoices_sovereign: {
        Args: {
          p_contact_id: string
          p_payment_amount: number
          p_payment_method: string
          p_receiving_branch_id: string
          p_selected_invoices?: Json
          p_settlement_type?: string
        }
        Returns: Json
      }
      shift_cash_movement: { Args: { p_shift_id: string }; Returns: number }
      shift_cash_sales: { Args: { p_shift_id: string }; Returns: number }
      shift_cash_sales__unguarded: {
        Args: { p_shift_id: string }
        Returns: number
      }
      shift_handovers: {
        Args: { p_shift_id: string }
        Returns: {
          amount: number
          cashier_name: string
          from_cashier_id: string
          id: string
          manager_name: string
          notes: string
          occurred_at: string
          shift_id: string
          to_manager_id: string
        }[]
      }
      shift_payment_breakdown: {
        Args: { p_shift_id: string }
        Returns: {
          payment_method: string
          payments_count: number
          total: number
        }[]
      }
      shift_payment_breakdown__unguarded: {
        Args: { p_shift_id: string }
        Returns: {
          payment_method: string
          payments_count: number
          total: number
        }[]
      }
      shift_planned_end: { Args: { p_shift_id: string }; Returns: string }
      shift_sale_gate: {
        Args: { p_branch_id: string }
        Returns: {
          allowed: boolean
          minutes_left: number
          opening_status: string
          reason: string
          shift_id: string
        }[]
      }
      stock_balance_as_of: {
        Args: { _as_of: string; _branch_id: string; _product_id: string }
        Returns: number
      }
      stock_mv_ctx: {
        Args: {
          _date: string
          _prod: string
          _ref: string
          _ref_type: string
          _type: string
        }
        Returns: undefined
      }
      super_tenants_monthly_profit: { Args: { p_month: string }; Returns: Json }
      supplier_outstanding_payable: {
        Args: { _contact_id: string }
        Returns: number
      }
      sync_invoice_cash_treasury: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      sync_purchase_return_journal: {
        Args: { p_return_id: string }
        Returns: undefined
      }
      sync_sale_return_journal: {
        Args: { p_return_id: string }
        Returns: undefined
      }
      sync_shipment_journal: {
        Args: { p_shipment_id: string }
        Returns: undefined
      }
      system_health_check: { Args: never; Returns: Json }
      system_integrity_audit: {
        Args: { p_tenant?: string }
        Returns: {
          amount: number
          area: string
          branch_id: string
          branch_name: string
          check_code: string
          contact_id: string
          contact_name: string
          details: string
          doc_id: string
          doc_number: string
          doc_type: string
          severity: string
          title: string
        }[]
      }
      system_integrity_audit_gl: {
        Args: { p_tenant: string }
        Returns: {
          amount: number
          area: string
          branch_id: string
          branch_name: string
          check_code: string
          contact_id: string
          contact_name: string
          details: string
          doc_id: string
          doc_number: string
          doc_type: string
          severity: string
          title: string
        }[]
      }
      system_integrity_audit_json: {
        Args: { p_tenant?: string }
        Returns: Json
      }
      system_integrity_summary: { Args: { p_tenant?: string }; Returns: Json }
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
      transfer_stock_multi_atomic:
        | {
            Args: {
              p_from_branch: string
              p_items: Json
              p_reason: string
              p_to_branch: string
            }
            Returns: string
          }
        | {
            Args: {
              p_from_branch: string
              p_items: Json
              p_reason: string
              p_to_branch: string
              p_transfer_date: string
            }
            Returns: string
          }
      transfer_treasury_atomic: {
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
      update_invoice_date_sovereign: {
        Args: { p_invoice_id: string; p_new_date: string; p_reason?: string }
        Returns: Json
      }
      update_product_details: {
        Args: { p_id: string; p_patch: Json }
        Returns: undefined
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
      update_return_sovereign: {
        Args: {
          p_date: string
          p_kind: string
          p_notes: string
          p_return_id: string
        }
        Returns: undefined
      }
      update_shipment_date: {
        Args: { p_new_date: string; p_reason?: string; p_shipment_id: string }
        Returns: Json
      }
      upsert_inventory_counts: {
        Args: { _items: Json; _session_id: string }
        Returns: number
      }
      user_can_write_branch: {
        Args: { p_branch_id: string; p_user_id: string }
        Returns: boolean
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
        Args: { p_payment_id: string; p_reason: string }
        Returns: string
      }
      void_payment_transaction: {
        Args: { p_reason: string; p_tx_id: string }
        Returns: string
      }
      voucher_flow_class_of: {
        Args: {
          p_category_id: string
          p_party_type: string
          p_source_type: string
          p_treasury_id: string
          p_type: string
        }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
