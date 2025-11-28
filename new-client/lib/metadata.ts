import type { AssistantMessageMetadata, CitationMetadata } from "@/lib/chatTypes";

const SEARCH_DOMAIN_LABELS: Record<string, string> = {
  "en.wikipedia.org": "Wikipedia",
};

const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const BARE_URL_REGEX = /https?:\/\/[^\s)]+/gi;

export function extractDomainFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0]?.replace(/^www\./i, "").toLowerCase() ?? null;
  }
}

export function formatSearchSiteLabel(hostname?: string | null): string | null {
  if (!hostname) return null;
  const normalized = hostname.toLowerCase();
  return SEARCH_DOMAIN_LABELS[normalized] ?? normalized;
}

export function formatSearchedDomainsLine(domains?: string[] | null): string {
  if (!Array.isArray(domains)) return "";
  const seen = new Set<string>();
  const ordered = domains
    .map((label) => (typeof label === "string" ? label.trim() : ""))
    .filter((label) => {
      if (!label) return false;
      const normalized = label.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

  if (!ordered.length) return "";
  const preview = ordered.slice(0, 3).join(", ");
  const remainder = ordered.length - Math.min(3, ordered.length);
  const suffix = remainder > 0 ? `, +${remainder} other${remainder === 1 ? "" : "s"}` : "";
  return `Searched ${preview}${suffix}`;
}

export function formatThoughtDurationLabel(seconds: number): string {
  const rounded = Number.isFinite(seconds) ? Number(seconds.toFixed(1)) : 0;
  return `Thought for ${rounded} seconds`;
}

export function collectCitationsFromContent(content: string): {
  citations: CitationMetadata[];
  searchedDomains: string[];
  searchedSiteLabel: string | null;
} {
  const citationMap = new Map<string, CitationMetadata>();

    let markdownMatch: RegExpExecArray | null;
    while ((markdownMatch = MARKDOWN_LINK_REGEX.exec(content)) !== null) {
    const [, rawTitle, url] = markdownMatch;
    if (!url) continue;
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl || citationMap.has(normalizedUrl)) continue;
    const domain = extractDomainFromUrl(normalizedUrl);
    citationMap.set(normalizedUrl, {
      url: normalizedUrl,
      title: rawTitle?.trim() || domain,
      domain,
    });
  }

  MARKDOWN_LINK_REGEX.lastIndex = 0;

  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = BARE_URL_REGEX.exec(content)) !== null) {
    const [url] = bareMatch;
    if (!url) continue;
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl || citationMap.has(normalizedUrl)) continue;
    const domain = extractDomainFromUrl(normalizedUrl);
    citationMap.set(normalizedUrl, {
      url: normalizedUrl,
      title: domain,
      domain,
    });
  }

  BARE_URL_REGEX.lastIndex = 0;

  const citations = Array.from(citationMap.values());
  const searchedDomains = Array.from(
    new Set(citations.map((citation) => formatSearchSiteLabel(citation.domain) ?? citation.domain).filter(Boolean))
  ) as string[];
  const searchedSiteLabel = citations.length
    ? formatSearchSiteLabel(citations[citations.length - 1]?.domain) ?? citations[citations.length - 1]?.domain ?? null
    : null;

  return { citations, searchedDomains, searchedSiteLabel };
}

export function buildAssistantMetadataPayload(options: {
  base: Omit<AssistantMessageMetadata, "citations" | "searchedDomains" | "searchedSiteLabel" | "thoughtDurationLabel">;
  content: string;
  thinkingDurationMs: number;
}): AssistantMessageMetadata {
  const thinkingDurationSeconds = Math.max(options.thinkingDurationMs / 1000, 0);
  const thoughtDurationLabel = formatThoughtDurationLabel(thinkingDurationSeconds);
  const { citations, searchedDomains, searchedSiteLabel } = collectCitationsFromContent(options.content);

  return {
    ...options.base,
    thinkingDurationMs: options.thinkingDurationMs,
    thinkingDurationSeconds,
    thoughtDurationLabel,
    thinking: {
      effort: options.base.reasoningEffort,
      durationMs: options.thinkingDurationMs,
      durationSeconds: thinkingDurationSeconds,
    },
    citations,
    searchedDomains,
    searchedSiteLabel: searchedSiteLabel ?? undefined,
  };
}

function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}
