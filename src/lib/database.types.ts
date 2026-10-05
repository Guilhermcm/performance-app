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
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string; display_name: string }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
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
    }
    Enums: { pillar: Pillar }
    CompositeTypes: Record<string, never>
  }
}
