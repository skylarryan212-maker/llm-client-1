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
  created_at: string | null;
  metadata: Json | null;
}

export interface MessageInsert {
  user_id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata?: Json | null;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  created_at: string | null;
}

export interface ProjectInsert {
  user_id: string;
  name: string;
}

export interface ProjectUpdate {
  name?: string;
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
    };
  };
}
