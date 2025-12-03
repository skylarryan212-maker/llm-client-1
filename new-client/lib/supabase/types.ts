export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  project_id: string | null;
  metadata: Json | null;
  created_at: string | null;
}

export interface ConversationInsert {
  user_id: string;
  title?: string | null;
  project_id?: string | null;
  metadata?: Json | null;
}

export interface ConversationUpdate {
  title?: string | null;
  project_id?: string | null;
  metadata?: Json | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  openai_response_id: string | null;
  created_at: string | null;
  metadata: Json | null;
}

export interface MessageInsert {
  user_id: string;
  conversation_id: string;
  role: string;
  content: string;
  openai_response_id?: string | null;
  metadata?: Json | null;
}

export interface MessageUpdate {
  metadata?: Json | null;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  icon?: string;
  color?: string;
  created_at: string | null;
}

export interface ProjectInsert {
  user_id: string;
  name: string;
  icon?: string;
  color?: string;
}

export interface ProjectUpdate {
  name?: string;
  icon?: string;
  color?: string;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  accent_color: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface UserPreferencesInsert {
  user_id: string;
  accent_color?: string;
}

export interface UserPreferencesUpdate {
  accent_color?: string;
  updated_at?: string;
}

export interface GuestSession {
  id: string;
  created_at: string | null;
  last_seen: string | null;
  request_count: number | null;
  token_count: number | null;
  estimated_cost: number | null;
}

export interface GuestSessionInsert {
  id?: string;
}

export interface GuestSessionUpdate {
  last_seen?: string | null;
  request_count?: number | null;
  token_count?: number | null;
  estimated_cost?: number | null;
}

export interface Memory {
  id: string;
  user_id: string;
  type: string;
  title: string;
  content: string;
  enabled: boolean;
  importance?: number;
  embedding?: string; // pgvector stored as string in schema
  created_at: string | null;
}

export interface MemoryInsert {
  user_id: string;
  type: string;
  title: string;
  content: string;
  enabled?: boolean;
  importance?: number;
  embedding?: string;
  created_at?: string;
}

export interface MemoryUpdate {
  type?: string;
  title?: string;
  content?: string;
  enabled?: boolean;
  importance?: number;
  embedding?: string;
}

export interface Database {
  public: {
    Tables: {
      conversations: {
        Row: Conversation;
        Insert: ConversationInsert;
        Update: ConversationUpdate;
      };
      messages: {
        Row: Message;
        Insert: MessageInsert;
        Update: MessageUpdate;
      };
      projects: {
        Row: Project;
        Insert: ProjectInsert;
        Update: ProjectUpdate;
      };
      user_preferences: {
        Row: UserPreferences;
        Insert: UserPreferencesInsert;
        Update: UserPreferencesUpdate;
      };
      guest_sessions: {
        Row: GuestSession;
        Insert: GuestSessionInsert;
        Update: GuestSessionUpdate;
      };
      memories: {
        Row: Memory;
        Insert: MemoryInsert;
        Update: MemoryUpdate;
      };
    };
  };
}
