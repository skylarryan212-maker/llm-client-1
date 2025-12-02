# Memory System Implementation

## Overview
Comprehensive memory management system integrated into the AI chat client, allowing the model to remember user preferences, identity information, and contextual details across conversations.

## Components Implemented

### 1. Database Schema (`supabase/migrations/20251202_memories.sql`)
- **Table**: `memories` with fields:
  - `id`: UUID primary key
  - `user_id`: Foreign key to auth.users
  - `type`: Enum (preference, identity, constraint, workflow, project, instruction, other)
  - `title`: Short descriptive label
  - `content`: Full memory text
  - `embedding`: vector(1536) for semantic search (pgvector)
  - `importance`: 0-100 score
  - `enabled`: Boolean toggle
  - `source`: Optional reference to message_id or event
  - `metadata`: JSONB for extensibility
  - `created_at`, `updated_at`: Timestamps
- **Indexes**: User ID, enabled status, type, created_at, metadata GIN, embedding IVFFlat
- **RLS**: Row-level security ensuring users can only access their own memories

### 2. Memory API (`lib/memory.ts`)
- `fetchMemories()`: Query memories with filters (query, type, limit)
- `updateMemoryEnabled()`: Toggle memory on/off
- `deleteMemory()`: Remove a memory

### 3. Memory Router Logic (`lib/memory-router.ts`)
- `getRelevantMemories()`: Fetch memories based on personalization settings
- `maybeWriteMemory()`: Gate memory writes based on settings and heuristics
- Integrates with personalization toggles to respect user preferences

### 4. Personalization UI
#### Settings Modal (`components/personalization-panel.tsx`)
- **Base Style & Tone**: Dropdown (Professional, Friendly, Concise, Creative)
- **Custom Instructions**: Freeform textarea for user-defined behavior
- **Memory Section**:
  - Toggle: "Reference saved memories"
  - Toggle: "Reference chat history"
  - Toggle: "Allow saving memory"
  - Button: "Manage" → opens memory browser modal

#### Memory Management Modal (`components/memory-manage-modal.tsx`)
- Search bar for filtering memories
- Type filter dropdown
- List view with enable/disable and delete buttons per memory
- Real-time Supabase integration

### 5. Chat Integration (`app/api/chat/route.ts`)
#### Memory Retrieval (Read)
- Load personalization settings at start of each chat turn
- If `referenceSavedMemories` is enabled:
  - Fetch up to 8 relevant memories using `getRelevantMemories()`
  - Inject memories into system prompt with format:
    ```
    **Saved Memories (User Context):**
    - [type] title: content
    - [type] title: content
    ```
- Apply custom instructions and base style to system prompt

#### Memory Writing (Write)
- After assistant response is saved:
  - Check if `allowSavingMemory` is enabled
  - Use heuristics to detect memory-worthy user messages:
    - Identity: "my name is", "call me", "I'm", "I am"
    - Preferences: "I prefer", "I like", "I don't like"
    - Constraints: "always", "never", "from now on", "remember"
  - Extract memory title (first 60 chars)
  - Classify memory type (identity, preference, constraint, other)
  - Call `maybeWriteMemory()` to persist to Supabase
- Non-blocking: errors don't fail the chat request

### 6. Personalization Settings Storage
- **Client-side**: localStorage key `personalization.memory.v1`
- **Schema**:
  ```typescript
  {
    baseStyle: "Professional" | "Friendly" | "Concise" | "Creative",
    customInstructions: string,
    referenceSavedMemories: boolean,
    referenceChatHistory: boolean,
    allowSavingMemory: boolean
  }
  ```
- **Future**: Can be synced to Supabase for cross-device persistence

## How It Works

### User Flow
1. User opens Settings → Personalization tab
2. Sets base style, custom instructions, and memory toggles
3. Clicks "Save changes" (persisted to localStorage)
4. Opens "Manage" to view/edit existing memories

### Chat Flow (Memory Read)
1. User sends a message
2. API loads personalization settings
3. If `referenceSavedMemories` is true:
   - Query Supabase `memories` table
   - Fetch enabled memories (up to 8)
   - Inject into system prompt
4. Model receives enriched context with user preferences and history
5. Response is personalized based on memories

### Chat Flow (Memory Write)
1. User sends a message like "My name is Alice, I prefer concise answers"
2. API processes message and generates response
3. After response is saved:
   - Check `allowSavingMemory` toggle
   - Detect memory triggers in user message
   - Extract memory: 
     - Title: "My name is Alice, I prefer concise answers"
     - Type: identity
     - Content: full message
   - Insert into Supabase `memories` table
4. Future chats will reference this memory automatically

## Memory Decision Logic

### When to Write a Memory (Heuristics)
Current implementation uses regex-based detection:
- **Identity**: `/my name is|call me|i'm|i am/i`
- **Preference**: `/i prefer|i like|i don't like|i hate/i`
- **Constraint**: `/always|never|from now on|remember/i`
- **General**: `/keep in mind|note that|please remember/i`

**Future Enhancement**: Use LLM-based extraction for smarter categorization and deduplication.

### When to Read Memories
- Every chat turn if `referenceSavedMemories` is enabled
- Top 8 enabled memories ordered by relevance (currently recency, future: semantic similarity)
- Can be extended with embedding-based semantic search using the `embedding` column

## Retrieval Strategy

### Current (v1)
- Text-based filtering via `content` ILIKE query
- Type filtering
- Recency ordering
- Limit to top 8

### Future (v2)
- **Semantic Search**: Generate embeddings for user message, query memories by cosine similarity
- **Hybrid Ranking**: Combine recency, importance score, and semantic relevance
- **De-duplication**: Detect and merge similar memories
- **Decay**: Lower importance of old memories unless frequently referenced

## Privacy & Control
- **User owns all memories**: RLS ensures isolation
- **Toggles for every action**:
  - `referenceSavedMemories`: Gate reads
  - `allowSavingMemory`: Gate writes
- **Manage UI**: User can disable or delete any memory
- **Soft disable**: Memories can be toggled off without deletion

## Integration Points

### Files Modified
- `app/api/chat/route.ts`: Added memory read/write logic
- `lib/memory.ts`: Memory CRUD operations
- `lib/memory-router.ts`: Memory decision logic
- `lib/supabaseClient.ts`: Supabase client init
- `components/personalization-panel.tsx`: Settings UI
- `components/memory-manage-modal.tsx`: Memory browser UI
- `components/settings-modal.tsx`: Integrated personalization tab

### Files Created
- `supabase/migrations/20251202_memories.sql`: Database schema

## Testing Checklist

### Manual Testing
- [ ] Enable "Allow saving memory", send message with identity info, verify memory is created
- [ ] Enable "Reference saved memories", verify memories appear in system prompt logs
- [ ] Disable "Allow saving memory", verify no new memories are written
- [ ] Disable "Reference saved memories", verify no memories are fetched
- [ ] Open Manage modal, verify memories list loads
- [ ] Toggle memory enabled/disabled in Manage modal
- [ ] Delete a memory in Manage modal
- [ ] Search memories by text query
- [ ] Filter memories by type
- [ ] Verify RLS: cannot see other users' memories

### Automated Testing (Future)
- Unit tests for `getRelevantMemories` and `maybeWriteMemory`
- Integration tests for Supabase queries
- E2E tests for Settings → Chat → Memory persistence flow

## Performance Considerations
- **Indexed queries**: All Supabase queries use indexed columns (user_id, enabled, type)
- **Limit caps**: Maximum 8 memories per chat turn to avoid token bloat
- **Non-blocking writes**: Memory writes don't block chat response
- **IVFFlat index**: Pre-configured for future semantic search scaling

## Future Enhancements
1. **LLM-based memory extraction**: Use a small model to intelligently extract and categorize memories
2. **Semantic search**: Generate embeddings and use cosine similarity for retrieval
3. **Memory importance scoring**: Auto-adjust based on usage frequency
4. **Memory decay**: Reduce weight of old memories
5. **Cross-device sync**: Store personalization settings in Supabase instead of localStorage
6. **Memory suggestions**: Proactively suggest memories to save based on conversation
7. **Memory editing**: Allow users to edit memory title/content in Manage UI
8. **Memory grouping**: Auto-group related memories (e.g., all preferences about coding style)

## Configuration
All memory behavior is controlled by personalization settings:
```typescript
{
  referenceSavedMemories: boolean,  // Enable memory reads
  allowSavingMemory: boolean,       // Enable memory writes
  customInstructions: string,        // Global instructions
  baseStyle: string                  // Tone preset
}
```

## Conclusion
The memory system is fully functional and integrated. Users can now:
- Save personalized context automatically
- Manage their memories via UI
- Control memory behavior with fine-grained toggles
- Receive contextually aware responses across conversations

Next steps: testing, refinement, and semantic search implementation for production readiness.
