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

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string | null;
  metadata: Json | null;
}

export interface MessageInsert {
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

export interface Database {
  public: {
    Tables: {
      conversations: {
        Row: Conversation;
        Insert: ConversationInsert;
      };
      messages: {
        Row: Message;
        Insert: MessageInsert;
      };
      projects: {
        Row: Project;
        Insert: ProjectInsert;
      };
    };
  };
}
