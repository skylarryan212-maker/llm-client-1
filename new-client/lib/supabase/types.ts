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
  preamble?: string | null;
}

export interface MessageInsert {
  user_id: string;
  conversation_id: string;
  role: string;
  content: string;
  openai_response_id?: string | null;
  metadata?: Json | null;
  topic_id?: string | null;
  preamble?: string | null;
}

export interface MessageUpdate {
  metadata?: Json | null;
  topic_id?: string | null;
  preamble?: string | null;
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
  base_style: "Professional" | "Friendly" | "Concise" | "Creative" | "Robot" | null;
  custom_instructions: string | null;
  reference_saved_memories: boolean | null;
  reference_chat_history: boolean | null;
  allow_saving_memory: boolean | null;
  context_mode_global: "advanced" | "simple" | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface UserPreferencesInsert {
  user_id: string;
  accent_color?: string;
  base_style?: "Professional" | "Friendly" | "Concise" | "Creative" | "Robot" | null;
  custom_instructions?: string | null;
  reference_saved_memories?: boolean | null;
  reference_chat_history?: boolean | null;
  allow_saving_memory?: boolean | null;
  context_mode_global?: "advanced" | "simple" | null;
}

export interface UserPreferencesUpdate {
  accent_color?: string;
  base_style?: "Professional" | "Friendly" | "Concise" | "Creative" | "Robot" | null;
  custom_instructions?: string | null;
  reference_saved_memories?: boolean | null;
  reference_chat_history?: boolean | null;
  allow_saving_memory?: boolean | null;
  context_mode_global?: "advanced" | "simple" | null;
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

export interface MarketAgentInstance {
  id: string;
  user_id: string;
  label: string;
  status: "draft" | "running" | "paused";
  cadence_seconds: number;
  report_depth: "short" | "standard" | "deep";
  config: Json;
  created_at: string | null;
  updated_at: string | null;
}

export interface MarketAgentInstanceInsert {
  user_id: string;
  label?: string | null;
  status?: "draft" | "running" | "paused";
  cadence_seconds: number;
  report_depth?: "short" | "standard" | "deep";
  config?: Json;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MarketAgentInstanceUpdate {
  label?: string | null;
  status?: "draft" | "running" | "paused";
  cadence_seconds?: number;
  report_depth?: "short" | "standard" | "deep";
  config?: Json;
  updated_at?: string | null;
}

export interface MarketAgentWatchlistItem {
  id: string;
  instance_id: string;
  symbol: string;
  created_at: string | null;
}

export interface MarketAgentWatchlistItemInsert {
  instance_id: string;
  symbol: string;
  created_at?: string | null;
}

export interface MarketAgentWatchlistItemUpdate {
  symbol?: string;
}

export interface MarketAgentEvent {
  id: string;
  instance_id: string;
  ts: string | null;
  event_type: string;
  severity: "info" | "important" | "critical";
  summary: string;
  payload: Json;
  model_used: string | null;
  kind: string | null;
  title: string | null;
  body_md: string | null;
  tickers: string[] | null;
  severity_label: string | null;
  created_at: string | null;
}

export interface MarketAgentEventInsert {
  instance_id: string;
  event_type: string;
  severity?: "info" | "important" | "critical";
  summary?: string;
  payload?: Json;
  model_used?: string | null;
  ts?: string | null;
  kind?: string | null;
  title?: string | null;
  body_md?: string | null;
  tickers?: string[] | null;
  severity_label?: string | null;
  created_at?: string | null;
}

export interface MarketAgentEventUpdate {
  event_type?: string;
  severity?: "info" | "important" | "critical";
  summary?: string;
  payload?: Json;
  model_used?: string | null;
  ts?: string | null;
  kind?: string | null;
  title?: string | null;
  body_md?: string | null;
  tickers?: string[] | null;
  severity_label?: string | null;
  created_at?: string | null;
}

export interface MarketAgentUiEvent {
  id: string;
  agent_instance_id: string;
  event_id: string;
  kind: string;
  payload: Json;
  status: "proposed" | "dismissed" | "applied";
  created_at: string | null;
  updated_at: string | null;
}

export interface MarketAgentUiEventInsert {
  id?: string;
  agent_instance_id: string;
  event_id: string;
  kind?: string;
  payload: Json;
  status?: "proposed" | "dismissed" | "applied";
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MarketAgentUiEventUpdate {
  kind?: string;
  payload?: Json;
  status?: "proposed" | "dismissed" | "applied";
  updated_at?: string | null;
}

export interface MarketAgentState {
  instance_id: string;
  state: Json;
  state_version: number;
  updated_at: string | null;
}

export interface MarketAgentStateInsert {
  instance_id: string;
  state?: Json;
  state_version?: number;
  updated_at?: string | null;
}

export interface MarketAgentStateUpdate {
  state?: Json;
  state_version?: number;
  updated_at?: string | null;
}

export interface MarketAgentThesis {
  id: string;
  instance_id: string;
  bias: string | null;
  watched: string[] | null;
  key_levels: Json | null;
  invalidation: string | null;
  next_check: string | null;
  updated_at: string | null;
  created_at: string | null;
}

export interface MarketAgentThesisInsert {
  instance_id: string;
  bias?: string | null;
  watched?: string[] | null;
  key_levels?: Json | null;
  invalidation?: string | null;
  next_check?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface MarketAgentThesisUpdate {
  bias?: string | null;
  watched?: string[] | null;
  key_levels?: Json | null;
  invalidation?: string | null;
  next_check?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

type PublicTables = {
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
      market_agent_instances: {
        Row: MarketAgentInstance;
        Insert: MarketAgentInstanceInsert;
        Update: MarketAgentInstanceUpdate;
      };
      market_agent_watchlist_items: {
        Row: MarketAgentWatchlistItem;
        Insert: MarketAgentWatchlistItemInsert;
        Update: MarketAgentWatchlistItemUpdate;
      };
      market_agent_events: {
        Row: MarketAgentEvent;
        Insert: MarketAgentEventInsert;
        Update: MarketAgentEventUpdate;
      };
      market_agent_ui_events: {
        Row: MarketAgentUiEvent;
        Insert: MarketAgentUiEventInsert;
        Update: MarketAgentUiEventUpdate;
      };
      market_agent_state: {
        Row: MarketAgentState;
        Insert: MarketAgentStateInsert;
        Update: MarketAgentStateUpdate;
      };
      market_agent_thesis: {
        Row: MarketAgentThesis;
        Insert: MarketAgentThesisInsert;
        Update: MarketAgentThesisUpdate;
      };
};

type TablesWithRelationships<
  T extends Record<string, { Row: unknown; Insert: unknown; Update: unknown }>,
> = {
  [K in keyof T]: T[K] & { Relationships: [] };
} & Record<
  string,
  {
    Row: Record<string, unknown>;
    Insert: Record<string, unknown>;
    Update: Record<string, unknown>;
    Relationships: [];
  }
>;

type PublicFunctions = {
  insert_market_agent_event: {
    Args: {
      _instance_id: string;
      _event_type: string;
      _severity: string;
      _summary: string;
      _payload: Json;
      _model_used: string | null;
      _ts: string | null;
    };
    Returns: MarketAgentEvent;
  };
};

type FunctionsWithArgs<T extends Record<string, { Args: unknown; Returns: unknown }>> = {
  [K in keyof T]: T[K];
} & Record<string, { Args: Record<string, unknown> | never; Returns: unknown }>;

export interface Database {
  public: {
    Tables: TablesWithRelationships<PublicTables>;
    Views: Record<string, never>;
    Functions: FunctionsWithArgs<PublicFunctions>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
