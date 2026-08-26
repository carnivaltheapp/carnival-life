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
      contact_references: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          email: string | null;
          google_account_id: string | null;
          id: string;
          is_self: boolean;
          owner_user_id: string;
          provider_resource_name: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          email?: string | null;
          google_account_id?: string | null;
          id?: string;
          is_self?: boolean;
          owner_user_id: string;
          provider_resource_name?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          email?: string | null;
          google_account_id?: string | null;
          id?: string;
          is_self?: boolean;
          owner_user_id?: string;
          provider_resource_name?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      google_accounts: {
        Row: {
          avatar_url: string | null;
          connection_status: Database["public"]["Enums"]["google_connection_status"];
          created_at: string;
          display_name: string | null;
          email: string | null;
          granted_scopes: string[];
          id: string;
          last_synced_at: string | null;
          owner_user_id: string;
          provider_subject: string;
          sync_error: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          connection_status?: Database["public"]["Enums"]["google_connection_status"];
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          granted_scopes?: string[];
          id?: string;
          last_synced_at?: string | null;
          owner_user_id: string;
          provider_subject: string;
          sync_error?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          connection_status?: Database["public"]["Enums"]["google_connection_status"];
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          granted_scopes?: string[];
          id?: string;
          last_synced_at?: string | null;
          owner_user_id?: string;
          provider_subject?: string;
          sync_error?: string | null;
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
      play_relationships: {
        Row: {
          created_at: string;
          from_play_id: string;
          id: string;
          owner_user_id: string;
          relationship_type: Database["public"]["Enums"]["play_relationship_type"];
          to_play_id: string;
        };
        Insert: {
          created_at?: string;
          from_play_id: string;
          id?: string;
          owner_user_id: string;
          relationship_type?: Database["public"]["Enums"]["play_relationship_type"];
          to_play_id: string;
        };
        Update: {
          created_at?: string;
          from_play_id?: string;
          id?: string;
          owner_user_id?: string;
          relationship_type?: Database["public"]["Enums"]["play_relationship_type"];
          to_play_id?: string;
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
    Functions: {
      done_create_existing: {
        Args: { p_play_id: string };
        Returns: {
          next_basket_id: string | null;
          next_play_id: string;
          next_scheduled_date: string | null;
        }[];
      };
      done_create_new: {
        Args: {
          p_basket_id: string | null;
          p_play_id: string;
          p_play_type: Database["public"]["Enums"]["play_type"];
          p_scheduled_date: string | null;
          p_title: string;
        };
        Returns: {
          next_basket_id: string | null;
          next_play_id: string;
          next_scheduled_date: string | null;
        }[];
      };
      set_next_play: {
        Args: { p_from_play_id: string; p_to_play_id: string | null };
        Returns: undefined;
      };
    };
    Enums: {
      google_connection_status: "connected" | "disconnected" | "error";
      play_relationship_type: "next";
      play_source_type: "user" | "gmail";
      play_status: "open" | "done" | "trash";
      play_type: "normal" | "reminder";
      push_rule: "everyday" | "weekdays" | "weekends";
    };
    CompositeTypes: { [_ in never]: never };
  };
};
