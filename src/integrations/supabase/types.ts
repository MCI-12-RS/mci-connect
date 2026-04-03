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
          id: string
          member_id: string
          report_id: string
        }
        Insert: {
          id?: string
          member_id: string
          report_id: string
        }
        Update: {
          id?: string
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
            foreignKeyName: "cell_report_participants_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "cell_reports"
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
          name: string
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
          name: string
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
          name?: string
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
            foreignKeyName: "cells_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_timothy_id_fkey"
            columns: ["timothy_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          auth_user_id: string | null
          baptism_date: string | null
          birth_date: string | null
          city: string | null
          complement: string | null
          cpf: string | null
          created_at: string
          email: string | null
          g12_level: number
          gender: string | null
          has_leadership: boolean
          id: string
          is_active: boolean
          is_baptized: boolean
          is_pastor: boolean
          leader_id: string | null
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
          baptism_date?: string | null
          birth_date?: string | null
          city?: string | null
          complement?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          g12_level?: number
          gender?: string | null
          has_leadership?: boolean
          id?: string
          is_active?: boolean
          is_baptized?: boolean
          is_pastor?: boolean
          leader_id?: string | null
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
          baptism_date?: string | null
          birth_date?: string | null
          city?: string | null
          complement?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          g12_level?: number
          gender?: string | null
          has_leadership?: boolean
          id?: string
          is_active?: boolean
          is_baptized?: boolean
          is_pastor?: boolean
          leader_id?: string | null
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
      [_ in never]: never
    }
    Functions: {
      can_manage_own_cell: {
        Args: { _cell_id: string; _user_id: string }
        Returns: boolean
      }
      get_ministry_root: { Args: { _member_id: string }; Returns: string }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_in_same_ministry: {
        Args: { _target_member_id: string; _user_id: string }
        Returns: boolean
      }
      user_has_permission: {
        Args: {
          _permission: Database["public"]["Enums"]["permission_action"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
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
      ],
    },
  },
} as const
