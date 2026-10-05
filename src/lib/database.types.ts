export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
export type Pillar = 'strength' | 'nutrition' | 'sleep' | 'habits'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string; display_name: string; avatar_url: string | null; birth_date: string | null
          sex: 'male' | 'female' | 'other' | null; height_cm: number | null; weight_kg: number | null
          goal: 'hypertrophy' | 'strength' | 'fat_loss' | 'conditioning' | null
          level: 'beginner' | 'intermediate' | 'advanced' | null; days_per_week: number
          equipment: string[]; unit: 'kg' | 'lb'; locale: 'pt-BR' | 'en'; timezone: string
          share_activity: boolean; created_at: string; updated_at: string
          activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active' | null
          nutrition_pace: 'gentle' | 'standard'; nutrition_enabled: boolean; nutrition_days_per_week: number
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string; display_name: string }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
        Relationships: []
      }
      nutrition_periods: {
        Row: { user_id: string; started_on: string; ended_on: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      event_kinds: {
        Row: { pillar: Pillar; kind: string; server_only: boolean }
        Insert: never
        Update: never
        Relationships: []
      }
      app_state: {
        Row: { user_id: string; data: Json; rev: number; updated_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      activity_events: {
        Row: { id: number; user_id: string; pillar: Pillar; kind: string; occurred_on: string; payload: Json; source_ref: string; created_at: string }
        Insert: { pillar: Pillar; kind: string; occurred_on: string; payload?: Json; source_ref: string; user_id?: string }
        Update: never
        Relationships: []
      }
      weekly_targets: {
        Row: { user_id: string; week_start: string; target: number }
        Insert: never
        Update: never
        Relationships: []
      }
      xp_ledger: {
        Row: { id: number; user_id: string; pillar: Pillar | null; amount: number; reason: string; event_id: number | null; week_start: string; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      streaks: {
        Row: { user_id: string; kind: string; current: number; best: number; shields: number; last_period: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      achievement_catalog: {
        Row: { code: string; metric: string; threshold: number; xp: number; sort: number }
        Insert: never
        Update: never
        Relationships: []
      }
      user_achievements: {
        Row: { user_id: string; code: string; unlocked_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      friend_invites: {
        Row: { code: string; inviter_id: string; created_at: string; expires_at: string; used_by: string | null; used_at: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      friendships: {
        Row: { user_a: string; user_b: string; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      challenges: {
        Row: {
          id: string; template: 'workouts_count' | 'weeks_on_target' | 'volume_total'; title: string
          mode: 'team' | 'solo'; target: number; starts_on: string; ends_on: string
          // null once the creator deleted their account; timezone is theirs, kept from then on.
          created_by: string | null; timezone: string | null
          status: 'active' | 'won' | 'lost' | 'cancelled'; created_at: string; closed_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      challenge_members: {
        Row: {
          challenge_id: string; user_id: string; invited_by: string | null; joined_at: string | null
          share_volume: boolean; final: number | null; won: boolean | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      push_state: {
        Args: { p_data: Json; p_base_rev: number | null }
        Returns: Json
      }
      get_my_progress: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      delete_my_account: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
    }
    Enums: { pillar: Pillar }
    CompositeTypes: Record<string, never>
  }
}
