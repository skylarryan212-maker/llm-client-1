# Testing the Model Logic Port

## Pre-Flight Checklist

Before starting, ensure:

```bash
# 1. Install dependencies
cd new-client
npm install

# 2. Verify environment variables are set in .env.local
# Required:
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  
#   OPENAI_API_KEY

# 3. Start dev server
npm run dev

# Dev server will start at http://localhost:3000
```

## Test 1: Global Chat - Fresh Load

**Goal**: Verify sidebar shows chat after fresh page load and new chat creation

1. Open browser to `http://localhost:3000`
2. Click **"New Chat"** button
3. Type message: `"Hello, what's the weather?"`
4. Click **Send** or press Enter
5. **Expected**:
   - User message appears immediately
   - Model tokens stream in real-time (typing animation)
   - Assistant response completes
   - Sidebar updates with new chat (no manual refresh needed)

**Verify in Supabase**:
- Check `conversations` table: New row exists with your message in title
- Check `messages` table:
  - User message exists with role='user'
  - Assistant message exists with role='assistant' and metadata JSON containing `model`, `reasoningEffort`

---

## Test 2: Project Chat - Model Metadata Persistence

**Goal**: Verify project chat works and metadata is stored correctly

1. Go to **Projects** tab (or `/projects`)
2. Create new project (or use existing)
3. Click into project chat
4. Type message: `"Write Python code to reverse a string"`
5. Click **Send**
6. **Expected**:
   - User message appears immediately
   - Model response streams
   - Assistant message appears with metadata

**Verify in Supabase**:
- Check `conversations` table: `project_id` is set
- Check `messages` table: Assistant message metadata contains:
  ```json
  {
    "model": "gpt-5.1-2025-11-13",
    "reasoningEffort": "low" or "medium" or "high",
    "resolvedFamily": "gpt-5-mini" or "gpt-5-pro" etc
  }
  ```

---

## Test 3: Complex Prompt - High Reasoning Effort

**Goal**: Verify model selection adapts to prompt complexity

Send a complex prompt to trigger high reasoning effort:

```
"I have a microservices architecture with 5 services:
- Auth service (Node.js)
- Payment service (Go)
- User service (Python)
- Order service (Java)
- Analytics (Rust)

How should I handle distributed tracing across all services?
What are the trade-offs between OpenTelemetry and proprietary solutions?
Consider operational overhead and cost."
```

**Expected**:
- Response streams back (may take longer due to reasoning)
- Metadata shows `"reasoningEffort": "high"` (or "medium" depending on threshold)

---

## Test 4: Simple Prompt - Low Reasoning Effort

**Goal**: Verify model downgrades for simple tasks

Send a simple prompt:

```
"What is 2 + 2?"
```

**Expected**:
- Quick response (minimal thinking)
- Metadata shows `"reasoningEffort": "low"`
- May use smaller model (gpt-5-mini or gpt-5-nano)

---

## Test 5: Model Selection Logic - Multiple Prompts

Send these in sequence and observe metadata:

1. **Short factual**: `"What is Python?"` → expect LOW reasoning
2. **Medium technical**: `"Explain async/await in JavaScript"` → expect LOW/MEDIUM
3. **Complex design**: `"Design a rate limiter for a distributed system"` → expect MEDIUM/HIGH
4. **Creative**: `"Write a funny limerick about debugging"` → expect LOW

---

## Debugging

### No model tokens appearing?

1. Check browser console (F12 → Console)
2. Check Network tab: Does `/api/chat` request show in pending?
3. Check that `OPENAI_API_KEY` is set:
   ```bash
   # Verify in new-client/.env.local
   cat .env.local | grep OPENAI_API_KEY
   ```
4. Check terminal output for errors during `npm run dev`

### Database shows no messages?

1. Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct
2. Check that your Supabase project allows public access to `conversations` and `messages` tables (or set up proper RLS)
3. Check for errors in Network tab → `/api/chat` response

### TypeScript errors in IDE?

```bash
npm run build
```

Should output: "Successfully compiled X files with tsc"

---

## Code Locations for Debugging

| Component | File |
|-----------|------|
| Model selection logic | `lib/modelConfig.ts` |
| API endpoint | `app/api/chat/route.ts` |
| Chat UI | `components/chat/chat-page-shell.tsx` |
| NDJSON streaming handler | `components/chat/chat-page-shell.tsx` → `streamModelResponse()` |
| Supabase persistence | `app/api/chat/route.ts` → message inserts |

---

## Common Issues

**Issue**: "Module 'openai' not found"
- **Fix**: `npm install` in new-client (installs openai ^4.80.0)

**Issue**: Chat sends but nothing happens
- **Fix**: Check `/api/chat` route is returning NDJSON format (check Network → Response tab)

**Issue**: Tokens appear but assistant message never saves
- **Fix**: Check database insert line in `route.ts` - may need to verify Supabase RLS policies allow inserts

**Issue**: Model always shows as gpt-5-pro (wrong model)
- **Fix**: Check `modelConfig.ts` model family selection - may need to adjust thresholds

---

## Success Criteria

✅ All tests pass when:
- [ ] New chat created and appears in sidebar (no refresh needed)
- [ ] User message writes to Supabase
- [ ] Model tokens stream in real-time
- [ ] Assistant message writes to Supabase with metadata
- [ ] Same flow works for project chats
- [ ] Model selection adapts to prompt complexity (LOW for simple, HIGH for complex)
- [ ] No TypeScript errors: `npm run build`
