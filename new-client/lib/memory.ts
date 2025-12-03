import { supabase } from './supabaseClient';
import { supabaseServerAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export type MemoryType = 'preference' | 'identity' | 'constraint' | 'workflow' | 'project' | 'instruction' | 'other';

export interface MemoryItem {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  enabled: boolean;
  created_at?: string;
  embedding?: number[];
}

/**
 * Generate embedding vector for text using OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const OpenAI = (await import("openai")).default;
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("[memory] Failed to generate embedding:", error);
    throw error;
  }
}

/**
 * Fetch memories using vector similarity search
 */
export async function fetchMemories({
  query = '',
  type = 'all',
  limit = 50,
  useSemanticSearch = true,
}: { 
  query?: string; 
  type?: MemoryType | 'all'; 
  limit?: number;
  useSemanticSearch?: boolean;
}) {
  // If we have a query and semantic search is enabled, use vector search
  if (query && useSemanticSearch) {
    try {
      const queryEmbedding = await generateEmbedding(query);
      
      const { data, error } = await supabase.rpc('match_memories', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: limit,
        filter_type: type,
      });

      if (error) throw error;
      
      console.log(`[memory] Vector search found ${data?.length || 0} matches`);
      return data as MemoryItem[];
    } catch (error) {
      console.error("[memory] Vector search failed, falling back to keyword search:", error);
      // Fall through to keyword search
    }
  }

  // Fallback: keyword search or no query
  let q = supabase
    .from('memories')
    .select('*')
    .eq('enabled', true)
    .order('created_at', { ascending: false })
    .limit(limit);
    
  if (type && type !== 'all') q = q.eq('type', type);
  if (query) q = q.ilike('content', `%${query}%`);
  
  const { data, error } = await q;
  if (error) throw error;
  
  console.log(`[memory] Keyword search found ${data?.length || 0} matches`);
  return data as MemoryItem[];
}

export async function updateMemoryEnabled(id: string, enabled: boolean) {
  const { error } = await supabase
    .from('memories')
    .update({ enabled })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteMemory(id: string) {
  const { error } = await supabase
    .from('memories')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/**
 * Write a new memory with embedding
 */
export async function writeMemory(memory: {
  type: MemoryType;
  title: string;
  content: string;
  enabled?: boolean;
  importance?: number;
}) {
  try {
    // Generate embedding for the content
    const embedding = await generateEmbedding(memory.content);
    // Resolve current user id for ownership
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      throw new Error("Not authenticated: cannot write memory");
    }
    // Use admin client to bypass RLS safely for server-side insert, while scoping to the user
    const admin = await supabaseServerAdmin();

    type MemoryInsert = Database["public"]["Tables"]["memories"]["Insert"];
    const payload: MemoryInsert = {
      user_id: userId,
      type: memory.type as any,
      title: memory.title,
      content: memory.content,
      // @ts-expect-error: embedding vector may be typed differently; cast at runtime
      embedding: embedding as any,
      enabled: memory.enabled ?? true,
      // Some schemas may not include importance/created_at; include if present
      // @ts-expect-error optional field depending on schema
      importance: (memory.importance ?? 50) as any,
      // @ts-expect-error server default may handle created_at
      created_at: new Date().toISOString() as any,
    };

    const { data, error } = await admin
      .from('memories')
      .insert([payload])
      .select()
      .single();

    if (error) throw error;
    
    console.log(`[memory] Wrote memory with embedding: ${memory.title}`);
    return data as MemoryItem;
  } catch (error) {
    console.error("[memory] Failed to write memory:", error);
    throw error;
  }
}
