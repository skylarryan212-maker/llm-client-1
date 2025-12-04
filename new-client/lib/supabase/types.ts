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
  router_context_cache: Json | null;
  router_context_cache_last_message_id: string | null;
  router_context_cache_updated_at: string | null;
}

export interface ConversationInsert {
  user_id: string;
  title?: string | null;
  project_id?: string | null;
  metadata?: Json | null;
  router_context_cache?: Json | null;
  router_context_cache_last_message_id?: string | null;
  router_context_cache_updated_at?: string | null;
}

export interface ConversationUpdate {
  title?: string | null;
  project_id?: string | null;
  metadata?: Json | null;
  router_context_cache?: Json | null;
  router_context_cache_last_message_id?: string | null;
  router_context_cache_updated_at?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  openai_response_id: string | null;
  created_at: string | null;
  metadata: Json | null;
  topic_id: string | null;
}

export interface MessageInsert {
  user_id: string;
  conversation_id: string;
  role: string;
  content: string;
  openai_response_id?: string | null;
  metadata?: Json | null;
  topic_id?: string | null;
}

export interface MessageUpdate {
  metadata?: Json | null;
  topic_id?: string | null;
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

export interface PermanentInstruction {
  id: string;
  user_id: string;
  conversation_id: string | null;
  scope: "user" | "conversation";
  title: string | null;
  content: string;
  enabled: boolean;
  priority: number;
  metadata: Json | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PermanentInstructionInsert {
  user_id: string;
  conversation_id?: string | null;
  scope?: "user" | "conversation";
  title?: string | null;
  content: string;
  enabled?: boolean;
  priority?: number;
  metadata?: Json | null;
}

export interface PermanentInstructionUpdate {
  conversation_id?: string | null;
  scope?: "user" | "conversation";
  title?: string | null;
  content?: string;
  enabled?: boolean;
  priority?: number;
  metadata?: Json | null;
}

export interface PermanentInstructionVersion {
  user_id: string;
  version: string | null;
  updated_at: string | null;
}

export interface ConversationTopic {
  id: string;
  conversation_id: string;
  parent_topic_id: string | null;
  label: string;
  description: string | null;
  summary: string | null;
  token_estimate: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ConversationTopicInsert {
  conversation_id: string;
  label: string;
  parent_topic_id?: string | null;
  description?: string | null;
  summary?: string | null;
  token_estimate?: number;
}

export interface ConversationTopicUpdate {
  parent_topic_id?: string | null;
  label?: string;
  description?: string | null;
  summary?: string | null;
  token_estimate?: number;
  updated_at?: string | null;
}

export interface Artifact {
  id: string;
  conversation_id: string;
  topic_id: string | null;
  created_by_message_id: string | null;
  type: string;
  title: string;
  summary: string | null;
  content: string;
  created_at: string | null;
}

export interface ArtifactInsert {
  conversation_id: string;
  type: string;
  title: string;
  content: string;
  topic_id?: string | null;
  created_by_message_id?: string | null;
  summary?: string | null;
}

export interface ArtifactUpdate {
  topic_id?: string | null;
  created_by_message_id?: string | null;
  type?: string;
  title?: string;
  summary?: string | null;
  content?: string;
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
      permanent_instructions: {
        Row: PermanentInstruction;
        Insert: PermanentInstructionInsert;
        Update: PermanentInstructionUpdate;
      };
      permanent_instruction_versions: {
        Row: PermanentInstructionVersion;
        Insert: PermanentInstructionVersion;
        Update: PermanentInstructionVersion;
      };
      conversation_topics: {
        Row: ConversationTopic;
        Insert: ConversationTopicInsert;
        Update: ConversationTopicUpdate;
      };
      artifacts: {
        Row: Artifact;
        Insert: ArtifactInsert;
        Update: ArtifactUpdate;
      };
    };
  };
}
