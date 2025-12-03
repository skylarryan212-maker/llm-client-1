import { fetchMemories, MemoryItem, MemoryType } from "./memory";

export interface PersonalizationMemorySettings {
  referenceSavedMemories: boolean;
  allowSavingMemory: boolean;
}

export interface MemoryStrategy {
  types: MemoryType[] | "all";
  useSemanticSearch: boolean;
  query?: string;
  limit: number;
}

/**
 * Fetches relevant memories based on router-decided strategy
 * 
 * @param settings Personalization memory settings
 * @param strategy Router-decided memory loading strategy
 * @param userId User ID for server-side calls
 */
interface MemoryFetchOptions {
  availableMemoryTypes?: string[];
}

export async function getRelevantMemories(
  settings: PersonalizationMemorySettings,
  strategy: MemoryStrategy,
  userId?: string,
  conversationId?: string,
  options?: MemoryFetchOptions,
): Promise<MemoryItem[]> {
  if (!settings.referenceSavedMemories) return [];
  if (!strategy || strategy.limit <= 0) return [];
  if (options?.availableMemoryTypes && options.availableMemoryTypes.length === 0) {
    return [];
  }
  
  const { types, useSemanticSearch, query, limit } = strategy;
  
  // Load memories according to strategy
  const memories = await fetchMemories({
    query: query || "",
    types,
    limit,
    useSemanticSearch,
    userId,
    conversationId,
  });
  
  console.log(`[memory-router] Loaded ${memories.length} memories using strategy:`, JSON.stringify(strategy));
  return memories;
}
