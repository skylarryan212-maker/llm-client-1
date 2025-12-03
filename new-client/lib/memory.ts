import { supabaseServerAdmin } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import { logUsageRecord } from "@/lib/usage";

// Dynamic type system - can be any category name
export type MemoryType = string;

/**
 * Get all unique memory type categories for a user
 */
export async function getMemoryTypes(userId: string): Promise<string[]> {
  const admin = await supabaseServerAdmin();
  const { data, error } = await (admin as any)
    .from('memories')
    .select('type')
    .eq('user_id', userId)
    .eq('enabled', true);
  
  if (error) {
    console.error('[memory] Failed to get memory types:', error);
    return [];
  }
  
  const types: string[] = [...new Set((data?.map((m: any) => m.type) || []) as string[])].sort();
  console.log(`[memory] Found ${types.length} memory types:`, types);
  return types;
}

export interface MemoryItem {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  enabled: boolean;
  created_at?: string;
  embedding?: number[];
}

interface EmbeddingContext {
  userId?: string;
  conversationId?: string;
}

/**
 * Generate embedding vector for text using OpenAI
 */
async function generateEmbedding(
  text: string,
  ctx: EmbeddingContext = {},
): Promise<number[]> {
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
    const promptTokens =
      (response as { usage?: { prompt_tokens?: number; total_tokens?: number } })
        .usage?.prompt_tokens ??
      (response as { usage?: { total_tokens?: number } }).usage?.total_tokens ??
      0;
    if (ctx.userId && promptTokens > 0) {
      await logUsageRecord({
        userId: ctx.userId,
        conversationId: ctx.conversationId ?? null,
        model: "text-embedding-3-small",
        inputTokens: promptTokens,
        cachedTokens: 0,
        outputTokens: 0,
      });
    }
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
  types = 'all',
  limit = 50,
  useSemanticSearch = true,
  userId,
  conversationId,
}: { 
  query?: string; 
  types?: MemoryType | MemoryType[] | 'all'; 
  limit?: number;
  useSemanticSearch?: boolean;
  userId?: string;
  conversationId?: string;
}) {
  // Normalize types to array for consistent handling
  const typeArray = types === 'all' ? null : (Array.isArray(types) ? types : [types]);
  
  // If we have a query and semantic search is enabled, use vector search
  if (query && useSemanticSearch) {
    try {
      const queryEmbedding = await generateEmbedding(query, {
        userId,
        conversationId,
      });
      
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
      
      console.log(`[memory] Calling match_memories with embedding length: ${queryEmbedding.length}, threshold: 0.3, types: ${JSON.stringify(typeArray)}, userId: ${userId || 'client-auth'}`);
      
      // For vector search with multiple types, we'll need to handle differently
      // For now, if multiple types specified, we'll do multiple searches and merge
      let allResults: MemoryItem[] = [];
      
      if (typeArray && typeArray.length > 0) {
        // Search each type separately and merge results
        for (const singleType of typeArray) {
          const { data, error } = await client.rpc('match_memories', {
            query_embedding: queryEmbedding,
            match_threshold: 0.3,
            match_count: limit,
            filter_type: singleType,
            p_user_id: userId,
          });
          if (!error && data) {
            allResults.push(...(data as MemoryItem[]));
          }
        }
        // Deduplicate and sort by similarity
        const seen = new Set<string>();
        allResults = allResults
          .filter(m => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          })
          .slice(0, limit);
      } else {
        // Search all types
        const { data, error } = await client.rpc('match_memories', {
          query_embedding: queryEmbedding,
          match_threshold: 0.3,
          match_count: limit,
          filter_type: 'all',
          p_user_id: userId,
        });
        if (error) {
          console.error("[memory] RPC error:", error);
          throw error;
        }
        allResults = (data as MemoryItem[]) || [];
      }

      
      console.log(`[memory] Vector search found ${allResults.length} matches, first result:`, allResults[0]?.title);
      return allResults;
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
  if (typeArray && typeArray.length > 0) {
    if (typeArray.length === 1) {
      q = q.eq('type', typeArray[0]);
    } else {
      q = q.in('type', typeArray);
    }
  }
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

export async function deleteMemory(id: string, userId?: string) {
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
  
  let query = client
    .from('memories')
    .delete()
    .eq('id', id);
  
  if (userId) {
    query = query.eq('user_id', userId);
  }
  
  const { error } = await query;
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
  conversationId?: string;
}) {
  try {
    // Normalize type to avoid empty values or pure whitespace
    const rawType = (memory.type ?? "other").toString();
    const normalizedType = rawType.trim();
    const safeType = normalizedType.length > 0 ? normalizedType : "other";

    // Generate embedding for the content
    const embedding = await generateEmbedding(memory.content, {
      userId,
      conversationId: memory.conversationId,
    });
    console.log(`[memory] Generated embedding with ${embedding.length} dimensions for: "${memory.title}"`);
    
    // Resolve current user id for ownership
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      throw new Error("Not authenticated: cannot write memory");
    }
    // Check for similar existing memories to avoid duplicates
    const admin = await supabaseServerAdmin();
    const { data: similarMemories, error: searchError } = await (admin as any).rpc('match_memories', {
      // Supabase JS automatically converts number[] to vector when function expects vector type
      query_embedding: embedding,
      match_threshold: 0.85, // High threshold for detecting duplicates
      match_count: 3,
      filter_type: safeType,
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
            embedding_raw: embedding, // Supabase will handle float8[] type
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', topMatch.id)
          .select()
          .single();
        
        if (!updateError && updated) {
          console.log(`[memory] Updated existing memory: "${memory.title}"`);
          return updated as MemoryItem;
        }
      }
    }

    // No duplicates found, insert new memory
    const { data, error } = await admin
      .from('memories')
      .insert({
        user_id: userId,
        type: safeType,
        title: memory.title,
        content: memory.content,
        embedding_raw: embedding, // Supabase will handle float8[] type
        enabled: memory.enabled ?? true,
        importance: memory.importance ?? 50,
        created_at: new Date().toISOString(),
      } as any)
      .select()
      .single();

    if (error) {
      console.error(`[memory] Insert error:`, error);
      throw error;
    }
    
    console.log(`[memory] Successfully wrote memory: "${memory.title}" (${embedding.length} dims, type: ${safeType})`);
    return data as MemoryItem;
  } catch (error) {
    console.error("[memory] Failed to write memory:", error);
    throw error;
  }
}
