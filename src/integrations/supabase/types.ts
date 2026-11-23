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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      cell_report_participants: {
        Row: {
          member_id: string
          report_id: string
        }
        Insert: {
          member_id: string
          report_id: string
        }
        Update: {
          member_id?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cell_report_participants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_report_participants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_report_participants_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "cell_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_report_participants_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "cell_reports_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cell_reports: {
        Row: {
          cell_id: string
          created_at: string
          date: string
          id: string
          observations: string | null
          offering: number | null
          reason_not_held: string | null
          theme: string | null
          time: string
          updated_at: string
          visitors: string[] | null
          was_held: boolean
        }
        Insert: {
          cell_id: string
          created_at?: string
          date: string
          id?: string
          observations?: string | null
          offering?: number | null
          reason_not_held?: string | null
          theme?: string | null
          time: string
          updated_at?: string
          visitors?: string[] | null
          was_held?: boolean
        }
        Update: {
          cell_id?: string
          created_at?: string
          date?: string
          id?: string
          observations?: string | null
          offering?: number | null
          reason_not_held?: string | null
          theme?: string | null
          time?: string
          updated_at?: string
          visitors?: string[] | null
          was_held?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cell_reports_cell_id_fkey"
            columns: ["cell_id"]
            isOneToOne: false
            referencedRelation: "cells"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_reports_cell_id_fkey"
            columns: ["cell_id"]
            isOneToOne: false
            referencedRelation: "cells_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cells: {
        Row: {
          city: string | null
          complement: string | null
          created_at: string
          host_id: string | null
          id: string
          is_active: boolean
          leader_id: string | null
          meeting_day: string | null
          meeting_time: string | null
          neighborhood: string | null
          number: string | null
          state: string | null
          street: string | null
          timothy_id: string | null
          type: string
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          city?: string | null
          complement?: string | null
          created_at?: string
          host_id?: string | null
          id?: string
          is_active?: boolean
          leader_id?: string | null
          meeting_day?: string | null
          meeting_time?: string | null
          neighborhood?: string | null
          number?: string | null
          state?: string | null
          street?: string | null
          timothy_id?: string | null
          type?: string
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          city?: string | null
          complement?: string | null
          created_at?: string
          host_id?: string | null
          id?: string
          is_active?: boolean
          leader_id?: string | null
          meeting_day?: string | null
          meeting_time?: string | null
          neighborhood?: string | null
          number?: string | null
          state?: string | null
          street?: string | null
          timothy_id?: string | null
          type?: string
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cells_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_timothy_id_fkey"
            columns: ["timothy_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_timothy_id_fkey"
            columns: ["timothy_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          action: Database["public"]["Enums"]["event_action"]
          actor_label: string | null
          actor_user_id: string | null
          changed_fields: string[] | null
          description: string
          entity: Database["public"]["Enums"]["event_entity"]
          entity_id: string | null
          entity_label: string | null
          error_reason: string | null
          id: string
          metadata: Json | null
          occurred_at: string
          success: boolean
        }
        Insert: {
          action: Database["public"]["Enums"]["event_action"]
          actor_label?: string | null
          actor_user_id?: string | null
          changed_fields?: string[] | null
          description: string
          entity: Database["public"]["Enums"]["event_entity"]
          entity_id?: string | null
          entity_label?: string | null
          error_reason?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          success?: boolean
        }
        Update: {
          action?: Database["public"]["Enums"]["event_action"]
          actor_label?: string | null
          actor_user_id?: string | null
          changed_fields?: string[] | null
          description?: string
          entity?: Database["public"]["Enums"]["event_entity"]
          entity_id?: string | null
          entity_label?: string | null
          error_reason?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          success?: boolean
        }
        Relationships: []
      }
      members: {
        Row: {
          auth_user_id: string | null
          avatar_url: string | null
          baptism_date: string | null
          birth_date: string | null
          city: string | null
          complement: string | null
          cpf: string | null
          created_at: string
          email: string | null
          female_cells: number | null
          g12_level: number
          gender: string | null
          has_leadership: boolean
          id: string
          instagram: string | null
          is_active: boolean
          is_baptized: boolean
          is_pastor: boolean
          leader_id: string | null
          male_cells: number | null
          mobile_whatsapp: string | null
          name: string
          neighborhood: string | null
          notes: string | null
          number: string | null
          phone: string | null
          role_id: string | null
          spouse_id: string | null
          state: string | null
          street: string | null
          total_cells: number
          total_disciples: number
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          auth_user_id?: string | null
          avatar_url?: string | null
          baptism_date?: string | null
          birth_date?: string | null
          city?: string | null
          complement?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          female_cells?: number | null
          g12_level?: number
          gender?: string | null
          has_leadership?: boolean
          id?: string
          instagram?: string | null
          is_active?: boolean
          is_baptized?: boolean
          is_pastor?: boolean
          leader_id?: string | null
          male_cells?: number | null
          mobile_whatsapp?: string | null
          name: string
          neighborhood?: string | null
          notes?: string | null
          number?: string | null
          phone?: string | null
          role_id?: string | null
          spouse_id?: string | null
          state?: string | null
          street?: string | null
          total_cells?: number
          total_disciples?: number
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          auth_user_id?: string | null
          avatar_url?: string | null
          baptism_date?: string | null
          birth_date?: string | null
          city?: string | null
          complement?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          female_cells?: number | null
          g12_level?: number
          gender?: string | null
          has_leadership?: boolean
          id?: string
          instagram?: string | null
          is_active?: boolean
          is_baptized?: boolean
          is_pastor?: boolean
          leader_id?: string | null
          male_cells?: number | null
          mobile_whatsapp?: string | null
          name?: string
          neighborhood?: string | null
          notes?: string | null
          number?: string | null
          phone?: string | null
          role_id?: string | null
          spouse_id?: string | null
          state?: string | null
          street?: string | null
          total_cells?: number
          total_disciples?: number
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_spouse_id_fkey"
            columns: ["spouse_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_spouse_id_fkey"
            columns: ["spouse_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          id: string
          permission: Database["public"]["Enums"]["permission_action"]
          role_id: string
        }
        Insert: {
          id?: string
          permission: Database["public"]["Enums"]["permission_action"]
          role_id: string
        }
        Update: {
          id?: string
          permission?: Database["public"]["Enums"]["permission_action"]
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          is_system: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          is_system?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          is_system?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      cell_report_participants_view: {
        Row: {
          member_id: string | null
          member_name: string | null
          report_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cell_report_participants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_report_participants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_report_participants_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "cell_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_report_participants_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "cell_reports_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cell_reports_view: {
        Row: {
          cell_complement: string | null
          cell_host_id: string | null
          cell_id: string | null
          cell_is_active: boolean | null
          cell_leader_id: string | null
          cell_leader_name: string | null
          cell_meeting_day: string | null
          cell_meeting_time: string | null
          cell_neighborhood: string | null
          cell_number: string | null
          cell_street: string | null
          cell_timothy_id: string | null
          cell_type: string | null
          created_at: string | null
          date: string | null
          id: string | null
          observations: string | null
          offering: number | null
          participants_count: number | null
          reason_not_held: string | null
          search_text: string | null
          theme: string | null
          time: string | null
          updated_at: string | null
          visitors: string[] | null
          visitors_count: number | null
          was_held: boolean | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cell_reports_cell_id_fkey"
            columns: ["cell_id"]
            isOneToOne: false
            referencedRelation: "cells"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_reports_cell_id_fkey"
            columns: ["cell_id"]
            isOneToOne: false
            referencedRelation: "cells_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_host_id_fkey"
            columns: ["cell_host_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_host_id_fkey"
            columns: ["cell_host_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_leader_id_fkey"
            columns: ["cell_leader_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_leader_id_fkey"
            columns: ["cell_leader_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_timothy_id_fkey"
            columns: ["cell_timothy_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_timothy_id_fkey"
            columns: ["cell_timothy_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cells_view: {
        Row: {
          city: string | null
          complement: string | null
          created_at: string | null
          g12_leader_id: string | null
          g12_leader_name: string | null
          host_id: string | null
          host_name: string | null
          id: string | null
          is_active: boolean | null
          last_report_date: string | null
          leader_g12_level: number | null
          leader_gender: string | null
          leader_id: string | null
          leader_name: string | null
          meeting_day: string | null
          meeting_time: string | null
          meeting_weekday: number | null
          neighborhood: string | null
          number: string | null
          search_text: string | null
          state: string | null
          street: string | null
          timothy_id: string | null
          timothy_name: string | null
          type: string | null
          updated_at: string | null
          zip_code: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cells_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_timothy_id_fkey"
            columns: ["timothy_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_timothy_id_fkey"
            columns: ["timothy_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
        ]
      }
      members_view: {
        Row: {
          attended_last_30_days: boolean | null
          auth_user_id: string | null
          avatar_url: string | null
          baptism_date: string | null
          birth_date: string | null
          city: string | null
          complement: string | null
          cpf: string | null
          created_at: string | null
          email: string | null
          female_cells: number | null
          g12_level: number | null
          gender: string | null
          has_leadership: boolean | null
          id: string | null
          instagram: string | null
          is_active: boolean | null
          is_baptized: boolean | null
          is_cell_host: boolean | null
          is_cell_leader: boolean | null
          is_cell_timothy: boolean | null
          is_pastor: boolean | null
          leader_id: string | null
          leader_name: string | null
          male_cells: number | null
          mobile_whatsapp: string | null
          name: string | null
          neighborhood: string | null
          notes: string | null
          number: string | null
          phone: string | null
          role_id: string | null
          search_text: string | null
          sensitive_visible: boolean | null
          spouse_id: string | null
          state: string | null
          street: string | null
          total_cells: number | null
          total_disciples: number | null
          updated_at: string | null
          zip_code: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_spouse_id_fkey"
            columns: ["spouse_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_spouse_id_fkey"
            columns: ["spouse_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _cell_label_by_leader: { Args: { _leader_id: string }; Returns: string }
      _dashboard_assert_access: { Args: never; Returns: undefined }
      _log_event: {
        Args: {
          _action: Database["public"]["Enums"]["event_action"]
          _actor_user_id?: string
          _changed_fields?: string[]
          _description: string
          _entity: Database["public"]["Enums"]["event_entity"]
          _entity_id: string
          _entity_label: string
          _error_reason?: string
          _metadata?: Json
          _success?: boolean
        }
        Returns: undefined
      }
      _mask_identifier: { Args: { _id: string }; Returns: string }
      can_assign_role: { Args: { _role_id: string }; Returns: boolean }
      can_manage_own_cell: {
        Args: { _cell_id: string; _user_id: string }
        Returns: boolean
      }
      dashboard_cells_by_type: {
        Args: never
        Returns: {
          cell_type: string
          total: number
        }[]
      }
      dashboard_g12_ranking: {
        Args: never
        Returns: {
          couple_key: string
          female_cells: number
          male_cells: number
          name: string
          spouse_name: string
          total_cells: number
        }[]
      }
      dashboard_summary: {
        Args: { _at?: string }
        Returns: {
          cells_not_held: number
          cells_pending: number
          members_active: number
          members_baptized: number
          members_inactive: number
          members_not_baptized: number
          members_total: number
          members_without_cell_link: number
          members_without_leader: number
          reports_sent: number
          visitors: number
          week_end: string
          week_start: string
        }[]
      }
      get_ministry_root: { Args: { _member_id: string }; Returns: string }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_in_same_ministry: {
        Args: { _target_member_id: string; _user_id: string }
        Returns: boolean
      }
      is_leader_of_visible_member: {
        Args: { _candidate_id: string; _user_id: string }
        Returns: boolean
      }
      log_auth_event: {
        Args: {
          _action: Database["public"]["Enums"]["event_action"]
          _identifier?: string
          _reason?: string
          _success: boolean
        }
        Returns: undefined
      }
      member_names: {
        Args: { _ids: string[] }
        Returns: {
          id: string
          name: string
        }[]
      }
      ministry_tree_nodes: {
        Args: { _parent_ids?: string[] }
        Returns: {
          direct_disciples: number
          g12_level: number
          is_pastor: boolean
          member_gender: string
          member_id: string
          member_name: string
          spouse_id: string
          spouse_name: string
          total_cells: number
          total_disciples: number
        }[]
      }
      search_normalize: { Args: { _value: string }; Returns: string }
      sp_now: { Args: never; Returns: string }
      sp_today: { Args: never; Returns: string }
      user_has_permission: {
        Args: {
          _permission: Database["public"]["Enums"]["permission_action"]
          _user_id: string
        }
        Returns: boolean
      }
      viewer_has: {
        Args: { _permission: Database["public"]["Enums"]["permission_action"] }
        Returns: boolean
      }
      viewer_member_id: { Args: never; Returns: string }
      viewer_ministry_member_ids: { Args: never; Returns: string[] }
      week_start: { Args: { _day: string }; Returns: string }
      weekday_index: { Args: { _meeting_day: string }; Returns: number }
    }
    Enums: {
      event_action:
        | "create"
        | "update"
        | "delete"
        | "login"
        | "login_failed"
        | "logout"
        | "password_changed"
      event_entity:
        | "member"
        | "cell"
        | "cell_report"
        | "cell_report_participant"
        | "auth"
      permission_action:
        | "create_member"
        | "view_members"
        | "edit_member"
        | "delete_member"
        | "manage_roles"
        | "view_roles"
        | "view_dashboard"
        | "create_cell"
        | "edit_cell"
        | "delete_cell"
        | "view_all_church"
        | "view_own_ministry"
        | "edit_own_data"
        | "view_own_reports"
        | "view_all_reports"
        | "submit_own_cell_report"
        | "submit_any_visible_report"
        | "assign_role"
        | "view_sensitive_data"
        | "change_member_password"
        | "view_own_ministry_dashboard"
        | "edit_cell_report"
        | "delete_cell_report"
        | "view_audit_log"
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
      event_action: [
        "create",
        "update",
        "delete",
        "login",
        "login_failed",
        "logout",
        "password_changed",
      ],
      event_entity: [
        "member",
        "cell",
        "cell_report",
        "cell_report_participant",
        "auth",
      ],
      permission_action: [
        "create_member",
        "view_members",
        "edit_member",
        "delete_member",
        "manage_roles",
        "view_roles",
        "view_dashboard",
        "create_cell",
        "edit_cell",
        "delete_cell",
        "view_all_church",
        "view_own_ministry",
        "edit_own_data",
        "view_own_reports",
        "view_all_reports",
        "submit_own_cell_report",
        "submit_any_visible_report",
        "assign_role",
        "view_sensitive_data",
        "change_member_password",
        "view_own_ministry_dashboard",
        "edit_cell_report",
        "delete_cell_report",
        "view_audit_log",
      ],
    },
  },
} as const

