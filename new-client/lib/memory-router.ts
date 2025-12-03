import { fetchMemories, MemoryItem, MemoryType } from "./memory";

export interface PersonalizationMemorySettings {
  referenceSavedMemories: boolean;
  allowSavingMemory: boolean;
}

/**
 * Fetches relevant memories for the current user if enabled.
 * Uses semantic vector search to find contextually relevant memories.
 * 
 * @param settings Personalization memory settings
 * @param query Optional semantic/text query for filtering
 * @param type Optional type filter
 * @param limit Max number of memories to fetch
 * @param userId User ID for server-side calls
 */
export async function getRelevantMemories(
  settings: PersonalizationMemorySettings,
  query: string = "",
  type: MemoryType | "all" = "all",
  limit: number = 8,
  userId?: string
): Promise<MemoryItem[]> {
  if (!settings.referenceSavedMemories) return [];
  
  // Use semantic search with the user's query
  return fetchMemories({ 
    query, 
    type, 
    limit,
    useSemanticSearch: true,
    userId
  });
}