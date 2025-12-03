import { fetchMemories, MemoryItem, MemoryType } from "./memory";

export interface PersonalizationMemorySettings {
  referenceSavedMemories: boolean;
  allowSavingMemory: boolean;
}

/**
 * Fetches relevant memories for the current user if enabled.
 * Always loads identity memories, then adds semantically relevant memories.
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
  
  const memories: MemoryItem[] = [];
  const seenIds = new Set<string>();
  
  // ALWAYS load identity memories first (name, personal info)
  // These should always be available regardless of query similarity
  const identityMemories = await fetchMemories({
    query: "",
    type: "identity",
    limit: 5,
    useSemanticSearch: false, // Direct fetch, no similarity needed
    userId
  });
  
  identityMemories.forEach(mem => {
    memories.push(mem);
    seenIds.add(mem.id);
  });
  
  // Then add semantically relevant memories (if we have a query)
  if (query) {
    const semanticMemories = await fetchMemories({ 
      query, 
      type: type === "identity" ? "all" : type, // Skip identity since we already have it
      limit: limit - memories.length,
      useSemanticSearch: true,
      userId
    });
    
    semanticMemories.forEach(mem => {
      if (!seenIds.has(mem.id)) {
        memories.push(mem);
        seenIds.add(mem.id);
      }
    });
  }
  
  return memories.slice(0, limit);
}