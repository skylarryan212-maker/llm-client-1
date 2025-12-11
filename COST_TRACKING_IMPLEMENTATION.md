# Comprehensive Cost Tracking Implementation

## Overview
Complete implementation of per-user API cost tracking across all OpenAI services used in the application. All costs are logged to the `user_api_usage` table in Supabase and displayed live to users.

## Tracked Services

### 1. Chat Completions (Main Chat API)
**Location:** `new-client/app/api/chat/route.ts`

**What's Tracked:**
- Model: GPT 5.2, GPT 5.2 Pro, GPT 5 Mini, GPT 5 Nano
- Input tokens (with separate cached token pricing)
- Output tokens
- Per-model pricing rates

**Features:**
- Flex processing for free users (50% cost reduction)
- Streaming response with `stream_options: { include_usage: true }`
- Real-time cost calculation and database logging
- UUID generation for proper database insertion

**Pricing:**
- GPT 5.2: $1.75 input, $0.175 cached, $14.00 output per 1M tokens
- GPT 5.2 Pro: $21.00 input, $2.10 cached, $168.00 output per 1M tokens
- GPT 5 Mini: $0.25 input, $0.025 cached, $2.00 output per 1M tokens
- GPT 5 Nano: $0.05 input, $0.005 cached, $0.40 output per 1M tokens

### 2. Automatic Title Generation
**Location:** `new-client/app/api/conversations/generate-title/route.ts`

**What's Tracked:**
- Model: GPT 5 Nano (gpt-5-nano-2025-08-07)
- Input/cached/output tokens
- Cost per title generation

**Features:**
- Streaming with usage data included
- Automatic cost logging after title generation
- No user-visible cost (happens automatically)

**Pricing:**
- GPT 5 Nano: $0.05 input, $0.005 cached, $0.40 output per 1M tokens

### 3. Vector Storage (File Uploads)
**Location:** `new-client/app/api/chat/route.ts`

**What's Tracked:**
- Total file upload size in bytes
- Storage duration (currently estimated at 1 day)
- Cost calculated per GB per day

**Features:**
- Accumulates size across all uploaded files in a conversation
- Logs storage cost after all files are uploaded
- Separate from file_search tool usage (which is included in model costs)

**Pricing:**
- $0.10 per GB per day

**Implementation Details:**
```typescript
// Tracks cumulative file size
let totalFileUploadSize = 0;

// After uploads complete, calculate and log cost
const storageEstimatedCost = calculateVectorStorageCost(totalFileUploadSize, 1);
await supabaseAny.from("user_api_usage").insert({
  id: crypto.randomUUID(),
  user_id: userId,
  conversation_id: conversationId,
  model: "vector-storage",
  estimated_cost: storageEstimatedCost,
});
```

### 4. Audio Transcription (Whisper)
**Location:** `new-client/app/api/transcribe/route.ts`

**What's Tracked:**
- Audio file size (used to estimate duration)
- Estimated duration in seconds
- Cost per minute of audio

**Features:**
- Duration estimation from file size (WebM/Opus ~18 KB/s)
- Cost logging after successful transcription
- User authentication check before logging

**Pricing:**
- $0.006 per minute

**Implementation Details:**
```typescript
// Estimate duration from file size
function estimateAudioDuration(fileSizeBytes: number): number {
  const BYTES_PER_SECOND = 18000; // WebM/Opus average
  return fileSizeBytes / BYTES_PER_SECOND;
}

// Calculate and log cost
const cost = calculateWhisperCost(estimatedDuration);
```

### 5. Web Search
**Location:** `new-client/app/api/chat/route.ts`

**What's Tracked:**
- Already included in main chat token costs
- Uses OpenAI's built-in `web_search` tool (type: "web_search")
- No separate cost tracking needed

**Notes:**
- Web search is executed as part of the chat completion
- Token usage from web search is included in the response usage data
- Automatically tracked through the main chat API cost logging

## NOT Tracked

### Guest Chat
**Location:** `new-client/app/api/guest-chat/route.ts`

**Why Not Tracked:**
- No user authentication (guest mode)
- Uses gpt-4o-mini model
- Cannot associate costs with specific users

## Database Schema

### user_api_usage Table
```sql
{
  id: UUID (primary key, manually generated),
  user_id: UUID (references auth.users),
  conversation_id: UUID (nullable, references conversations),
  model: TEXT (e.g., "gpt-5.2", "vector-storage", "whisper-1"),
  input_tokens: INTEGER (0 for non-token services),
  cached_tokens: INTEGER (0 for non-token services),
  output_tokens: INTEGER (0 for non-token services),
  estimated_cost: NUMERIC (total cost in USD),
  created_at: TIMESTAMP (auto-generated)
}
```

## Live Cost Display

### Header Badge
**Location:** `new-client/components/api-usage-badge.tsx`

**Features:**
- Always visible in chat header (centered between title and model selector)
- Displays total spending as "$X.XXXX"
- Updates automatically after each API call
- No loading state (defaults to $0.0000)

**Implementation:**
```typescript
// Custom event dispatched after each cost logging
window.dispatchEvent(new CustomEvent('api-usage-updated'));

// Badge component listens and refreshes
useEffect(() => {
  const handleUpdate = () => loadSpending();
  window.addEventListener('api-usage-updated', handleUpdate);
  return () => window.removeEventListener('api-usage-updated', handleUpdate);
}, []);
```

### Settings Modal
**Location:** `new-client/components/settings-modal.tsx`

**Features:**
- "Account" tab shows total spending
- Displayed as "API Usage: $X.XXXX"
- Updates when settings modal opens

## Cost Calculation Functions

### Location: `new-client/lib/pricing.ts`

**Functions:**
1. `calculateCost(model, inputTokens, cachedTokens, outputTokens)` - Token-based costs
2. `calculateVectorStorageCost(sizeInBytes, durationInDays)` - Storage costs
3. `calculateWhisperCost(durationInSeconds)` - Transcription costs

**Constants:**
- `MODEL_PRICING` - Per-model token pricing
- `VECTOR_STORE_STORAGE_COST_PER_GB_DAY` - Storage pricing
- `WHISPER_COST_PER_MINUTE` - Transcription pricing

## Server Actions

### Location: `new-client/app/actions/usage-actions.ts`

**Function:** `getUserTotalSpending()`
- Queries all user_api_usage records for current user
- Sums up estimated_cost field
- Returns total spending as number

## Logging & Debugging

All cost tracking includes comprehensive console logging:

**Prefixes:**
- `[usage]` - Main chat token usage
- `[titleDebug]` - Title generation usage
- `[vectorStorage]` - File upload storage costs
- `[whisper]` - Audio transcription costs

**Example Logs:**
```
[usage] Successfully logged: 1250 input, 0 cached, 485 output, cost: $0.006412
[titleDebug] logged usage: $0.000023
[vectorStorage] Successfully logged storage cost: $0.000145
[whisper] Successfully logged usage: $0.000360
```

## Implementation Highlights

### Flex Processing Cost Optimization
**Location:** `new-client/app/api/chat/route.ts` (lines ~790-810)

Free users automatically get 50% discount on prompt models:
```typescript
const useFlex = userPlan === "free" && isPromptModel;
if (useFlex) {
  createParams.service_tier = "flex";
}
```

### UUID Generation Fix
All database inserts now include explicit UUID generation:
```typescript
const { randomUUID } = require("crypto");
await supabase.from("user_api_usage").insert({
  id: randomUUID(),
  // ... other fields
});
```

### Event-Driven UI Updates
Cost display updates automatically without polling:
```typescript
// After cost logging
window.dispatchEvent(new CustomEvent('api-usage-updated'));
```

## Testing

To verify cost tracking is working:

1. **Main Chat:**
   - Send a message in any conversation
   - Check console for `[usage] Successfully logged` message
   - Verify badge updates in header

2. **Title Generation:**
   - Create a new conversation
   - Check console for `[titleDebug] logged usage` message
   - Cost automatically added to total

3. **File Uploads:**
   - Upload a PDF or large image in chat
   - Check console for `[vectorStorage] Successfully logged` message
   - Cost reflects file size

4. **Voice Transcription:**
   - Record and send a voice message
   - Check console for `[whisper] Successfully logged` message
   - Cost reflects audio duration

5. **Database Verification:**
   - Query `user_api_usage` table in Supabase
   - Verify records exist with proper UUIDs and costs
   - Check `estimated_cost` values are reasonable

## Future Enhancements

Potential additions (not currently implemented):

1. **Usage Analytics Dashboard**
   - Daily/weekly/monthly spending charts
   - Cost breakdown by service type
   - Most expensive conversations

2. **Cost Alerts**
   - Warning when approaching spending thresholds
   - Email notifications for high usage

3. **Detailed Vector Storage Tracking**
   - Track actual retention duration
   - Calculate costs based on real storage time
   - Clean up old vector stores to reduce costs

4. **Guest Chat Tracking**
   - Anonymous usage aggregation
   - Rate limiting based on IP address
   - Optional user association

5. **Batch Processing**
   - Group non-urgent requests for flex processing
   - Further cost optimization for free users

## Summary

Comprehensive cost tracking is now implemented for:
- âœ… All chat model completions (with flex pricing for free users)
- âœ… Automatic title generation (GPT 5 Nano)
- âœ… Vector storage for uploaded files
- âœ… Audio transcription (Whisper)
- âœ… Live cost display in UI
- âœ… Complete database logging with proper UUIDs

All API costs are tracked and displayed to users in real-time, providing full transparency and enabling usage-based billing or quota enforcement in the future.
