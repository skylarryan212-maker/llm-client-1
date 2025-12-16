import { supabaseServerAdmin } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

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
  userId,
  conversationId,
}: { 
  query?: string; 
  types?: MemoryType | MemoryType[] | 'all'; 
  limit?: number;
  userId?: string;
  conversationId?: string;
}) {
  // Normalize types to array for consistent handling
  const typeArray = types === 'all' ? null : (Array.isArray(types) ? types : [types]);
  
  // Keyword search only (vector search removed)
  // For server-side calls with userId, use admin client; otherwise use browser client
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

    // Resolve current user id for ownership
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      throw new Error("Not authenticated: cannot write memory");
    }
    const ensuredUserId = userId as string;

    const admin = await supabaseServerAdmin();
    const { data, error } = await admin
      .from('memories')
      .insert({
        user_id: ensuredUserId,
        type: safeType,
        title: memory.title,
        content: memory.content,
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
    console.log(`[memory] Successfully wrote memory: "${memory.title}" (type: ${safeType})`);
    return data as MemoryItem;
  } catch (error) {
    console.error("[memory] Failed to write memory:", error);
    throw error;
  }
}
