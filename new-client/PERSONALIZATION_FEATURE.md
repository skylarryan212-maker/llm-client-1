# Personalization Feature

Complete user personalization system for the AI client, allowing users to customize their experience across communication style, model preferences, privacy settings, and more.

## Overview

The personalization page (`/p/personalization`) provides granular control over:
- **Profile**: Display name, timezone, locale
- **Communication Style**: Tone (formal/friendly/neutral), verbosity (concise/normal/detailed), code-first mode, emoji usage
- **Models & Quality**: Default model, service tier (standard/flex), speed vs quality, web search default, context strategy
- **Context & Sources**: Context loading strategy, auto-expand sources, strict citations
- **Privacy & Data**: Location sharing (off/city/precise), data retention, caching, vector indexing
- **Accessibility**: Font scale, high contrast, reduce motion, keyboard focus
- **Integrations**: GitHub, Notion, Google Drive toggles (UI ready, linking TBD)
- **Advanced**: Custom persona/instructions, safe mode (disables tools), experimental flags

## Architecture

### Data Model

**Migration**: `new-client/supabase/migrations/20251202_personalization_preferences.sql`

Extends `user_preferences` table with columns for all preference categories.

**Types**: `new-client/types/preferences.ts`

Defines TypeScript types for preferences and helper functions:
- `UserPersonalization`: Structured preference object
- `UserPreferencesRow`: Database row type
- `dbRowToPersonalization()`: Converts DB row to typed object

### Data Layer

**`new-client/lib/data/personalization.ts`**

- `getFullUserPersonalization()`: Loads all user preferences (returns defaults if none exist)
- `updatePersonalization()`: Upserts preferences (partial updates supported)
- `getDefaultPersonalization()`: Returns sensible defaults

### Actions

**`new-client/app/actions/personalization-actions.ts`**

Server actions for loading and saving preferences:
- `getPersonalizationAction()`: Server-side loader
- `updatePersonalizationAction()`: Server-side saver with revalidation

### UI

**`new-client/app/p/personalization/page.tsx`**

Server component that loads preferences and renders the form.

**`new-client/components/personalization-form.tsx`**

Client component with:
- Section-based form layout
- Optimistic UI updates
- Dirty state tracking
- Auto-save on change (debounced)
- Save/Reset buttons
- Inline success/error messages

### Integration

**`new-client/lib/preferences-integration.ts`**

Applies preferences to system prompts and routing:
- `buildPersonalizedSystemPrompt()`: Injects tone, verbosity, code-first, persona notes into system prompt
- `loadAndApplyPreferences()`: Loads preferences and returns applied config for chat route

**Router Integration** (`new-client/lib/llm-router.ts`)

Extended `RouterContext` with:
- `preferredServiceTier`: Influences standard vs flex routing
- `webSearchDefault`: Soft hint for web search strategy
- `contextDefault`: Soft hint for context loading

**Chat API Integration** (`new-client/app/api/chat/route.ts`)

1. Loads user preferences at start of request
2. Applies default model if no override provided
3. Injects personalized system prompt addendum
4. Respects safe mode (disables tools)
5. Uses context and web search defaults as fallbacks

## Usage

### Accessing the Personalization Page

Navigate to `/p/personalization` or add a link in settings:
```tsx
import Link from 'next/link'

<Link href="/p/personalization">
  Personalize Assistant
</Link>
```

### Programmatic Access

```typescript
import { getFullUserPersonalization } from '@/lib/data/personalization'

const prefs = await getFullUserPersonalization()
console.log(prefs.communication.tone) // 'friendly' | 'formal' | 'neutral'
```

### Custom Persona Example

User can add custom instructions in the Advanced section:
```
I'm a senior software engineer working with TypeScript and React. 
I prefer terse explanations with code examples. Assume I know the basics.
```

This text is injected into every system prompt, influencing all responses.

## Behavioral Mapping

| Preference | Effect |
|------------|--------|
| **Tone: Formal** | System prompt: "Use formal, professional language" |
| **Tone: Friendly** | System prompt: "Use friendly, conversational language" |
| **Verbosity: Concise** | System prompt: "Keep responses brief" |
| **Verbosity: Detailed** | System prompt: "Provide comprehensive responses" |
| **Code-first** | System prompt: "Lead with code examples before explanation" |
| **Emoji usage: Off** | System prompt: "Do not use emojis" |
| **Default model: gpt-5-mini** | Chat API uses Mini instead of Auto |
| **Service tier: Flex** | Router hint: prefer cost-optimized models |
| **Service tier: Standard** | Router hint: prioritize speed |
| **Web search: Never** | Router hint: avoid web search unless needed |
| **Web search: Required** | Router hint: prefer web search for current info |
| **Context: Minimal** | Chat API uses cache-only unless history needed |
| **Context: Recent** | Chat API loads last 15 messages (default) |
| **Context: Full** | Chat API loads all messages (for enumeration) |
| **Auto-expand sources** | Future: UI auto-expands citation panel |
| **Strict citations** | Enforces markdown link format in responses |
| **Location: Off** | No location data sent to API |
| **Location: City** | OpenStreetMap reverse geocode city sent |
| **Location: Precise** | Lat/lng sent to API for local queries |
| **Allow cache: Off** | Future: disables OpenAI prompt caching |
| **Allow vector index: Off** | Future: disables file uploads to vector stores |
| **Font scale: 1.2x** | Future: applies CSS font-size scaling |
| **High contrast** | Future: applies high-contrast theme variables |
| **Reduce motion** | Future: disables animations |
| **Safe mode** | Disables web_search and file_search tools |
| **Custom persona** | Prepended to system prompt in every request |

## Migration

To apply the schema changes:

```bash
# Using Supabase CLI
supabase db push

# Or manually execute the SQL
psql $DATABASE_URL < new-client/supabase/migrations/20251202_personalization_preferences.sql
```

## Testing Checklist

- [ ] Navigate to `/p/personalization` as authenticated user
- [ ] Change communication tone and verbosity
- [ ] Save and refresh page - preferences persist
- [ ] Send a chat message - observe tone/verbosity in response
- [ ] Set default model to Mini - verify router respects it
- [ ] Enable safe mode - verify tools are disabled in chat
- [ ] Add custom persona note - verify it appears in system prompt logs
- [ ] Change context default to Full - verify enumeration queries load all messages
- [ ] Set web search default to Never - verify router avoids search for general queries
- [ ] Test reset button - preferences revert to initial state
- [ ] Test save button feedback - success message appears

## Future Enhancements

- **UI theme application**: Apply accessibility preferences (font scale, high contrast, reduce motion) via CSS variables
- **Integration linking**: OAuth flows for GitHub, Notion, Google Drive
- **Advanced caching control**: Honor `allow_cache` by toggling OpenAI's `store` parameter
- **Vector store opt-out**: Honor `allow_vector_index` by skipping file uploads
- **Auto-expand sources**: Respect `auto_expand_sources` in ChatMessage component
- **Analytics**: Track preference usage to identify popular customizations
- **Presets**: Add preset profiles (Developer, Writer, Researcher) for quick setup

## Code Locations

- **Migration**: `new-client/supabase/migrations/20251202_personalization_preferences.sql`
- **Types**: `new-client/types/preferences.ts`
- **Data layer**: `new-client/lib/data/personalization.ts`
- **Actions**: `new-client/app/actions/personalization-actions.ts`
- **Integration helper**: `new-client/lib/preferences-integration.ts`
- **Page**: `new-client/app/p/personalization/page.tsx`
- **Form component**: `new-client/components/personalization-form.tsx`
- **Router context**: `new-client/lib/llm-router.ts` (RouterContext extended)
- **Chat API**: `new-client/app/api/chat/route.ts` (loads and applies preferences)

## Notes

- Preferences load on every chat request but are cached by Supabase server client
- System prompt addendum is logged in chat API for debugging
- Router hints are soft suggestions; router LLM makes final decision
- Safe mode is a hard constraint that completely disables tools
- Default values ensure graceful degradation if preferences fail to load
