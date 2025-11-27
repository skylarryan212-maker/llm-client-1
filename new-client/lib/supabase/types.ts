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
      conversations: {
        Row: {
          created_at: string | null;
          id: string;
          metadata: Json | null;
          project_id: string | null;
          title: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          metadata?: Json | null;
          project_id?: string | null;
          title?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          metadata?: Json | null;
          project_id?: string | null;
          title?: string | null;
          user_id?: string;
        };
      };
      messages: {
        Row: {
          content: string | null;
          conversation_id: string | null;
          created_at: string | null;
          id: string;
          metadata: Json | null;
          role: string | null;
          user_id: string;
        };
        Insert: {
          content?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          id?: string;
          metadata?: Json | null;
          role?: string | null;
          user_id?: string;
        };
        Update: {
          content?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          id?: string;
          metadata?: Json | null;
          role?: string | null;
          user_id?: string;
        };
      };
      projects: {
        Row: {
          created_at: string | null;
          id: string;
          name: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          name?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          name?: string | null;
          user_id?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type ConversationInsert =
  Database["public"]["Tables"]["conversations"]["Insert"];
export type MessageInsert = Database["public"]["Tables"]["messages"]["Insert"];
export type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
