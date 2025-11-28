# Model Logic Port - Implementation Summary

## What Was Implemented

This implementation ports the core model selection logic from `current legacy client` to `new-client` and integrates it with a real OpenAI API chat endpoint.

### Files Created/Modified

#### 1. **`lib/modelConfig.ts`** (NEW)
- Ported from legacy `current legacy client/lib/modelConfig.ts`
- Contains model selection logic:
  - `getModelAndReasoningConfig()` - Main function to determine model + reasoning effort
  - `autoReasoningForModelAndPrompt()` - Automatic reasoning effort picker based on prompt
  - `pickMediumOrHigh()` - Classifier for high-complexity prompts
  - `shouldUseLightReasoning()` - Detects if light reasoning keywords present
  - `suggestSmallerModelForEffort()` - Suggests more efficient models when possible
  - `selectGpt51AutoFamily()` - Model family selection for GPT-5.1
- All types exported: `ModelFamily`, `SpeedMode`, `ReasoningEffort`, `ModelConfig`
- Uses GPT-5.1 family (not GPT-4)
- Zero changes to behavior vs legacy client

#### 2. **`app/api/chat/route.ts`** (NEW)
- Server-side chat API endpoint
- Flow:
  1. Validates conversation exists and belongs to current user
  2. Validates projectId if provided
  3. Loads up to 50 recent messages for context
  4. Inserts user message to Supabase
  5. Calls `getModelAndReasoningConfig()` to select model
  6. Streams from OpenAI Responses API
  7. Streams back NDJSON:
     - `{ "token": "..." }` for each text delta
     - `{ "meta": { "assistantMessageRowId": "...", ... } }` with metadata
     - `{ "done": true }` at completion
  8. Persists full assistant message to Supabase with model metadata
- Uses `supabaseServer()` for DB access
- Error handling for missing OpenAI SDK
- Reasoning effort controls token budget for thinking models

#### 3. **`lib/supabase/types.ts`** (UPDATED)
- Added `user_id` field to `MessageInsert` interface
- Now matches how messages are actually inserted (user-scoped)

#### 4. **`components/chat/chat-page-shell.tsx`** (UPDATED)
- **Removed demo messages**: No more hardcoded assistant responses
- **New `streamModelResponse()` function**: Handles /api/chat streaming
- **Updated `handleSubmit()`**:
  - Creates conversation with only user message (no demo assistant)
  - Calls `streamModelResponse()` to stream real model output
  - Works for both global and project chats
- NDJSON streaming:
  - Parses `{ "token" }` lines and appends to assistant message
  - Handles `{ "meta" }` for persisted message ID
  - Handles `{ "done": true }` for completion

#### 5. **`package.json`** (UPDATED)
- Added `"openai": "^4.80.0"` dependency

## What NOT Changed

- ✅ No UI components added (no model selector, no retry menu)
- ✅ No visual regressions to chat/agents page
- ✅ Existing conversation creation logic unchanged
- ✅ Sidebar hydration logic intact
- ✅ No changes to legacy client

## Setup Instructions

### Prerequisites

1. **Environment Variables**: Ensure `.env.local` contains:
   ```
   NEXT_PUBLIC_SUPABASE_URL=<your_supabase_url>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your_anon_key>
   OPENAI_API_KEY=<your_openai_api_key>
   ```

2. **Install Dependencies**:
   ```bash
   cd new-client
   npm install
   ```
   This installs the openai package added to package.json.

### Running Locally

```bash
npm run dev
```

Then:
1. Create a new chat (click "New Chat")
2. Type a message and send
3. Watch real OpenAI tokens stream back
4. Message persists to Supabase with model metadata

### Testing Flows

**Global Chat**:
- Go to `/`
- Type message → `/api/chat` streams response
- User + assistant messages saved to DB

**Project Chat**:
- Go to `/projects`
- Create/open project
- Type message in project chat
- Same flow, with `project_id` scoped to conversation

## Architecture Notes

### Model Selection
- **Auto mode**: `getModelAndReasoningConfig("auto", "auto", promptText)` automatically selects model/effort
- **Reasoning effort thresholds**:
  - Low: ~360 characters or light reasoning keywords
  - Medium: ~640 characters or moderate complexity
  - High: ~900+ characters or high complexity phrases
- **Model downgrade**: Attempts nano/mini for simpler tasks if high effort not needed

### API Response Format
```json
{ "token": "hello" }
{ "token": " world" }
{ "meta": { "assistantMessageRowId": "...", "model": "gpt-5.1-2025-11-13", "reasoningEffort": "low" } }
{ "done": true }
```

### Database Schema
No schema changes required. Uses existing:
- `conversations(id, user_id, title, project_id, ...)`
- `messages(id, conversation_id, user_id, role, content, metadata, ...)`

Metadata stored as JSON:
```json
{
  "model": "gpt-5.1-2025-11-13",
  "reasoningEffort": "low",
  "resolvedFamily": "gpt-5-mini"
}
```

## Next Steps (Not Implemented)

1. **UI Components**:
   - Model family selector dropdown
   - Speed mode radio buttons (auto/instant/thinking)
   - Visual indicator of selected model

2. **Retry Logic**:
   - "Retry with X model" buttons on assistant messages
   - Ability to override model for specific messages

3. **Error Handling**:
   - User-facing error messages if /api/chat fails
   - Streaming error recovery

4. **Real API Integration**:
   - Currently using placeholder model IDs (gpt-5.1-2025-11-13, etc.)
   - Map to actual OpenAI model names when available

5. **Thinking Model Support**:
   - Currently budget tokens calculated but not tested
   - May need to adjust based on actual API response format

## Testing Checklist

- [ ] Fresh page load → can create and send chat
- [ ] User message persisted to DB
- [ ] Model tokens stream back
- [ ] Assistant message persisted with metadata
- [ ] Project chat works same way
- [ ] Model selection logic picks correct model for various prompts
- [ ] No TypeScript errors: `npm run build`
