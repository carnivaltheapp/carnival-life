export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      baskets: {
        Row: {
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          owner_user_id: string;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name: string;
          owner_user_id: string;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name?: string;
          owner_user_id?: string;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      plays: {
        Row: {
          basket_id: string | null;
          branch: string | null;
          completed_at: string | null;
          created_at: string;
          duration_minutes: number | null;
          id: string;
          legacy_mongo_id: string | null;
          note: string | null;
          owner_user_id: string;
          place: string | null;
          play_type: Database["public"]["Enums"]["play_type"];
          player_contact_id: string | null;
          push_rule: Database["public"]["Enums"]["push_rule"];
          scheduled_date: string | null;
          sort_order: number;
          source_metadata: Json;
          source_type: Database["public"]["Enums"]["play_source_type"];
          status: Database["public"]["Enums"]["play_status"];
          title: string;
          updated_at: string;
          url: string | null;
        };
        Insert: {
          basket_id?: string | null;
          branch?: string | null;
          completed_at?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          legacy_mongo_id?: string | null;
          note?: string | null;
          owner_user_id: string;
          place?: string | null;
          play_type?: Database["public"]["Enums"]["play_type"];
          player_contact_id?: string | null;
          push_rule?: Database["public"]["Enums"]["push_rule"];
          scheduled_date?: string | null;
          sort_order?: number;
          source_metadata?: Json;
          source_type?: Database["public"]["Enums"]["play_source_type"];
          status?: Database["public"]["Enums"]["play_status"];
          title: string;
          updated_at?: string;
          url?: string | null;
        };
        Update: {
          basket_id?: string | null;
          branch?: string | null;
          completed_at?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          legacy_mongo_id?: string | null;
          note?: string | null;
          owner_user_id?: string;
          place?: string | null;
          play_type?: Database["public"]["Enums"]["play_type"];
          player_contact_id?: string | null;
          push_rule?: Database["public"]["Enums"]["push_rule"];
          scheduled_date?: string | null;
          sort_order?: number;
          source_metadata?: Json;
          source_type?: Database["public"]["Enums"]["play_source_type"];
          status?: Database["public"]["Enums"]["play_status"];
          title?: string;
          updated_at?: string;
          url?: string | null;
        };
        Relationships: [];
      };
      users: {
        Row: {
          avatar_url: string | null;
          country_code: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          country_code?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          country_code?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      play_source_type: "user" | "gmail";
      play_status: "open" | "done" | "trash";
      play_type: "normal" | "reminder";
      push_rule: "everyday" | "weekdays" | "weekends";
    };
    CompositeTypes: { [_ in never]: never };
  };
};
