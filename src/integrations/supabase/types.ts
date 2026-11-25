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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "cell_reports_deleted_view"
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
          deleted_at: string | null
          deleted_by: string | null
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
          deleted_at?: string | null
          deleted_by?: string | null
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
          deleted_at?: string | null
          deleted_by?: string | null
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
            referencedRelation: "cells_deleted_view"
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
            foreignKeyName: "cell_reports_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_reports_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_deleted_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_reports_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cells: {
        Row: {
          city: string | null
          complement: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
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
          deleted_at?: string | null
          deleted_by?: string | null
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
          deleted_at?: string | null
          deleted_by?: string | null
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
            foreignKeyName: "cells_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_deleted_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          gender: string
          has_leadership: boolean
          id: string
          instagram: string | null
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
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          gender: string
          has_leadership: boolean
          id?: string
          instagram?: string | null
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
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          gender?: string
          has_leadership?: boolean
          id?: string
          instagram?: string | null
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
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_deleted_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "members_deleted_view"
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
            foreignKeyName: "members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles_view"
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
            referencedRelation: "members_deleted_view"
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
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles_view"
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
          member_deleted: boolean | null
          member_id: string | null
          member_name: string | null
          member_visible: boolean | null
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "cell_reports_deleted_view"
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
      cell_reports_deleted_view: {
        Row: {
          cell_deleted: boolean | null
          cell_id: string | null
          cell_leader_id: string | null
          cell_leader_name: string | null
          date: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_by_name: string | null
          id: string | null
          reason_not_held: string | null
          search_text: string | null
          theme: string | null
          time: string | null
          was_held: boolean | null
          week_start: string | null
          week_taken: boolean | null
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
            referencedRelation: "cells_deleted_view"
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
            foreignKeyName: "cell_reports_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_reports_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_deleted_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_reports_deleted_by_fkey"
            columns: ["deleted_by"]
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
            referencedRelation: "members_deleted_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_leader_id_fkey"
            columns: ["cell_leader_id"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
        ]
      }
      cell_reports_view: {
        Row: {
          cell_complement: string | null
          cell_deleted: boolean | null
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
            referencedRelation: "cells_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
      cells_deleted_view: {
        Row: {
          city: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_by_name: string | null
          host_deleted: boolean | null
          host_id: string | null
          host_name: string | null
          id: string | null
          is_active: boolean | null
          leader_deleted: boolean | null
          leader_id: string | null
          leader_name: string | null
          meeting_day: string | null
          meeting_time: string | null
          meeting_weekday: number | null
          neighborhood: string | null
          number: string | null
          search_text: string | null
          street: string | null
          timothy_deleted: boolean | null
          timothy_id: string | null
          timothy_name: string | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cells_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_deleted_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cells_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
      cells_view: {
        Row: {
          can_submit_report: boolean | null
          city: string | null
          complement: string | null
          created_at: string | null
          g12_leader_id: string | null
          g12_leader_name: string | null
          host_id: string | null
          host_name: string | null
          id: string | null
          is_active: boolean | null
          is_mine: boolean | null
          last_report_date: string | null
          leader_g12_level: number | null
          leader_gender: string | null
          leader_id: string | null
          leader_is_pastor: boolean | null
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
      members_deleted_view: {
        Row: {
          city: string | null
          cpf: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_by_name: string | null
          email: string | null
          gender: string | null
          has_account: boolean | null
          id: string | null
          is_active: boolean | null
          is_pastor: boolean | null
          leader_deleted: boolean | null
          leader_id: string | null
          leader_name: string | null
          mobile_whatsapp: string | null
          name: string | null
          neighborhood: string | null
          restore_role_name: string | null
          role_id: string | null
          role_name: string | null
          role_reset_on_restore: boolean | null
          search_text: string | null
          sensitive_visible: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "members_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_deleted_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members_view"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "members_deleted_view"
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
            foreignKeyName: "members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles_view"
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
          g12_id: string | null
          g12_level: number | null
          g12_name: string | null
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
          password_reset_status: string | null
          phone: string | null
          role_id: string | null
          search_text: string | null
          sensitive_visible: boolean | null
          spouse_id: string | null
          spouse_name: string | null
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
            referencedRelation: "members_deleted_view"
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
            referencedRelation: "members_deleted_view"
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
      roles_view: {
        Row: {
          description: string | null
          id: string | null
          is_default: boolean | null
          is_protected: boolean | null
          members_count: number | null
          name: string | null
          permissions: Database["public"]["Enums"]["permission_action"][] | null
          updated_at: string | null
        }
        Insert: {
          description?: string | null
          id?: string | null
          is_default?: boolean | null
          is_protected?: boolean | null
          members_count?: never
          name?: string | null
          permissions?: never
          updated_at?: string | null
        }
        Update: {
          description?: string | null
          id?: string | null
          is_default?: boolean | null
          is_protected?: boolean | null
          members_count?: never
          name?: string | null
          permissions?: never
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _assert_admin_remains: {
        Args: { _member_id: string }
        Returns: undefined
      }
      _cell_label_by_leader: { Args: { _leader_id: string }; Returns: string }
      _dashboard_assert_access: { Args: never; Returns: undefined }
      _del_lock_cell_week: {
        Args: { _cell_id: string; _date: string }
        Returns: undefined
      }
      _del_lock_members: {
        Args: { _actor: string; _target: string }
        Returns: undefined
      }
      _del_member_blockers: { Args: { _member_id: string }; Returns: Json }
      _del_raise: {
        Args: { _code: string; _detail?: Json; _message: string }
        Returns: undefined
      }
      _del_resume_access: { Args: { _member_id: string }; Returns: undefined }
      _del_suspend_access: {
        Args: { _auth_user_id: string; _member_id: string }
        Returns: undefined
      }
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
      _member_values_in_use: {
        Args: {
          _cpf: string
          _email: string
          _lock?: boolean
          _mobile: string
          _self: string
        }
        Returns: string[]
      }
      _viewer_scope_anchors: {
        Args: never
        Returns: {
          g12: string
          g12_spouse: string
          me: string
          me_spouse: string
        }[]
      }
      active_permissions: {
        Args: never
        Returns: Database["public"]["Enums"]["permission_action"][]
      }
      birth_date_problem: {
        Args: { _birth: string; _today: string }
        Returns: string
      }
      can_assign_role: { Args: { _role_id: string }; Returns: boolean }
      can_submit_report: { Args: { _cell_id: string }; Returns: boolean }
      cell_in_viewer_ministry: { Args: { _cell_id: string }; Returns: boolean }
      change_own_password: {
        Args: {
          _auth_user_id: string
          _confirmation: string
          _current_password: string
          _mode: string
          _new_password: string
          _origin: string
          _request_id: string
          _session_id: string
        }
        Returns: Json
      }
      check_member_deletion: { Args: { _member_id: string }; Returns: Json }
      check_member_insert: { Args: { _member: Json }; Returns: undefined }
      check_password_policy: {
        Args: {
          _birth_date: string
          _cpf: string
          _email: string
          _mobile: string
          _password: string
        }
        Returns: string
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
      default_role_id: { Args: never; Returns: string }
      delete_cell: { Args: { _cell_id: string }; Returns: undefined }
      delete_cell_report: { Args: { _report_id: string }; Returns: undefined }
      delete_member: { Args: { _member_id: string }; Returns: undefined }
      delete_role: { Args: { _role_id: string }; Returns: undefined }
      find_deleted_member_matches: {
        Args: { _cpf: string; _email: string; _mobile: string }
        Returns: {
          deleted_at: string
          is_account_email: boolean
          matched_fields: string[]
          member_id: string
          name: string
        }[]
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_placeholder_email: { Args: { _email: string }; Returns: boolean }
      is_valid_cpf: { Args: { _digits: string }; Returns: boolean }
      is_valid_email: { Args: { _email: string }; Returns: boolean }
      is_valid_person_name: { Args: { _name: string }; Returns: boolean }
      log_auth_event: {
        Args: {
          _action: Database["public"]["Enums"]["event_action"]
          _identifier?: string
          _reason?: string
          _success: boolean
        }
        Returns: undefined
      }
      member_account_email: { Args: { _member_id: string }; Returns: string }
      member_descendants_among: {
        Args: { _candidate_ids: string[]; _member_id: string }
        Returns: string[]
      }
      member_has_login_identifier: {
        Args: { _cpf: string; _email: string; _mobile: string }
        Returns: boolean
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
          kind: string
          level_gender: string
          level_is_pastor: boolean
          level_member_id: string
          member_gender: string
          member_id: string
          member_name: string
          spouse_id: string
          spouse_is_pastor: boolean
          spouse_name: string
          total_cells: number
          total_disciples: number
        }[]
      }
      mobile_match_key: { Args: { _value: string }; Returns: string }
      my_access: {
        Args: never
        Returns: {
          can_assign_roles: boolean
          can_create_member: boolean
          can_submit_some_report: boolean
          member_id: string
          permissions: Database["public"]["Enums"]["permission_action"][]
          role_id: string
          role_is_protected: boolean
          role_name: string
          sees_ministry: boolean
          sees_ministry_reports: boolean
          sees_whole_church: boolean
          sees_whole_church_reports: boolean
        }[]
      }
      my_password_status: {
        Args: never
        Returns: {
          must_change_password: boolean
        }[]
      }
      normalize_digits: { Args: { _value: string }; Returns: string }
      normalize_email: { Args: { _value: string }; Returns: string }
      normalize_mobile: { Args: { _value: string }; Returns: string }
      normalize_person_name: { Args: { _name: string }; Returns: string }
      placeholder_email_domain: { Args: never; Returns: string }
      placeholder_email_domains: { Args: never; Returns: string[] }
      reset_member_password: { Args: { _member_id: string }; Returns: Json }
      restore_cell: { Args: { _cell_id: string }; Returns: undefined }
      restore_cell_report: { Args: { _report_id: string }; Returns: undefined }
      restore_member: {
        Args: { _member_id: string }
        Returns: {
          previous_leader_name: string
          restored_without_leader: boolean
          role_name: string
          role_reset_to_default: boolean
        }[]
      }
      role_effective_permissions: {
        Args: { _role_id: string }
        Returns: Database["public"]["Enums"]["permission_action"][]
      }
      role_options: { Args: { _member_id?: string }; Returns: Json }
      save_role: {
        Args: {
          _description: string
          _expected_updated_at?: string
          _is_default: boolean
          _name: string
          _permissions: Database["public"]["Enums"]["permission_action"][]
          _role_id: string
        }
        Returns: string
      }
      search_normalize: { Args: { _value: string }; Returns: string }
      set_cell_report_participants: {
        Args: { _member_ids: string[]; _report_id: string }
        Returns: undefined
      }
      set_initial_password: {
        Args: {
          _auth_user_id: string
          _birth_date: string
          _cpf: string
          _email: string
          _member_id: string
          _mobile: string
          _password: string
        }
        Returns: undefined
      }
      sign_in_attempt: {
        Args: { _identifier: string; _origin: string; _password: string }
        Returns: Json
      }
      sign_in_discard_link: {
        Args: { _auth_user_id: string }
        Returns: undefined
      }
      sign_in_record_login: {
        Args: {
          _auth_user_id: string
          _identifier_masked: string
          _identifier_type: string
          _member_id: string
        }
        Returns: undefined
      }
      sp_now: { Args: never; Returns: string }
      sp_today: { Args: never; Returns: string }
      user_has_permission: {
        Args: {
          _permission: Database["public"]["Enums"]["permission_action"]
          _user_id: string
        }
        Returns: boolean
      }
      viewer_can_insert_cell: { Args: never; Returns: boolean }
      viewer_can_insert_cell_report: {
        Args: { _cell_id: string }
        Returns: boolean
      }
      viewer_can_insert_cell_report_participant: {
        Args: { _report_id: string }
        Returns: boolean
      }
      viewer_covers_role: { Args: { _role_id: string }; Returns: boolean }
      viewer_has: {
        Args: { _permission: Database["public"]["Enums"]["permission_action"] }
        Returns: boolean
      }
      viewer_is_cell_person: { Args: { _cell_id: string }; Returns: boolean }
      viewer_member_id: { Args: never; Returns: string }
      viewer_ministry_member_ids: { Args: never; Returns: string[] }
      viewer_permissions: {
        Args: never
        Returns: Database["public"]["Enums"]["permission_action"][]
      }
      viewer_scope_contains_any: {
        Args: { _member_ids: string[] }
        Returns: boolean
      }
      viewer_sees_cell: { Args: { _cell_id: string }; Returns: boolean }
      viewer_sees_cell_people: {
        Args: { _host_id: string; _leader_id: string; _timothy_id: string }
        Returns: boolean
      }
      viewer_sees_member: { Args: { _member_id: string }; Returns: boolean }
      viewer_tree_roots: { Args: never; Returns: string[] }
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
        | "restore"
        | "login_blocked"
        | "password_reset"
        | "password_reset_refused"
        | "password_change_failed"
        | "password_change_blocked"
        | "password_change_required"
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
        "restore",
        "login_blocked",
        "password_reset",
        "password_reset_refused",
        "password_change_failed",
        "password_change_blocked",
        "password_change_required",
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

