/**
 * Helper to load user preferences and inject them into system prompts and routing
 */

import { getFullUserPersonalization } from "@/lib/data/personalization";
import type { UserPersonalization } from "@/types/preferences";

/**
 * Build custom system prompt addendum based on user personalization
 */
export function buildPersonalizedSystemPrompt(prefs: UserPersonalization | null): string {
  if (!prefs) return "";

  const parts: string[] = [];

  // Custom persona note
  if (prefs.advanced.personaNote?.trim()) {
    parts.push(`**User Context:**\n${prefs.advanced.personaNote.trim()}`);
  }

  // Communication style instructions
  const toneMap = {
    formal: "Use formal, professional language and tone.",
    friendly: "Use friendly, conversational language with warmth.",
    neutral: "Use neutral, balanced tone without formality or casualness.",
  };
  parts.push(toneMap[prefs.communication.tone]);

  const verbosityMap = {
    concise: "Keep responses brief and to the point. Avoid unnecessary elaboration.",
    normal: "Provide balanced responses with appropriate detail.",
    detailed: "Provide comprehensive, detailed responses with thorough explanations.",
  };
  parts.push(verbosityMap[prefs.communication.verbosity]);

  if (prefs.communication.codeFirst) {
    parts.push("When answering technical questions, lead with code examples before explanation.");
  }

  if (!prefs.communication.emojiUsage) {
    parts.push("Do not use emojis in your responses.");
  }

  // Safe mode
  if (prefs.advanced.safeMode) {
    parts.push("**Safe Mode Active:** Do not use any tools (web_search, file_search). Answer only using internal knowledge.");
  }

  // Location context (if shared)
  if (prefs.privacy.shareLocation !== 'off') {
    // Location will be injected separately in chat route, but we can note the preference
    parts.push("User has enabled location sharing for context-aware responses.");
  }

  return parts.join("\n");
}

/**
 * Apply user preferences to router context and model selection
 */
export interface AppliedPreferences {
  systemPromptAddendum: string;
  defaultModel: string;
  serviceTier: 'auto' | 'standard' | 'flex';
  webSearchDefault: 'never' | 'optional' | 'required';
  contextDefault: 'minimal' | 'recent' | 'full';
  allowTools: boolean;
  allowCache: boolean;
  autoExpandSources: boolean;
  strictCitations: boolean;
}

export async function loadAndApplyPreferences(): Promise<AppliedPreferences> {
  try {
    const prefs = await getFullUserPersonalization();
    
    if (!prefs) {
      return getDefaultAppliedPreferences();
    }

    return {
      systemPromptAddendum: buildPersonalizedSystemPrompt(prefs),
      defaultModel: prefs.models.defaultModel,
      serviceTier: prefs.models.serviceTier,
      webSearchDefault: prefs.models.webSearchDefault,
      contextDefault: prefs.models.contextDefault,
      allowTools: !prefs.advanced.safeMode,
      allowCache: prefs.privacy.allowCache,
      autoExpandSources: prefs.sources.autoExpandSources,
      strictCitations: prefs.sources.strictCitations,
    };
  } catch (error) {
    console.error("[preferences] Failed to load user preferences:", error);
    return getDefaultAppliedPreferences();
  }
}

function getDefaultAppliedPreferences(): AppliedPreferences {
  return {
    systemPromptAddendum: "",
    defaultModel: "auto",
    serviceTier: "auto",
    webSearchDefault: "optional",
    contextDefault: "recent",
    allowTools: true,
    allowCache: true,
    autoExpandSources: false,
    strictCitations: true,
  };
}
