import { supabaseServerAdmin } from "@/lib/supabase/server";
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
 * When userId is provided, uses server admin client with proper user scoping
 * Otherwise uses regular client (for client-side calls)
 */
export async function fetchMemories({
  query = '',
  type = 'all',
  limit = 50,
  useSemanticSearch = true,
  userId,
}: { 
  query?: string; 
  type?: MemoryType | 'all'; 
  limit?: number;
  useSemanticSearch?: boolean;
  userId?: string;
}) {
  // If we have a query and semantic search is enabled, use vector search
  if (query && useSemanticSearch) {
    try {
      const queryEmbedding = await generateEmbedding(query);
      
      // Use server admin client when userId is provided (server-side call)
      // Otherwise use browser client (client-side call with auth)
      let client;
      if (userId) {
        const admin = await supabaseServerAdmin();
        client = admin as any;
      } else {
        const { default: browserClient } = await import("@/lib/supabase/browser-client");
        client = browserClient as any;
      }
      
      const { data, error } = await client.rpc('match_memories', {
        // pgvector will be fed from embedding_raw via trigger; here we just send numeric array
        query_embedding: queryEmbedding as any,
        match_threshold: 0.7,
        match_count: limit,
        filter_type: type,
        p_user_id: userId, // Pass user_id explicitly for server calls
      });

      if (error) {
        console.error("[memory] RPC error:", error);
        throw error;
      }
      
      console.log(`[memory] Vector search found ${data?.length || 0} matches`);
      return data as MemoryItem[];
    } catch (error) {
      console.error("[memory] Vector search failed, falling back to keyword search:", error);
      // Fall through to keyword search
    }
  }

  // Fallback: keyword search or no query
  // For server-side calls with userId, use admin client
  // Otherwise use browser client (client-side call with auth)
  let client;
  if (userId) {
    const admin = await supabaseServerAdmin();
    client = admin as any;
  } else {
    const { default: browserClient } = await import("@/lib/supabase/browser-client");
    client = browserClient as any;
  }
  
  let q = client
    .from('memories')
    .select('*')
    .eq('enabled', true)
    .order('created_at', { ascending: false })
    .limit(limit);
    
  if (userId) q = q.eq('user_id', userId);
  if (type && type !== 'all') q = q.eq('type', type);
  if (query) q = q.ilike('content', `%${query}%`);
  
  const { data, error } = await q;
  if (error) throw error;
  
  console.log(`[memory] Keyword search found ${data?.length || 0} matches`);
  return data as MemoryItem[];
}

export async function updateMemoryEnabled(id: string, enabled: boolean) {
  const { default: browserClient } = await import("@/lib/supabase/browser-client");
  const { error } = await browserClient
    .from('memories')
    .update({ enabled })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteMemory(id: string) {
  const { default: browserClient } = await import("@/lib/supabase/browser-client");
  const { error } = await browserClient
    .from('memories')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/**
 * Write a new memory with embedding
 * Checks for duplicate/similar memories before saving
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
    
    // Check for similar existing memories to avoid duplicates
    const admin = await supabaseServerAdmin();
    const { data: similarMemories, error: searchError } = await (admin as any).rpc('match_memories', {
      // pass raw numeric array; DB trigger keeps pgvector column in sync
      query_embedding: embedding as any,
      match_threshold: 0.85, // High threshold for detecting duplicates
      match_count: 3,
      filter_type: memory.type,
      p_user_id: userId,
    });
    
    if (!searchError && similarMemories && similarMemories.length > 0) {
      const topMatch = similarMemories[0];
      console.log(`[memory] Found similar memory (similarity: ${topMatch.similarity.toFixed(3)}): "${topMatch.title}"`);
      
      // If very similar (>0.90), skip creating duplicate
      if (topMatch.similarity > 0.90) {
        console.log(`[memory] Skipping duplicate memory: "${memory.title}"`);
        return topMatch as MemoryItem;
      }
      
      // If somewhat similar (0.85-0.90), update existing instead of creating new
      if (topMatch.similarity > 0.85) {
        console.log(`[memory] Updating existing memory instead of creating duplicate`);
        const { data: updated, error: updateError } = await (admin as any)
          .from('memories')
          .update({
            content: memory.content,
            title: memory.title,
            embedding_raw: embedding as any,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', topMatch.id)
          .select()
          .single();
        
        if (!updateError && updated) {
          console.log(`[memory] Updated memory: ${memory.title}`);
          return updated as MemoryItem;
        }
      }
    }

    // No duplicates found, insert new memory
    const { data, error } = await admin
      .from('memories')
      .insert({
        user_id: userId,
        type: memory.type,
        title: memory.title,
        content: memory.content,
        embedding_raw: embedding as any,
        enabled: memory.enabled ?? true,
        importance: memory.importance ?? 50,
        created_at: new Date().toISOString(),
      } as any)
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
