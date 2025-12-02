import { fetchMemories, MemoryItem } from "./memory";
import { supabase } from "./supabaseClient";

export interface PersonalizationMemorySettings {
  referenceSavedMemories: boolean;
  allowSavingMemory: boolean;
}

/**
 * Fetches relevant memories for the current user if enabled.
 * @param settings Personalization memory settings
 * @param query Optional semantic/text query for filtering
 * @param type Optional type filter
 * @param limit Max number of memories to fetch
 */
export async function getRelevantMemories(
  settings: PersonalizationMemorySettings,
  query: string = "",
  type: string = "all",
  limit: number = 8
): Promise<MemoryItem[]> {
  if (!settings.referenceSavedMemories) return [];
  // In a real system, you might use semantic search here
  return fetchMemories({ query, type, limit });
}

/**
 * Decides whether to write a new memory based on settings and router logic.
 * @param settings Personalization memory settings
 * @param memory MemoryItem to write
 * @param shouldWrite Heuristic or LLM-based decision (true = write, false = skip)
 */
export async function maybeWriteMemory(
  settings: PersonalizationMemorySettings,
  memory: Omit<MemoryItem, "id">,
  shouldWrite: boolean
): Promise<boolean> {
  if (!settings.allowSavingMemory || !shouldWrite) return false;
  
  try {
    // Write to Supabase memories table
    const { error } = await supabase.from("memories").insert([{
      type: memory.type,
      title: memory.title,
      content: memory.content,
      enabled: memory.enabled,
      importance: 50, // default importance
      created_at: memory.created_at || new Date().toISOString(),
    }]);
    
    if (error) {
      console.error("[memory-router] Failed to write memory:", error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("[memory-router] Exception writing memory:", error);
    return false;
  }
}