export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      conversations: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          created_at: string | null;
          project_id: string | null;
          metadata: Json | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          created_at?: string | null;
          project_id?: string | null;
          metadata?: Json | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string | null;
          created_at?: string | null;
          project_id?: string | null;
          metadata?: Json | null;
        };
      };
      messages: {
        Row: {
          id: string;
          user_id: string;
          role: string | null;
          content: string | null;
          created_at: string | null;
          conversation_id: string | null;
          metadata: Json | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          role?: string | null;
          content?: string | null;
          created_at?: string | null;
          conversation_id?: string | null;
          metadata?: Json | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: string | null;
          content?: string | null;
          created_at?: string | null;
          conversation_id?: string | null;
          metadata?: Json | null;
        };
      };
      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string | null;
          created_at?: string | null;
        };
      };
    };
  };
}

export type ConversationInsert = Database["public"]["Tables"]["conversations"]["Insert"];
export type MessageInsert = Database["public"]["Tables"]["messages"]["Insert"];
export type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
