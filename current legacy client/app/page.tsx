"use client";

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import { supabase } from "../lib/supabaseClient";
import { TEST_USER_ID } from "@/lib/appConfig";
import {
  createConversationRecord,
  type ConversationMeta,
  normalizeConversationMeta,
} from "@/lib/conversations";
import {
  CODEX_AGENT_ID,
  DEFAULT_AGENT_ID,
  agentIdFromMetadata,
  type AgentId,
} from "@/lib/agents";
import type {
  FileAttachment,
  ImageAttachment,
  Source,
  SourceChip,
} from "@/lib/chatTypes";
import {
  describeModelFamily,
  getModelAndReasoningConfig,
  type ModelFamily,
  type ReasoningEffort,
  type SpeedMode,
} from "@/lib/modelConfig";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AgentsCatalog } from "@/components/agents/AgentsCatalog";

type SearchSource = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  published?: string | null;
  sourceType?: string;
  confidenceScore?: number;
};

type SearchRecord = {
  query: string;
  summary: string;
  rankedSources: SearchSource[];
  rawResults?: SearchSource[];
  fromCache?: boolean;
};

type MessageMetadata = {
  usedModel?: string;
  usedModelMode?: ModelMode;
  usedModelFamily?: ModelFamily;
  requestedModelMode?: ModelMode;
  requestedModelFamily?: ModelFamily;
  speedMode?: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  usedWebSearch?: boolean;
  searchRecords?: SearchRecord[];
  searchedDomains?: string[];
  thoughtDurationSeconds?: number;
  thoughtDurationLabel?: string;
  thinkingDurationMs?: number;
  thinking?: {
    effort?: ReasoningEffort | null;
    durationSeconds?: number;
    durationMs?: number;
  };
  sources?: SourceChip[];
  citations?: Source[];
  files?: FileAttachment[];
  vectorStoreIds?: string[];
  attachments?: ImageAttachment[];
  generationType?: "text" | "image";
  generatedImages?: GeneratedImageResult[];
  imagePrompt?: string;
  imageModelLabel?: string;
  searchedSiteLabel?: string;
};

type ChatMessage = {
  id?: string;
  persistedId?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
  files?: FileAttachment[];
  usedModel?: string;
  usedModelMode?: ModelMode;
  usedModelFamily?: ModelFamily;
  requestedModelFamily?: ModelFamily;
  speedMode?: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  usedWebSearch?: boolean;
  searchRecords?: SearchRecord[];
  metadata?: MessageMetadata;
  thoughtDurationSeconds?: number;
  thoughtDurationLabel?: string;
};

type ImageModelKey = "gpt-image-1" | "gpt-image-1-mini";

type GeneratedImageResult = {
  id: string;
  dataUrl: string;
  model: ImageModelKey;
  prompt?: string;
};

type Project = {
  id: string;
  name: string;
  created_at?: string;
};

type ViewMode = "chat" | "project";
type PrimaryView = "chat" | "agents";
type ExperienceMode = "default" | "codex";

type ModelMode = "auto" | "nano" | "mini" | "full";

const LAST_CONVERSATION_STORAGE_KEYS: Record<ExperienceMode, string> = {
  default: "chat:lastConversationId",
  codex: "codex:lastConversationId",
};

const SPEED_OPTIONS: { value: SpeedMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Balanced" },
  { value: "instant", label: "Instant", hint: "Fast replies" },
  { value: "thinking", label: "Thinking", hint: "Deeper reasoning" },
];

const SPEED_LABELS: Record<SpeedMode, string> = {
  auto: "Auto",
  instant: "Instant",
  thinking: "Thinking",
};


const MODEL_RETRY_OPTIONS: {
  value: Exclude<ModelFamily, "auto">;
  label: string;
}[] = [
  { value: "gpt-5-nano", label: "GPT 5 Nano" },
  { value: "gpt-5-mini", label: "GPT 5 Mini" },
  { value: "gpt-5.1", label: "GPT 5.1" },
  { value: "gpt-5-pro-2025-10-06", label: "GPT 5 Pro" },
];

const IMAGE_MODEL_OPTIONS: { value: ImageModelKey; label: string }[] = [
  { value: "gpt-image-1", label: "GPT Image" },
  { value: "gpt-image-1-mini", label: "GPT Image Mini" },
];

const IMAGE_MODEL_LABELS: Record<ImageModelKey, string> = {
  "gpt-image-1": "GPT Image",
  "gpt-image-1-mini": "GPT Image Mini",
};

const OTHER_MODEL_GROUPS: Array<{
  family: Exclude<ModelFamily, "auto" | "gpt-5.1">;
  label: string;
  shortLabel: string;
  supportsSpeedModes?: boolean;
}> = [
  {
    family: "gpt-5-mini",
    label: "GPT 5 Mini",
    shortLabel: describeModelFamily("gpt-5-mini"),
    supportsSpeedModes: true,
  },
  {
    family: "gpt-5-nano",
    label: "GPT 5 Nano",
    shortLabel: describeModelFamily("gpt-5-nano"),
    supportsSpeedModes: true,
  },
  {
    family: "gpt-5-pro-2025-10-06",
    label: "GPT 5 Pro",
    shortLabel: describeModelFamily("gpt-5-pro-2025-10-06"),
    supportsSpeedModes: false,
  },
];

const MAX_IMAGE_ATTACHMENTS = 4;

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_ATTACHMENTS = 6;
const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

const MAX_INPUT_HEIGHT = 176;
const MIN_INPUT_HEIGHT = 32;
const CODEX_MIN_INPUT_HEIGHT = 88;
const MAX_MESSAGE_WIDTH = 900;
const AUTO_SCROLL_THRESHOLD_PX = 140;
const MAX_PROJECT_CHAT_PREVIEW = 5;
const WAVEFORM_BAR_COUNT = 24;
const createEmptyWaveform = () =>
  Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0);

type ServerStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string }
  | { type: "file-reading-start" }
  | { type: "file-reading-complete" }
  | { type: "file-reading-error"; message?: string };

type StatusVariant = "default" | "extended" | "search" | "reading" | "error";

type ThinkingStatus =
  | { variant: "thinking"; label: string }
  | { variant: "extended"; label: string };

function StatusBubble({
  label,
  variant = "default",
  subtext,
}: {
  label: string;
  variant?: StatusVariant;
  subtext?: string;
}) {
  const baseClassMap: Record<StatusVariant, string> = {
    default: "border-white/5 bg-[#1b1b20]/90 text-zinc-400",
    extended: "border-[#4b64ff]/30 bg-[#1a1c2b]/80 text-[#b7c6ff]",
    search: "border-[#4b64ff]/30 bg-[#152033]/80 text-[#9bb8ff]",
    reading: "border-[#2f9e89]/40 bg-[#0f1f1a]/85 text-[#b8ffe8]",
    error: "border-red-500/40 bg-[#30161a]/85 text-red-200",
  };

  const dotMap: Record<StatusVariant, string> = {
    default: "bg-zinc-500",
    extended: "bg-[#8ab4ff]",
    search: "bg-[#8ab4ff]",
    reading: "bg-[#53f2c7]",
    error: "bg-red-400",
  };

  const pulseClass = "animate-pulse";

  return (
    <div
      className={`inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs overflow-hidden ${baseClassMap[variant]}`}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`h-2 w-2 flex-shrink-0 rounded-full ${dotMap[variant]} ${pulseClass}`}
          aria-hidden
        />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {subtext ? (
        <span className="ml-2 text-[11px] opacity-80 truncate">{subtext}</span>
      ) : null}
    </div>
  );
}

export default function Home() {
  return <MainApp initialPrimaryView="chat" />;
}

function CheckmarkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function VoiceWaveIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className={className}
    >
      <path d="M6 16V8" />
      <path d="M10 19V5" />
      <path d="M14 19V5" />
      <path d="M18 16V8" />
    </svg>
  );
}

function MicrophoneIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}

function ArchiveIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="4" width="18" height="4" rx="1.5" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M9 12h6" />
    </svg>
  );
}

function ShareIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M16 6l-4-4-4 4" />
      <path d="M12 2v13" />
    </svg>
  );
}

function PullRequestIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 8v8" />
      <path d="M8 6h6a4 4 0 0 1 4 4v1" />
    </svg>
  );
}

function AgentsToolIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
      <path d="M11 11L20 20" />
      <path d="M15.5 20H20V15.5" />
    </svg>
  );
}

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function formatConversationTimestamp(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatConversationDateLabel(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatThoughtDurationLabel(seconds: number) {
  return `Thought for ${seconds.toFixed(1)} seconds`;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
  );
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code({ inline, children }: { inline?: boolean; children?: ReactNode }) {
    if (inline) {
      return (
        <code className="rounded-md bg-[#2d2d30] px-1.5 py-0.5 text-[13px]">
          {children}
        </code>
      );
    }
    return (
      <pre className="mt-2 overflow-x-auto rounded-lg bg-[#111111] px-3 py-2 text-[13px]">
        <code>{children}</code>
      </pre>
    );
  },
};

function latestConvTimeForProject(projectId: string, convs: ConversationMeta[]) {
  const filtered = convs.filter(
    (c) => c.project_id === projectId && c.created_at
  );
  if (filtered.length === 0) return null;
  return filtered.reduce((max, c) => {
    const t = c.created_at!;
    if (!max) return t;
    return t > max ? t : max;
  }, filtered[0].created_at!);
}

function getNewestConversation(conversations: ConversationMeta[]) {
  if (conversations.length === 0) return null;
  return [...conversations].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || "")
  )[0];
}

function legacyModeFromFamily(family: ModelFamily): ModelMode {
  switch (family) {
    case "gpt-5-nano":
      return "nano";
    case "gpt-5-mini":
      return "mini";
    case "gpt-5.1":
      return "full";
    case "gpt-5-pro-2025-10-06":
      return "full";
    default:
      return "auto";
  }
}

function extractDomainFromUrl(url?: string | null) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  }
}

const SEARCH_DOMAIN_LABELS: Record<string, string> = {
  "en.wikipedia.org": "Wikipedia",
};

function formatSearchSiteLabel(hostname?: string | null) {
  if (!hostname) return null;
  const normalized = hostname.toLowerCase();
  return SEARCH_DOMAIN_LABELS[normalized] ?? normalized;
}

function formatSearchedDomainsLine(domains?: string[] | null) {
  if (!Array.isArray(domains)) {
    return "";
  }
  const seen = new Set<string>();
  const ordered = domains
    .map((label) => (typeof label === "string" ? label.trim() : ""))
    .filter((label) => {
      if (!label) return false;
      const normalized = label.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
  if (!ordered.length) {
    return "";
  }
  const preview = ordered.slice(0, 3).join(", ");
  const remainder = ordered.length - Math.min(3, ordered.length);
  const suffix =
    remainder > 0 ? `, +${remainder} other${remainder === 1 ? "" : "s"}` : "";
  return `Searched ${preview}${suffix}`;
}

function buildWaveformPath(levels: number[], width = 100, height = 32) {
  if (!levels.length) {
    return `M0 ${height / 2} L${width} ${height / 2}`;
  }
  const centerY = height / 2;
  const step = levels.length > 1 ? width / (levels.length - 1) : width;
  let path = `M0 ${centerY}`;
  levels.forEach((level, index) => {
    const intensity = Math.max(0, Math.min(1, level));
    const amplitude = 2 + intensity * (centerY - 4);
    const direction = index % 2 === 0 ? 1 : -1;
    const x = Number((index * step).toFixed(2));
    const y = Number((centerY - direction * amplitude).toFixed(2));
    path += ` L${x} ${y}`;
  });
  path += ` L${width} ${centerY}`;
  return path;
}

function deriveSearchDomain(
  searchRecords?: SearchRecord[] | null,
  citations?: Source[] | null
) {
  const recordDomain = searchRecords
    ?.flatMap((record) => [
      ...(record.rankedSources ?? []),
      ...(record.rawResults ?? []),
    ])
    .map((source) => source.domain || extractDomainFromUrl(source.url))
    .find((domain) => !!domain);
  if (recordDomain) {
    return formatSearchSiteLabel(recordDomain);
  }
  const citationDomain = citations
    ?.map((source) => source.domain || extractDomainFromUrl(source.url))
    .find((domain) => !!domain);
  if (citationDomain) {
    return formatSearchSiteLabel(citationDomain);
  }
  return null;
}

function mergeSearchedDomains(
  existing: string[] | undefined,
  additions: string[]
) {
  const sanitizedExisting = Array.isArray(existing)
    ? existing
        .map((label) => (typeof label === "string" ? label.trim() : ""))
        .filter((label) => label.length > 0)
    : [];
  if (!additions.length) {
    return sanitizedExisting;
  }
  const seen = new Set(sanitizedExisting.map((label) => label.toLowerCase()));
  const merged = [...sanitizedExisting];
  additions.forEach((label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    merged.push(trimmed);
  });
  return merged;
}

function collectDomainsFromSearchRecords(records?: SearchRecord[] | null) {
  const additions: string[] = [];
  if (!Array.isArray(records)) {
    return additions;
  }
  records.forEach((record) => {
    const ranked = Array.isArray(record.rankedSources)
      ? record.rankedSources
      : [];
    const raw = Array.isArray(record.rawResults) ? record.rawResults : [];
    [...ranked, ...raw].forEach((source) => {
      const domainLabel = formatSearchSiteLabel(
        source.domain || extractDomainFromUrl(source.url)
      );
      if (domainLabel) {
        additions.push(domainLabel);
      }
    });
  });
  return additions;
}

function collectDomainsFromCitations(citations?: Source[] | null) {
  const additions: string[] = [];
  if (!Array.isArray(citations)) {
    return additions;
  }
  citations.forEach((source) => {
    const domainLabel = formatSearchSiteLabel(
      source.domain || extractDomainFromUrl(source.url)
    );
    if (domainLabel) {
      additions.push(domainLabel);
    }
  });
  return additions;
}

function extractDomainsFromMetadataChunk(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return [] as string[];
  }
  const webSearchEntries = Array.isArray(
    (metadata as { web_search?: unknown }).web_search
  )
    ? ((metadata as { web_search: unknown[] }).web_search || [])
    : [];
  const domains: string[] = [];
  webSearchEntries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const results = Array.isArray((entry as { results?: unknown }).results)
      ? ((entry as { results: unknown[] }).results || [])
      : [];
    results.forEach((result) => {
      if (!result || typeof result !== "object") {
        return;
      }
      const url = (result as { url?: unknown }).url;
      if (typeof url === "string" && url.trim().length > 0) {
        const domainLabel = formatSearchSiteLabel(extractDomainFromUrl(url));
        if (domainLabel) {
          domains.push(domainLabel);
        }
      }
    });
  });
  return domains;
}

function getLatestSearchedDomainLabel(metadata?: MessageMetadata | null) {
  if (!metadata) {
    return null;
  }
  const domainList = Array.isArray(metadata.searchedDomains)
    ? metadata.searchedDomains
        .map((label) => (typeof label === "string" ? label.trim() : ""))
        .filter((label) => label.length > 0)
    : [];
  if (domainList.length > 0) {
    return domainList[domainList.length - 1];
  }
  if (metadata.searchedSiteLabel && metadata.searchedSiteLabel.trim()) {
    return metadata.searchedSiteLabel.trim();
  }
  return deriveSearchDomain(metadata.searchRecords, metadata.citations);
}

export function MainApp({
  initialPrimaryView = "chat",
  mode = "default",
}: {
  initialPrimaryView?: PrimaryView;
  mode?: ExperienceMode;
}) {
  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [modelFamily, setModelFamily] = useState<ModelFamily>("gpt-5.1");
  const [speedMode, setSpeedMode] = useState<SpeedMode>("auto");
  const [forceWebSearch, setForceWebSearch] = useState(false);
  const [createImageArmed, setCreateImageArmed] = useState(false);
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>(
    []
  );
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [streamingConversationId, setStreamingConversationId] =
    useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [allConversations, setAllConversations] = useState<ConversationMeta[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [pendingNewChat, setPendingNewChat] = useState(false);
  const [pendingNewChatProjectId, setPendingNewChatProjectId] = useState<
    string | null
  >(null);
  const [codexActiveTab, setCodexActiveTab] = useState<
    "tasks" | "code-reviews" | "archive"
  >("tasks");

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(
    null
  );
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);

  const skipAutoLoadRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const filePickerInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const router = useRouter();
  const codexLandingScrollRef = useRef<HTMLDivElement | null>(null);
  const codexLandingScrollPositionRef = useRef(0);
  const isAgentsView = initialPrimaryView === "agents";
  const isCodexMode = mode === "codex";
  const allowProjectSections = !isCodexMode;
  const showAgentsCatalog = !isCodexMode && isAgentsView;
  const defaultAgentId = isCodexMode ? CODEX_AGENT_ID : DEFAULT_AGENT_ID;
  const conversationStorageKey = LAST_CONVERSATION_STORAGE_KEYS[mode];
  const resolvedMinInputHeight = isCodexMode
    ? CODEX_MIN_INPUT_HEIGHT
    : MIN_INPUT_HEIGHT;
  const codexHeaderActions = [
    { label: "Archive", Icon: ArchiveIcon },
    { label: "Share", Icon: ShareIcon },
    { label: "View PR", Icon: PullRequestIcon },
  ];
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const waveformAnimationRef = useRef<number | null>(null);
  const previousConversationIdRef = useRef<string | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activeAssistantMessageId, setActiveAssistantMessageId] =
    useState<string | null>(null);
  const [expandedSourcesId, setExpandedSourcesId] = useState<string | null>(
    null
  );
  const [openModelMenuId, setOpenModelMenuId] = useState<string | null>(null);
  const [headerModelMenuOpen, setHeaderModelMenuOpen] = useState(false);
  const [otherModelsMenuOpen, setOtherModelsMenuOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [thinkingStatus, setThinkingStatus] = useState<ThinkingStatus | null>(
    null
  );
  const [searchIndicator, setSearchIndicator] = useState<
    { message: string; variant: "running" | "error"; domains: string[] } | null
  >(null);
  const [liveSearchDomains, setLiveSearchDomains] = useState<string[]>([]);
  const [fileReadingIndicator, setFileReadingIndicator] = useState<
    "running" | "error" | null
  >(null);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [waveformLevels, setWaveformLevels] = useState<number[]>(() =>
    createEmptyWaveform()
  );
  const [isMultilineInput, setIsMultilineInput] = useState(false);
  const applyLiveSearchDomains = useCallback(
    (domains: string[]) => {
      if (!domains.length) {
        return;
      }
      setSearchIndicator((prev) => {
        if (!prev || prev.variant !== "running") {
          return prev;
        }
        const merged = mergeSearchedDomains(prev.domains, domains);
        const unchanged =
          merged.length === prev.domains.length &&
          merged.every((label, index) => label === prev.domains[index]);
        if (unchanged) {
          return prev;
        }
        return { ...prev, domains: merged };
      });
    },
    []
  );

  const filterConversationsForMode = useCallback(
    (list: ConversationMeta[]) =>
      list.filter((conversation) => {
        const agentId = agentIdFromMetadata(conversation.metadata);
        if (isCodexMode) {
          return agentId === CODEX_AGENT_ID;
        }
        return !agentId || agentId === DEFAULT_AGENT_ID;
      }),
    [isCodexMode]
  );

  type ConversationStateUpdater =
    | ConversationMeta[]
    | ((prev: ConversationMeta[]) => ConversationMeta[]);

  const applyConversationState = useCallback(
    (
      updater: ConversationStateUpdater,
      afterUpdate?: (
        nextAll: ConversationMeta[],
        nextFiltered: ConversationMeta[]
      ) => void
    ) => {
      setAllConversations((prevAll) => {
        const nextAll =
          typeof updater === "function"
            ? (updater as (prev: ConversationMeta[]) => ConversationMeta[])(
                prevAll
              )
            : updater;
        const nextFiltered = filterConversationsForMode(nextAll);
        setConversations(nextFiltered);
        if (afterUpdate) {
          afterUpdate(nextAll, nextFiltered);
        }
        return nextAll;
      });
    },
    [filterConversationsForMode]
  );

  const previousModeRef = useRef(isCodexMode);
  useEffect(() => {
    if (previousModeRef.current !== isCodexMode) {
      previousModeRef.current = isCodexMode;
      setConversations(filterConversationsForMode(allConversations));
    }
  }, [allConversations, filterConversationsForMode, isCodexMode]);

  const loadConversationsFromSupabase = useCallback(async () => {
    try {
      const response = await fetch("/api/conversations", {
        cache: "no-store",
      });

      if (!response.ok) {
        console.warn("Failed to load conversations", {
          status: response.status,
          statusText: response.statusText,
        });
        return [] as ConversationMeta[];
      }

      const payload = (await response.json()) as {
        conversations?: ConversationMeta[];
      };
      const rows = Array.isArray(payload.conversations)
        ? payload.conversations
        : [];
      const normalized = rows
        .map((row) => normalizeConversationMeta(row))
        .filter((row): row is ConversationMeta => Boolean(row));
      return normalized;
    } catch (error) {
      console.warn("Failed to load conversations", error);
      return [] as ConversationMeta[];
    }
  }, []);

  const getConversationAgentId = useCallback(
    (conversationId: string | null) => {
      if (!conversationId) {
        return defaultAgentId;
      }
      const target = conversations.find((c) => c.id === conversationId);
      return agentIdFromMetadata(target?.metadata) ?? defaultAgentId;
    },
    [conversations, defaultAgentId]
  );

  const cleanupWaveformVisualizer = useCallback(() => {
    if (waveformAnimationRef.current) {
      cancelAnimationFrame(waveformAnimationRef.current);
      waveformAnimationRef.current = null;
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    const ctx = audioContextRef.current;
    if (ctx) {
      ctx.close().catch(() => null);
      audioContextRef.current = null;
    }
    waveformDataRef.current = null;
    setWaveformLevels(createEmptyWaveform());
  }, []);

  useEffect(() => {
    if (!headerModelMenuOpen) {
      setOtherModelsMenuOpen(false);
    }
  }, [headerModelMenuOpen]);

  useEffect(() => () => cleanupWaveformVisualizer(), [
    cleanupWaveformVisualizer,
  ]);

  useEffect(() => {
    if (isRecording || isTranscribing) {
      setComposerMenuOpen(false);
    }
  }, [isRecording, isTranscribing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("conversationHistory");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const hydrated = new Map<string, ChatMessage[]>();
      parsed.forEach((entry) => {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          Array.isArray(entry[1])
        ) {
          hydrated.set(entry[0], entry[1] as ChatMessage[]);
        }
      });
      conversationHistoryRef.current = hydrated;
    } catch (error) {
      console.warn("Failed to hydrate conversation history", error);
    }
  }, []);

  useEffect(() => {
    if (!isCodexMode) return;
    if (selectedConversationId) return;
    const node = codexLandingScrollRef.current;
    if (node) {
      node.scrollTop = codexLandingScrollPositionRef.current;
    }
  }, [isCodexMode, selectedConversationId]);
  const [rowMenu, setRowMenu] = useState<
    { type: "conversation" | "project"; id: string } | null
  >(null);
  const [moveMenuConversationId, setMoveMenuConversationId] =
    useState<string | null>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<
    { id: string; title: string } | null
  >(null);
  const [deleteConversationLoading, setDeleteConversationLoading] =
    useState(false);
  const responseTimingRef = useRef({
    start: null as number | null,
    firstToken: null as number | null,
    assistantMessageId: null as string | null,
  });
  const longThinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMetadataPersistRef = useRef(new Map<string, MessageMetadata>());
  const conversationHistoryRef = useRef(new Map<string, ChatMessage[]>());

  const persistConversationHistory = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const serialized = JSON.stringify(
        Array.from(conversationHistoryRef.current.entries())
      );
      window.localStorage.setItem("conversationHistory", serialized);
    } catch (error) {
      console.warn("Failed to persist conversation history", error);
    }
  }, []);

  const removeConversationFromCache = useCallback(
    (conversationId: string) => {
      if (!conversationHistoryRef.current.has(conversationId)) return;
      conversationHistoryRef.current.delete(conversationId);
      persistConversationHistory();
    },
    [persistConversationHistory]
  );

  const clearLongThinkTimer = useCallback(() => {
    if (longThinkTimerRef.current) {
      clearTimeout(longThinkTimerRef.current);
      longThinkTimerRef.current = null;
    }
  }, []);

  const resetThinkingIndicator = useCallback(() => {
    clearLongThinkTimer();
    setThinkingStatus(null);
  }, [clearLongThinkTimer]);

  const showThinkingIndicator = useCallback(
    (effort?: ReasoningEffort | null) => {
      clearLongThinkTimer();
      if (!effort) {
        setThinkingStatus(null);
        return;
      }
      if (effort === "medium" || effort === "high") {
        setThinkingStatus({ variant: "extended", label: "Thinking for longer…" });
        return;
      }
      setThinkingStatus({ variant: "thinking", label: "Thinking" });
      if (effort === "low") {
        longThinkTimerRef.current = setTimeout(() => {
          setThinkingStatus({ variant: "extended", label: "Thinking for longer…" });
          longThinkTimerRef.current = null;
        }, 4000);
      }
    },
    [clearLongThinkTimer]
  );

  function scrollToBottom(opts: { behavior?: ScrollBehavior } = {}) {
    const el = chatContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: opts.behavior ?? "smooth",
    });
  }

  function handleJumpToBottom() {
    scrollToBottom({ behavior: "smooth" });
    setAutoScrollEnabled(true);
    setShowScrollButton(false);
  }

  const rememberCodexLandingScroll = useCallback(() => {
    if (!isCodexMode) return;
    if (codexLandingScrollRef.current) {
      codexLandingScrollPositionRef.current =
        codexLandingScrollRef.current.scrollTop;
    }
  }, [isCodexMode]);

  // ------------------------------------------------------------
  // INITIAL LOAD: projects + conversations
  // ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (allowProjectSections) {
          const { data: projData } = await supabase
            .from("projects")
            .select("id, name, created_at")
            .eq("user_id", TEST_USER_ID);
          if (!cancelled) {
            setProjects((projData || []) as Project[]);
          }
        } else if (!cancelled) {
          setProjects([]);
          setSelectedProjectId(null);
        }

        const loadedConversations = await loadConversationsFromSupabase();
        if (cancelled) {
          return;
        }
        applyConversationState(loadedConversations);
        const filtered = filterConversationsForMode(loadedConversations);

        setSelectedConversationId(null);
        setSelectedProjectId(null);
        setViewMode("chat");
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load conversations", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    allowProjectSections,
    applyConversationState,
    conversationStorageKey,
    filterConversationsForMode,
    loadConversationsFromSupabase,
  ]);

  // ------------------------------------------------------------
  // LOAD MESSAGES
  // ------------------------------------------------------------
  const loadMessages = useCallback(
    async (
      conversationId: string,
      opts: { silent?: boolean; force?: boolean } = {}
    ) => {
      if (!conversationId) return;
      if (!opts.silent) setIsLoadingMessages(true);

      type ApiMessageRow = {
        id?: string;
        role: "user" | "assistant";
        content: string;
        metadata?: MessageMetadata | null;
      };

      let rows: ApiMessageRow[] = [];
      try {
        const response = await fetch(
          `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error(
            `Failed to load messages (${response.status} ${response.statusText})`
          );
        }
        const payload = (await response.json()) as {
          messages?: ApiMessageRow[];
        };
        rows = Array.isArray(payload.messages) ? payload.messages : [];
      } catch (error) {
        console.error("Load messages error", error);
        if (!(conversationHistoryRef.current.get(conversationId)?.length ?? 0)) {
          setMessages([]);
        }
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      if (!opts.force && selectedConversationId !== conversationId) {
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      if (!opts.force && skipAutoLoadRef.current === conversationId) {
        skipAutoLoadRef.current = null;
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      console.log(
        `[historyDebug] loaded ${rows.length} messages for conversationId=${conversationId}`
      );
      const nextMessages = rows.map((m) => {
        const rawMetadata = (m.metadata || {}) as MessageMetadata;
        const sanitizedMetadata: MessageMetadata = {
          ...rawMetadata,
        };
        delete sanitizedMetadata.thinking;
        const sanitizedDomains = Array.isArray(rawMetadata.searchedDomains)
          ? rawMetadata.searchedDomains
              .map((label) => (typeof label === "string" ? label.trim() : ""))
              .filter((label) => label.length > 0)
          : [];
        if (sanitizedDomains.length > 0) {
          sanitizedMetadata.searchedDomains = sanitizedDomains;
        }
        if (rawMetadata.thinking) {
          const sanitizedThinking: NonNullable<MessageMetadata["thinking"]> = {};
          if (rawMetadata.thinking.effort === null) {
            sanitizedThinking.effort = null;
          } else if (isReasoningEffort(rawMetadata.thinking.effort)) {
            sanitizedThinking.effort = rawMetadata.thinking.effort;
          }
          if (typeof rawMetadata.thinking.durationMs === "number") {
            sanitizedThinking.durationMs = rawMetadata.thinking.durationMs;
          }
          if (typeof rawMetadata.thinking.durationSeconds === "number") {
            sanitizedThinking.durationSeconds =
              rawMetadata.thinking.durationSeconds;
          }
          if (
            typeof sanitizedThinking.durationMs === "number" ||
            typeof sanitizedThinking.durationSeconds === "number" ||
            typeof sanitizedThinking.effort !== "undefined"
          ) {
            sanitizedMetadata.thinking = sanitizedThinking;
          }
        }
        const attachments = Array.isArray(sanitizedMetadata.attachments)
          ? sanitizedMetadata.attachments
          : [];
        const files = Array.isArray(sanitizedMetadata.files)
          ? sanitizedMetadata.files
          : [];
        const timingMs =
          typeof sanitizedMetadata.thinking?.durationMs === "number"
            ? sanitizedMetadata.thinking.durationMs
            : typeof sanitizedMetadata.thinkingDurationMs === "number"
              ? sanitizedMetadata.thinkingDurationMs
              : null;
        const thoughtSeconds =
          typeof sanitizedMetadata.thinking?.durationSeconds === "number"
            ? sanitizedMetadata.thinking.durationSeconds
            : typeof timingMs === "number"
              ? timingMs / 1000
              : sanitizedMetadata.thoughtDurationSeconds;
        const thoughtLabel =
          sanitizedMetadata.thoughtDurationLabel &&
          sanitizedMetadata.thoughtDurationLabel.trim().length > 0
            ? sanitizedMetadata.thoughtDurationLabel
            : typeof thoughtSeconds === "number"
              ? formatThoughtDurationLabel(thoughtSeconds)
              : undefined;
        return {
          id: m.id,
          persistedId: m.id,
          role: m.role,
          content: m.content,
          attachments,
          files,
          usedModel: sanitizedMetadata.usedModel,
          usedModelMode: sanitizedMetadata.usedModelMode,
          usedModelFamily: sanitizedMetadata.usedModelFamily,
          requestedModelFamily: sanitizedMetadata.requestedModelFamily,
          speedMode: sanitizedMetadata.speedMode,
          reasoningEffort: sanitizedMetadata.reasoningEffort,
          usedWebSearch: sanitizedMetadata.usedWebSearch,
          searchRecords: sanitizedMetadata.searchRecords || [],
          metadata: sanitizedMetadata,
          thoughtDurationSeconds: thoughtSeconds,
          thoughtDurationLabel: thoughtLabel,
        } as ChatMessage;
      });

      if (
        nextMessages.length === 0 &&
        (conversationHistoryRef.current.get(conversationId)?.length ?? 0) > 0
      ) {
        console.warn(
          "Skipping empty history update because cached messages exist",
          conversationId
        );
      } else {
        setMessages(nextMessages);
      }

      if (!opts.silent) setIsLoadingMessages(false);
    },
    [selectedConversationId]
  );

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setIsLoadingMessages(false);
      return;
    }

    if (skipAutoLoadRef.current === selectedConversationId) {
      skipAutoLoadRef.current = null;
      setIsLoadingMessages(false);
      return;
    }

    const cachedMessages = conversationHistoryRef.current.get(
      selectedConversationId
    );
    if (cachedMessages) {
      setMessages(cachedMessages);
    } else {
      setMessages([]);
    }

    loadMessages(selectedConversationId);
  }, [selectedConversationId, loadMessages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!conversationStorageKey) {
      return;
    }
    if (selectedConversationId) {
      window.localStorage.setItem(
        conversationStorageKey,
        selectedConversationId
      );
    } else {
      window.localStorage.removeItem(conversationStorageKey);
    }
  }, [conversationStorageKey, selectedConversationId]);

  // ------------------------------------------------------------
  // AUTOSCROLL WHEN MESSAGES CHANGE
  // ------------------------------------------------------------
  useEffect(() => {
    if (!autoScrollEnabled) return;
    scrollToBottom({ behavior: isStreaming ? "smooth" : "auto" });
  }, [messages, autoScrollEnabled, isStreaming]);

  useEffect(() => {
    if (!selectedConversationId) return;
    conversationHistoryRef.current.set(selectedConversationId, messages);
    persistConversationHistory();
  }, [messages, selectedConversationId, persistConversationHistory]);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX;
      setAutoScrollEnabled(nearBottom);
      const hasScrollableContent = el.scrollHeight > el.clientHeight + 8;
      setShowScrollButton(!nearBottom && hasScrollableContent);
    };
    handleScroll();
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const measuredHeight = Math.max(el.scrollHeight, resolvedMinInputHeight);
    const nextHeight = Math.min(measuredHeight, MAX_INPUT_HEIGHT);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY =
      el.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
    const isMulti = el.scrollHeight > resolvedMinInputHeight + 2;
    setIsMultilineInput((prev) => (prev === isMulti ? prev : isMulti));
  }, [input, resolvedMinInputHeight]);

  useEffect(() => {
    const handleWindowClick = () => {
      setOpenModelMenuId(null);
      setComposerMenuOpen(false);
      setRowMenu(null);
      setMoveMenuConversationId(null);
      setHeaderModelMenuOpen(false);
      setOtherModelsMenuOpen(false);
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  useEffect(() => {
    if (!searchIndicator || searchIndicator.variant !== "error") {
      return;
    }
    const timeout = setTimeout(() => setSearchIndicator(null), 5000);
    return () => clearTimeout(timeout);
  }, [searchIndicator]);

  useEffect(() => {
    if (fileReadingIndicator !== "error") {
      return;
    }
    const timeout = setTimeout(() => setFileReadingIndicator(null), 5000);
    return () => clearTimeout(timeout);
  }, [fileReadingIndicator]);

  useEffect(() => () => clearLongThinkTimer(), [clearLongThinkTimer]);

  // ------------------------------------------------------------
  // MEMOIZED SORTED LISTS
  // ------------------------------------------------------------
  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || "")
      ),
    [conversations]
  );

  const sortedProjects = useMemo(() => {
    if (!allowProjectSections) {
      return [] as Project[];
    }
    return [...projects].sort((a, b) => {
      const lastA =
        latestConvTimeForProject(a.id, conversations) || a.created_at || "";
      const lastB =
        latestConvTimeForProject(b.id, conversations) || b.created_at || "";
      return lastB.localeCompare(lastA);
    });
  }, [allowProjectSections, projects, conversations]);

  const projectSidebarChats = useMemo(() => {
    const map = new Map<string, ConversationMeta[]>();
    if (!allowProjectSections) {
      return map;
    }
    sortedConversations.forEach((conversation) => {
      if (!conversation.project_id) {
        return;
      }
      if (!map.has(conversation.project_id)) {
        map.set(conversation.project_id, []);
      }
      map.get(conversation.project_id)?.push(conversation);
    });
    return map;
  }, [allowProjectSections, sortedConversations]);

  const currentProject = allowProjectSections
    ? projects.find((p) => p.id === selectedProjectId)
    : null;
  const selectedConversationMeta = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );
  const sidebarActiveProjectId = allowProjectSections
    ? selectedProjectId ?? selectedConversationMeta?.project_id ?? null
    : null;

  const projectChats = useMemo(() => {
    if (!allowProjectSections || !selectedProjectId) {
      return [] as ConversationMeta[];
    }
    return sortedConversations.filter((c) => c.project_id === selectedProjectId);
  }, [allowProjectSections, sortedConversations, selectedProjectId]);

  const unassignedChats = useMemo(
    () => sortedConversations.filter((c) => !c.project_id),
    [sortedConversations]
  );

  const inProjectView =
    allowProjectSections && viewMode === "project" && !!selectedProjectId;
  const trimmedInput = input.trim();
  const hasComposerAttachments =
    imageAttachments.length > 0 || fileAttachments.length > 0;
  const canSendMessage = createImageArmed
    ? trimmedInput.length > 0 && !hasComposerAttachments
    : trimmedInput.length > 0 || hasComposerAttachments;
  const searchStatusSubtext =
    searchIndicator && searchIndicator.variant === "running"
      ? formatSearchedDomainsLine(searchIndicator.domains)
      : "";
  const headerModelLabel =
    modelFamily === "auto"
      ? `Auto (${describeModelFamily("gpt-5-mini")})`
      : describeModelFamily(modelFamily);
  const headerSpeedDisplay =
    modelFamily === "gpt-5-pro-2025-10-06" || speedMode === "auto"
      ? null
      : SPEED_LABELS[speedMode];
  const imageAttachmentLimitReached =
    imageAttachments.length >= MAX_IMAGE_ATTACHMENTS;
  const isComposerStreaming =
    isStreaming && streamingConversationId === selectedConversationId;
  type PrimaryActionMode =
    | "stop"
    | "confirm-recording"
    | "transcribing"
    | "send"
    | "idle";
  const primaryActionMode: PrimaryActionMode = isComposerStreaming
    ? "stop"
    : isRecording
      ? "confirm-recording"
      : isTranscribing
        ? "transcribing"
        : canSendMessage
          ? "send"
          : "idle";
  const primaryButtonDisabled = primaryActionMode === "transcribing";
  const primaryButtonAriaLabel = (() => {
    switch (primaryActionMode) {
      case "stop":
        return "Stop response";
      case "confirm-recording":
        return "Finish voice recording";
      case "transcribing":
        return "Transcribing voice input";
      case "send":
        return createImageArmed ? "Send image prompt" : "Send message";
      case "idle":
      default:
        return "Voice chat (coming soon)";
    }
  })();
  const composerSize: "default" | "tall" = isCodexMode ? "tall" : "default";
  const composerShapeClass = isCodexMode
    ? "rounded-[28px] py-3.5"
    : isMultilineInput
      ? composerSize === "tall"
        ? "rounded-[32px] py-3.5"
        : "rounded-[24px] py-2.5"
      : composerSize === "tall"
        ? "rounded-full py-3"
        : "rounded-full py-1.5";
  const composerPlaceholder = isTranscribing
    ? "Transcribing voice input…"
    : "Message the assistant…";
  const composerGapClass = isCodexMode ? "gap-3" : "gap-2";
  const composerPaddingX = isCodexMode ? "px-4" : "px-3";
  const composerSurfaceClass = isCodexMode
    ? "border border-white/12 bg-[#101014] shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
    : "border border-white/10 bg-[#303030] shadow-[0_0_0_1px_rgba(0,0,0,0.35)]";
  const recordingSurfaceClass = isCodexMode
    ? "border border-red-500/40 bg-[#2b0e13] shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
    : "border border-red-500/40 bg-[#1b0a0d]/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]";
  const composerContainerClass = isRecording
    ? `flex w-full items-center ${composerGapClass} ${recordingSurfaceClass} ${composerPaddingX} transition ${composerShapeClass}`
    : `flex w-full items-center ${composerGapClass} ${composerSurfaceClass} ${composerPaddingX} transition ${composerShapeClass}`;
  const recordingWaveformPath = useMemo(
    () => buildWaveformPath(waveformLevels),
    [waveformLevels]
  );
  const micDisabled = isRecording || isTranscribing || isComposerStreaming;
  const renderPrimaryButton = () => (
    <button
      type="button"
      onClick={() => {
        console.log("[SEND_BUTTON] click", {
          primaryActionMode,
          canSendMessage,
          isStreaming,
          createImageArmed,
        });
        handlePrimaryAction();
      }}
      disabled={primaryButtonDisabled}
      className={`flex h-10 w-10 items-center justify-center rounded-full bg-[#2b6eea] text-white shadow-lg transition focus:outline-none ${
        primaryActionMode === "stop"
          ? "hover:bg-[#225fd0]"
          : "hover:bg-[#3c7cff]"
      } ${primaryButtonDisabled ? "cursor-not-allowed opacity-40" : ""}`}
      aria-label={primaryButtonAriaLabel}
    >
      {primaryActionMode === "stop" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="currentColor"
        >
          <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
        </svg>
      ) : primaryActionMode === "confirm-recording" ? (
        <CheckmarkIcon className="h-5 w-5" />
      ) : primaryActionMode === "transcribing" ? (
        <span className="inline-flex h-5 w-5 items-center justify-center">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
        </span>
      ) : primaryActionMode === "send" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 18V6" />
          <path d="M6 12l6-6 6 6" />
        </svg>
      ) : (
        <VoiceWaveIcon className="h-5 w-5" />
      )}
    </button>
  );

  type ComposerPanelVariant = "default" | "codexTop" | "codexBottom";
  type ChatInterfaceOptions = {
    composerVariant?: ComposerPanelVariant;
    messageContainerClass?: string;
    showInlineTitle?: boolean;
    wrapperClass?: string;
  };

  const renderComposerArea = (
    panelVariant: ComposerPanelVariant = "default"
  ) => {
    const wrapperClassMap: Record<ComposerPanelVariant, string> = {
      default: "shrink-0 border-t border-[#202123] bg-[#212121] px-4 py-3",
      codexBottom:
        "shrink-0 border-t border-white/10 bg-[#050509] px-6 py-5",
      codexTop: "w-full px-6 pt-6",
    };
    const innerClass =
      panelVariant === "codexTop"
        ? "mx-auto flex w-full max-w-3xl flex-col gap-3"
        : "mx-auto flex w-full flex-col gap-3";
    return (
      <div className={wrapperClassMap[panelVariant]}>
        <div className={innerClass} style={{ maxWidth: MAX_MESSAGE_WIDTH }}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {forceWebSearch && (
                <button
                  type="button"
                  onClick={() => setForceWebSearch(false)}
                  className="flex items-center gap-1 rounded-full border border-[#4b64ff]/50 bg-[#1a1e2f] px-3 py-1 text-[11px] text-[#a5bfff]"
                >
                  <span className="text-base leading-none">🌐</span>
                  <span>Web search</span>
                </button>
              )}
              {createImageArmed && (
                <button
                  type="button"
                  onClick={() => {
                    setCreateImageArmed(false);
                    setComposerError(null);
                  }}
                  className="flex items-center gap-1 rounded-full border border-white/30 bg-[#2b2b31] px-3 py-1 text-[11px] text-zinc-200"
                >
                  <span className="text-base leading-none">🎨</span>
                  <span>Create image</span>
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {imageAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {imageAttachments.map((attachment) => {
                    const sizeLabel = formatAttachmentSize(attachment.size);
                    return (
                      <div
                        key={`${attachment.id}-preview`}
                        className="group flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2 py-1"
                      >
                        <div className="h-12 w-12 overflow-hidden rounded-xl bg-black/20">
                          <Image
                            src={attachment.dataUrl}
                            alt={attachment.name || "Attachment"}
                            width={48}
                            height={48}
                            className="h-full w-full object-cover"
                            unoptimized
                          />
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="truncate text-[12px] font-medium text-white">
                            {attachment.name || "Image"}
                          </div>
                          {sizeLabel && (
                            <div className="text-[10px] uppercase tracking-wide text-white/50">
                              {sizeLabel}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label="Remove attachment"
                          onClick={() => handleRemoveImageAttachment(attachment.id)}
                          className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {fileAttachments.length > 0 && (
                <div className="space-y-2">
                  {fileAttachments.map((file) => {
                    const sizeLabel = formatAttachmentSize(file.size);
                    return (
                      <div
                        key={`${file.id}-file`}
                        className="group flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1b1b21] text-white/70">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.6}
                          >
                            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                            <path d="M14 3v6h6" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="truncate text-[12px] font-medium text-white">
                            {file.name || "File"}
                          </div>
                          {sizeLabel && (
                            <div className="text-[10px] uppercase tracking-wide text-white/50">
                              {sizeLabel}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label="Remove file attachment"
                          onClick={() => handleRemoveFileAttachment(file.id)}
                          className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex w-full flex-col gap-2">
                  <div className={composerContainerClass}>
                    {isRecording ? (
                      <>
                        <button
                          type="button"
                          aria-label="Cancel voice recording"
                          onClick={() => cancelRecordingFlow({ clearInput: true })}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-red-500/60 bg-red-500/10 text-red-300 transition hover:bg-red-500/20"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                          >
                            <path d="M6 6l12 12M6 18 18 6" />
                          </svg>
                        </button>
                        <div className="flex flex-1 items-center py-1.5" aria-live="polite">
                          <svg viewBox="0 0 100 32" className="h-8 w-full" aria-hidden>
                            <path
                              d={recordingWaveformPath}
                              fill="none"
                              stroke="#f87171"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                        {renderPrimaryButton()}
                      </>
                    ) : (
                      <>
                        <div className="relative mr-1 flex shrink-0 items-center self-end">
                          <button
                            type="button"
                            aria-label="Composer options"
                            aria-expanded={!isRecording ? composerMenuOpen : undefined}
                            disabled={isRecording}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isRecording) {
                                return;
                              }
                              setComposerMenuOpen((prev) => !prev);
                            }}
                            className={`flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 ${
                              isRecording ? "cursor-not-allowed text-white/30" : ""
                            }`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              className="h-5 w-5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                            >
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                          </button>
                          {!isRecording && composerMenuOpen && (
                            <div
                              onClick={(event) => event.stopPropagation()}
                              className="absolute left-0 bottom-full z-30 mb-2 w-60 rounded-2xl border border-[#2a2a30] bg-[#101014] p-1.5 text-left text-xs shadow-2xl"
                            >
                              <div className="flex flex-col text-[13px] text-white/80">
                                {isCodexMode ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setInput((prev) =>
                                          prev && prev.trim().length > 0
                                            ? prev
                                            : "Plan:"
                                        );
                                        setComposerMenuOpen(false);
                                        textareaRef.current?.focus();
                                      }}
                                      className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                    >
                                      Plan
                                    </button>
                                    <div className="my-1 h-px bg-white/10" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleAddFilesClick();
                                        setComposerMenuOpen(false);
                                      }}
                                      className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                    >
                                      Add photos &amp; files
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleTakePhotoClick();
                                        setComposerMenuOpen(false);
                                      }}
                                      className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                    >
                                      Take photo
                                    </button>
                                    <div className="my-1 h-px bg-white/10" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleAddFilesClick();
                                        setComposerMenuOpen(false);
                                      }}
                                      className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                    >
                                      Add photos &amp; files
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (hasComposerAttachments) {
                                          setComposerError(
                                            "Image generation does not support attachments yet."
                                          );
                                        } else {
                                          setComposerError(null);
                                        }
                                        setCreateImageArmed(true);
                                        setForceWebSearch(false);
                                        setComposerMenuOpen(false);
                                      }}
                                      className="flex w-full items-center justify-between px-2.5 py-2 text-left transition hover:text-white"
                                    >
                                      <span>Create image</span>
                                      {createImageArmed && (
                                        <span className="text-[#8ab4ff]">Armed</span>
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setComposerMenuOpen(false)}
                                      className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                    >
                                      Deep research
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setForceWebSearch((prev) => {
                                          const next = !prev;
                                          if (next) {
                                            setCreateImageArmed(false);
                                          }
                                          return next;
                                        });
                                        setComposerMenuOpen(false);
                                      }}
                                      className="flex w-full items-center justify-between px-2.5 py-2 text-left transition hover:text-white"
                                    >
                                      <span>Web search</span>
                                      {forceWebSearch && (
                                        <span className="text-[#8ab4ff]">On</span>
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setComposerMenuOpen(false)}
                                      className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                    >
                                      Agent mode
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-1 items-center self-stretch">
                          <textarea
                            ref={textareaRef}
                            className="block w-full resize-none border-none bg-transparent py-1.5 text-[15px] leading-[1.5] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-0"
                            style={{
                              maxHeight: MAX_INPUT_HEIGHT,
                              minHeight: resolvedMinInputHeight,
                            }}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={composerPlaceholder}
                            rows={1}
                          />
                          <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="sr-only"
                            onChange={handlePhotoInputChange}
                          />
                          <input
                            ref={filePickerInputRef}
                            type="file"
                            accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.tsv,.json,.md,.rtf,.html,.zip,.log"
                            multiple
                            className="sr-only"
                            onChange={handleFilePickerChange}
                          />
                        </div>

                        <div className="flex items-center gap-2 self-end pl-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!micDisabled) {
                                void startRecording();
                              }
                            }}
                            disabled={micDisabled}
                            aria-label="Start dictation"
                            className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/80 transition ${
                              micDisabled
                                ? "cursor-not-allowed opacity-40"
                                : "hover:bg-white/10"
                            }`}
                          >
                            <MicrophoneIcon className="h-4 w-4" />
                          </button>
                          {renderPrimaryButton()}
                        </div>
                      </>
                    )}
                  </div>
                  {isTranscribing && !isRecording && (
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" aria-hidden />
                      <span>Transcribing…</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {composerError && (
              <div className="text-xs text-red-400">{composerError}</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderChatInterface = (options: ChatInterfaceOptions = {}) => {
    const {
      composerVariant = "default",
      messageContainerClass =
        "flex h-full flex-col overflow-y-auto overflow-x-hidden px-4 py-6 pb-32",
      showInlineTitle = true,
      wrapperClass = "",
    } = options;
    const inlineTitle = selectedConversationMeta?.title?.trim()
      ? selectedConversationMeta.title.trim()
      : pendingNewChat
        ? "New chat"
        : null;

    return (
      <>
        <div className={`relative flex-1 min-h-0 ${wrapperClass}`}>
          <div ref={chatContainerRef} className={messageContainerClass}>
            <div
              className="mx-auto flex w-full flex-col space-y-4 pb-6"
              style={{ maxWidth: MAX_MESSAGE_WIDTH }}
            >
              {isLoadingMessages && (
                <div className="mb-2 text-center text-xs text-zinc-500">
                  Loading messages...
                </div>
              )}

              {showInlineTitle && !isCodexMode && inlineTitle && (
                <div className="text-center text-sm font-semibold text-white/80">
                  {inlineTitle}
                </div>
              )}

              {!isLoadingMessages && messages.length === 0 && (
                <div className="mt-10 text-center text-sm text-zinc-400">
                  Start chatting — {describeModelFamily("gpt-5.1")} chat is
                  streaming live.
                </div>
              )}

              {messages.map((m, i) => {
                const messageId = m.id ?? `msg-${i}`;
                const isAssistant = m.role === "assistant";
                const rawCitations = ensureArray<Source>(m.metadata?.citations);
                const displayableSources = rawCitations.filter((source) =>
                  typeof source?.url === "string" && source.url.trim().length > 0
                );
                const usedWebSearchFlag = Boolean(
                  m.usedWebSearch || m.metadata?.usedWebSearch
                );
                const showSourcesButton =
                  isAssistant &&
                  (usedWebSearchFlag || displayableSources.length > 0);
                const generatedImages = ensureArray<GeneratedImageResult>(
                  m.metadata?.generatedImages
                );
                const isImageMessage =
                  m.metadata?.generationType === "image" &&
                  generatedImages.length > 0;
                const imageModelLabel =
                  isImageMessage && typeof m.usedModel === "string"
                    ? IMAGE_MODEL_LABELS[m.usedModel as ImageModelKey] ||
                      m.usedModel
                    : null;
                const sourceChips = ensureArray<SourceChip>(
                  m.metadata?.sources
                ).filter(
                  (chip) =>
                    typeof chip?.url === "string" &&
                    chip.url.trim().length > 0 &&
                    typeof chip?.domain === "string" &&
                    chip.domain.trim().length > 0
                );
                const showSourceChips = sourceChips.length > 0;
                const isStreamingAssistantMessage =
                  isAssistant && activeAssistantMessageId === messageId;
                const derivedThoughtSeconds =
                  typeof m.metadata?.thinking?.durationSeconds === "number"
                    ? m.metadata?.thinking?.durationSeconds
                    : typeof m.metadata?.thinking?.durationMs === "number"
                      ? m.metadata?.thinking?.durationMs / 1000
                      : m.thoughtDurationSeconds;
                const thoughtLabel =
                  m.thoughtDurationLabel &&
                  m.thoughtDurationLabel.trim().length > 0
                    ? m.thoughtDurationLabel
                    : typeof derivedThoughtSeconds === "number"
                      ? formatThoughtDurationLabel(derivedThoughtSeconds)
                      : null;
                const finalSearchLine = formatSearchedDomainsLine(
                  m.metadata?.searchedDomains
                );
                const showSearchChip =
                  isAssistant &&
                  !isStreamingAssistantMessage &&
                  Boolean(finalSearchLine);
                const assistantWrapperClass =
                  "flex w-full max-w-[95%] flex-col md:max-w-[85%]";
                const userWrapperClass =
                  "inline-flex max-w-[90%] flex-col md:max-w-[70%]";
                const assistantAttachments = ensureArray<ImageAttachment>(
                  m.metadata?.attachments
                );
                const assistantFiles = ensureArray<FileAttachment>(
                  m.metadata?.files
                );

                const assistantContentWrapperClass = isCodexMode
                  ? "space-y-4 text-[15px] leading-relaxed text-white/90"
                  : "rounded-2xl bg-[#1f1f28] px-4 py-3 shadow-lg";
                const metadataRowClass = isCodexMode
                  ? "mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/60"
                  : "mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400";
                const metadataButtonClass = isCodexMode
                  ? "rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 transition hover:border-white/40"
                  : "rounded-full border border-[#3a3a3f] px-3 py-1 text-xs text-zinc-300 hover:border-[#5c5cf5]";
                const metadataSeparatorClass = isCodexMode
                  ? "h-4 w-px bg-white/10"
                  : "h-4 w-px bg-[#38383d]";
                const metadataMenuClass = isCodexMode
                  ? "absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-white/10 bg-[#050509] p-2 text-left text-xs shadow-2xl"
                  : "absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-[#2d2d33] bg-[#101014] p-2 text-left text-xs shadow-2xl";
                const metadataMenuOptionClass = isCodexMode
                  ? "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-white/80 hover:bg-white/5"
                  : "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]";
                const sourcesPanelClass = isCodexMode
                  ? "mt-3 rounded-2xl border border-white/10 bg-[#050509] p-3 text-[13px] text-white/80"
                  : "mt-3 rounded-2xl border border-[#2f2f36] bg-[#141417] p-3 text-[13px] text-zinc-200";
                const sourceChipClass = isCodexMode
                  ? "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white/80"
                  : "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80";
                const userBubbleClass = isCodexMode
                  ? "rounded-2xl bg-[#2b6eea] px-4 py-2.5 text-left text-[15px] leading-relaxed text-white shadow-lg"
                  : "rounded-2xl bg-[#2b6eea] px-4 py-3 text-left shadow-lg";
                const userCopyButtonClass = isCodexMode
                  ? "mt-2 inline-flex w-fit items-center rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 transition hover:border-white/40"
                  : "mt-2 text-xs text-white/70 hover:text-white";

                return (
                  <div
                    key={messageId}
                    className={`flex ${
                      isAssistant ? "justify-start" : "justify-end"
                    }`}
                  >
                    {isAssistant ? (
                      <div
                        className={`${assistantWrapperClass} px-1 py-1 text-left text-[15px] leading-relaxed ${
                          isCodexMode ? "text-white" : "text-zinc-100"
                        } md:px-2`}
                      >
                        {(() => {
                          const statusChips: ReactNode[] = [];
                          if (thoughtLabel) {
                            statusChips.push(
                              <div
                                key={`${messageId}-thought-chip`}
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#15151a]/80 px-3 py-1 text-xs text-zinc-300"
                              >
                                <span
                                  className="h-2 w-2 rounded-full bg-zinc-500"
                                  aria-hidden
                                />
                                <span>{thoughtLabel}</span>
                              </div>
                            );
                          }
                          if (
                            isStreamingAssistantMessage &&
                            searchIndicator?.variant === "running" &&
                            liveSearchDomains.length > 0
                          ) {
                            liveSearchDomains.forEach((domain, index) => {
                              statusChips.push(
                                <div
                                  key={`${messageId}-live-search-${domain}-${index}`}
                                  className="flex items-center rounded-full border border-[#2f3750] bg-[#141826]/80 px-3 py-1 text-xs text-[#9bb8ff]"
                                >
                                  <span className="h-2 w-2 rounded-full bg-[#6f8dff]" aria-hidden />
                                  <span>{domain}</span>
                                </div>
                              );
                            });
                          }
                          return statusChips.length > 0 ? (
                            <div className="mb-2 flex flex-wrap gap-2">
                              {statusChips}
                            </div>
                          ) : null;
                        })()}

                        <div className={assistantContentWrapperClass}>
                          <ReactMarkdown
                            components={markdownComponents}
                            rehypePlugins={[rehypeRaw]}
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                          >
                            {m.content}
                          </ReactMarkdown>

                          {isImageMessage && (
                            <div className="space-y-3">
                              <div className="flex flex-wrap gap-3">
                                {generatedImages.map((image) => (
                                  <div
                                    key={image.id}
                                    className="overflow-hidden rounded-2xl border border-white/10 bg-black/20"
                                  >
                                    <Image
                                      src={image.dataUrl}
                                      alt={image.prompt || "Generated image"}
                                      width={512}
                                      height={512}
                                      className="h-48 w-48 object-cover"
                                      unoptimized
                                    />
                                  </div>
                                ))}
                              </div>
                              {imageModelLabel && (
                                <div className="text-xs text-white/60">
                                  Generated with {imageModelLabel}
                                </div>
                              )}
                            </div>
                          )}

                          {assistantAttachments.length > 0 && (
                            <div className="grid grid-cols-2 gap-3">
                              {assistantAttachments.map((attachment) => (
                                  <div
                                    key={`${attachment.id}-attached`}
                                    className="overflow-hidden rounded-xl border border-white/10"
                                  >
                                    <Image
                                      src={attachment.dataUrl}
                                      alt={attachment.name || "Attachment"}
                                      width={256}
                                      height={256}
                                      className="h-32 w-full object-cover"
                                      unoptimized
                                    />
                                  </div>
                                ))}
                              </div>
                            )}

                          {assistantFiles.length > 0 && (
                            <div className="space-y-2">
                              {assistantFiles.map((file) => (
                                <div
                                  key={`${file.id}-file-row`}
                                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                                >
                                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/30">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      viewBox="0 0 24 24"
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={1.6}
                                    >
                                      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                                      <path d="M14 3v6h6" />
                                    </svg>
                                  </div>
                                  <div className="flex-1 text-sm">
                                    {file.name || "File"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {showSourceChips && (
                            <div className="flex flex-wrap gap-2">
                              {sourceChips.map((chip) => (
                                <a
                                  key={`${messageId}-source-${chip.id}-${chip.domain}`}
                                  href={chip.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={sourceChipClass}
                                >
                                  <span className="h-2 w-2 rounded-full bg-[#6f8dff]" aria-hidden />
                                  <span>{chip.domain}</span>
                                </a>
                              ))}
                            </div>
                          )}

                          {showSearchChip && finalSearchLine && (
                            <div className="text-xs text-white/60">
                              {finalSearchLine}
                            </div>
                          )}
                        </div>

                        {!isStreamingAssistantMessage && (
                          <div className={metadataRowClass}>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleCopyMessage(m, messageId);
                              }}
                              className={metadataButtonClass}
                            >
                              {copiedMessageId === messageId ? "Copied" : "Copy"}
                            </button>

                            {showSourcesButton && (
                              <>
                                <span className={metadataSeparatorClass} aria-hidden />
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setExpandedSourcesId((prev) =>
                                      prev === messageId ? null : messageId
                                    );
                                  }}
                                  className={metadataButtonClass}
                                  aria-expanded={expandedSourcesId === messageId}
                                >
                                  {expandedSourcesId === messageId
                                    ? "Hide sources"
                                    : "Sources"}
                                </button>
                              </>
                            )}

                            {m.usedModel && (
                              <>
                                <span className={metadataSeparatorClass} aria-hidden />
                                <div className="relative">
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setOpenModelMenuId((prev) =>
                                        prev === messageId ? null : messageId
                                      );
                                    }}
                                    className={`${metadataButtonClass} text-[11px]`}
                                    aria-expanded={openModelMenuId === messageId}
                                  >
                                    {imageModelLabel
                                      ? imageModelLabel
                                      : m.usedModelFamily
                                        ? describeModelFamily(m.usedModelFamily)
                                        : m.usedModel}
                                  </button>

                                  {openModelMenuId === messageId && (
                                    <div className={metadataMenuClass}>
                                      {(isImageMessage
                                        ? IMAGE_MODEL_OPTIONS
                                        : MODEL_RETRY_OPTIONS
                                      ).map((option) => {
                                        if (isImageMessage) {
                                          const imageOption =
                                            option as (typeof IMAGE_MODEL_OPTIONS)[number];
                                          const isCurrentImage =
                                            m.usedModel === imageOption.value;
                                          return (
                                            <button
                                              key={imageOption.value}
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                handleRetryWithImageModel(
                                                  imageOption.value,
                                                  m
                                                );
                                              }}
                                              className={metadataMenuOptionClass}
                                            >
                                              <span>
                                                Retry with {imageOption.label}
                                              </span>
                                              {isCurrentImage && (
                                                <span className="text-[10px] text-white/60">
                                                  current
                                                </span>
                                              )}
                                            </button>
                                          );
                                        }
                                        const typedOption = option as (typeof MODEL_RETRY_OPTIONS)[number];
                                        const legacyMode =
                                          typedOption.value === "gpt-5-nano"
                                            ? "nano"
                                            : typedOption.value === "gpt-5-mini"
                                              ? "mini"
                                              : "full";
                                        const isCurrent =
                                          m.usedModelFamily === typedOption.value ||
                                          (!m.usedModelFamily &&
                                            m.usedModelMode === legacyMode);
                                        return (
                                          <button
                                            key={typedOption.value}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              handleRetryWithModel(
                                                typedOption.value,
                                                m
                                              );
                                            }}
                                            className={metadataMenuOptionClass}
                                          >
                                            <span>
                                              Retry with {typedOption.label}
                                            </span>
                                            {isCurrent && (
                                              <span className="text-[10px] text-white/60">
                                                current
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {showSourcesButton &&
                          expandedSourcesId === messageId && (
                            <div className={sourcesPanelClass}>
                              {displayableSources.length > 0 ? (
                                <div className="space-y-2">
                                  {displayableSources.map((source, idx) => {
                                    const domain =
                                      (source as { domain?: string }).domain ||
                                      extractDomainFromUrl(source.url);
                                    const title =
                                      ((source.title || domain || source.url) ?? "")
                                        .toString()
                                        .trim() || source.url;
                                    return (
                                      <a
                                        key={`${source.url}-${idx}`}
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="block rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-white/40"
                                      >
                                        <div className="text-[13px] font-semibold text-white">
                                          {title}
                                        </div>
                                        {domain && (
                                          <div className="text-[11px] text-white/60">
                                            {domain}
                                          </div>
                                        )}
                                      </a>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-[12px] text-white/60">
                                  {isStreamingAssistantMessage
                                    ? "Gathering live citations…"
                                    : "No citations were shared for this response."}
                                </p>
                              )}
                            </div>
                          )}
                      </div>
                    ) : (
                      <div
                        className={`${userWrapperClass} items-end text-right text-[15px] text-white`}
                      >
                        <div className={userBubbleClass}>
                          <ReactMarkdown
                            components={markdownComponents}
                            rehypePlugins={[rehypeRaw]}
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                          >
                            {m.content}
                          </ReactMarkdown>

                          {m.attachments && m.attachments.length > 0 && (
                            <div className="mt-4 grid grid-cols-2 gap-3">
                              {m.attachments.map((attachment) => (
                                <div
                                  key={`${attachment.id}-user-attachment`}
                                  className="overflow-hidden rounded-xl border border-white/20"
                                >
                                  <Image
                                    src={attachment.dataUrl}
                                    alt={attachment.name || "Attachment"}
                                    width={256}
                                    height={256}
                                    className="h-32 w-full object-cover"
                                    unoptimized
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {m.files && m.files.length > 0 && (
                            <div className="mt-4 space-y-2">
                              {m.files.map((file) => (
                                <div
                                  key={`${file.id}-user-file`}
                                  className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-3 py-2"
                                >
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/20">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      viewBox="0 0 24 24"
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={1.6}
                                    >
                                      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                                      <path d="M14 3v6h6" />
                                    </svg>
                                  </div>
                                  <div className="flex-1 truncate text-sm">
                                    {file.name || "File"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(m, messageId)}
                          className={userCopyButtonClass}
                        >
                          {copiedMessageId === messageId ? "Copied" : "Copy"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {(searchIndicator || fileReadingIndicator || thinkingStatus) && (
                <div className="mx-auto w-full max-w-3xl">
                  <div className="flex flex-wrap gap-2">
                  {fileReadingIndicator && (
                    <StatusBubble
                      label="Reading documents"
                      variant={
                        fileReadingIndicator === "error"
                          ? "error"
                          : "reading"
                      }
                    />
                  )}
                  {searchIndicator && (
                    <StatusBubble
                      label={searchIndicator.message}
                      variant={
                        searchIndicator.variant === "error"
                          ? "error"
                          : "search"
                      }
                      subtext={
                        searchIndicator.variant === "running" &&
                        searchStatusSubtext
                          ? searchStatusSubtext
                          : undefined
                      }
                    />
                  )}
                  {thinkingStatus && (
                    <StatusBubble
                      label={thinkingStatus.label}
                      variant={
                        thinkingStatus.variant === "extended"
                          ? "extended"
                          : "default"
                      }
                    />
                  )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {showScrollButton && messages.length > 0 && (
            <button
              onClick={handleJumpToBottom}
              className="pointer-events-auto absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/15 bg-[#1b1b25]/90 p-3 text-white shadow-xl transition hover:bg-[#242433] sm:bottom-6"
              aria-label="Jump to latest message"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
        </div>

        {renderComposerArea(composerVariant)}
      </>
    );
  };
  const handlePrimaryAction = () => {
    if (primaryActionMode === "stop") {
      handleStopGeneration();
      return;
    }
    if (primaryActionMode === "confirm-recording") {
      void finishRecordingAndTranscribe();
      return;
    }
    if (primaryActionMode === "transcribing") {
      return;
    }
    if (primaryActionMode === "send") {
      if (createImageArmed) {
        void sendImageMessage();
      } else {
        void sendTextMessage();
      }
      return;
    }
    if (primaryActionMode === "idle") {
      return;
    }
  };

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const formatAttachmentSize = (bytes?: number | null) => {
    if (!bytes) return null;
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  const handlePhotoInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const availableSlots = MAX_IMAGE_ATTACHMENTS - imageAttachments.length;
    if (availableSlots <= 0) {
      setComposerError(
        `You can attach up to ${MAX_IMAGE_ATTACHMENTS} images.`
      );
      event.target.value = "";
      return;
    }
    const selectedFiles = Array.from(files).slice(0, availableSlots);
    const prepared: ImageAttachment[] = [];
    for (const file of selectedFiles) {
      if (!file.type.startsWith("image/")) {
        setComposerError("Only image files are supported.");
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        setComposerError("Images must be 8MB or smaller.");
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        prepared.push({
          id: createLocalId(),
          name: file.name || "image",
          mimeType: file.type || "image/*",
          dataUrl,
          size: file.size,
        });
      } catch (error) {
        console.error("Failed to read attachment", error);
        setComposerError("Failed to load one of the images.");
      }
    }
    if (prepared.length) {
      setImageAttachments((prev) => [...prev, ...prepared]);
      setComposerError(null);
    }
    event.target.value = "";
  };

  const handleFilePickerChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    let remainingImageSlots = MAX_IMAGE_ATTACHMENTS - imageAttachments.length;
    let remainingFileSlots = MAX_FILE_ATTACHMENTS - fileAttachments.length;
    const newImages: ImageAttachment[] = [];
    const newFiles: FileAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/") && remainingImageSlots > 0) {
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          setComposerError("Images must be 8MB or smaller.");
          continue;
        }
        try {
          const dataUrl = await readFileAsDataUrl(file);
          newImages.push({
            id: createLocalId(),
            name: file.name || "image",
            mimeType: file.type || "image/*",
            dataUrl,
            size: file.size,
          });
          remainingImageSlots -= 1;
        } catch (error) {
          console.error("Failed to read attachment", error);
          setComposerError("Failed to load one of the files.");
        }
        continue;
      }
      if (remainingFileSlots <= 0) {
        setComposerError(
          `You can attach up to ${MAX_FILE_ATTACHMENTS} files.`
        );
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setComposerError("Files must be 16MB or smaller.");
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        newFiles.push({
          id: createLocalId(),
          name: file.name || "file",
          mimeType: file.type || "application/octet-stream",
          dataUrl,
          size: file.size,
        });
        remainingFileSlots -= 1;
      } catch (error) {
        console.error("Failed to read file attachment", error);
        setComposerError("Failed to load one of the files.");
      }
    }
    if (newImages.length) {
      setImageAttachments((prev) => [...prev, ...newImages]);
    }
    if (newFiles.length) {
      setFileAttachments((prev) => [...prev, ...newFiles]);
    }
    if (newImages.length || newFiles.length) {
      setComposerError(null);
    }
    event.target.value = "";
  };

  const handleTakePhotoClick = () => {
    if (imageAttachmentLimitReached) {
      setComposerError(`You can attach up to ${MAX_IMAGE_ATTACHMENTS} images.`);
      return;
    }
    photoInputRef.current?.click();
  };

  const handleAddFilesClick = () => {
    if (
      fileAttachments.length >= MAX_FILE_ATTACHMENTS &&
      imageAttachmentLimitReached
    ) {
      setComposerError("You've reached the attachment limit.");
      return;
    }
    filePickerInputRef.current?.click();
  };

  const handleRemoveImageAttachment = (id: string) => {
    setImageAttachments((prev) =>
      prev.filter((attachment) => attachment.id !== id)
    );
    setComposerError(null);
  };

  const handleRemoveFileAttachment = (id: string) => {
    setFileAttachments((prev) => prev.filter((file) => file.id !== id));
    setComposerError(null);
  };

  const startWaveformVisualizer = useCallback(
    (stream: MediaStream) => {
      if (typeof window === "undefined") {
        return;
      }
      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
      if (!AudioCtx) {
        return;
      }
      try {
        cleanupWaveformVisualizer();
        const audioContext = new AudioCtx();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        const buffer: Uint8Array<ArrayBuffer> = new Uint8Array(
          new ArrayBuffer(analyser.frequencyBinCount)
        );
        audioContextRef.current = audioContext;
        audioSourceRef.current = source;
        analyserRef.current = analyser;
        waveformDataRef.current = buffer;

        const tick = () => {
          if (!analyserRef.current || !waveformDataRef.current) {
            return;
          }
          analyserRef.current.getByteTimeDomainData(waveformDataRef.current);
          const data = waveformDataRef.current;
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            sum += Math.abs(data[i] - 128);
          }
          const normalized = Math.min(1, sum / data.length / 64);
          setWaveformLevels((prev) => {
            const next = prev.slice(1);
            next.push(normalized);
            return next;
          });
          waveformAnimationRef.current = requestAnimationFrame(tick);
        };
        waveformAnimationRef.current = requestAnimationFrame(tick);
        if (typeof audioContext.resume === "function") {
          void audioContext.resume().catch(() => null);
        }
      } catch (error) {
        console.warn("Unable to initialize waveform visualization", error);
      }
    },
    [cleanupWaveformVisualizer]
  );

  const stopRecording = useCallback(
    (shouldReturnBlob: boolean) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        return Promise.resolve<Blob | null>(null);
      }
      return new Promise<Blob | null>((resolve) => {
        recorder.onstop = () => {
          mediaRecorderRef.current = null;
          const stream = mediaStreamRef.current;
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }
          const chunks = recordingChunksRef.current;
          recordingChunksRef.current = [];
          cleanupWaveformVisualizer();
          if (!shouldReturnBlob || chunks.length === 0) {
            resolve(null);
            return;
          }
          resolve(new Blob(chunks, { type: "audio/webm" }));
        };
        try {
          recorder.stop();
        } catch (error) {
          console.error("Unable to stop recording", error);
          resolve(null);
        }
      });
    },
    [cleanupWaveformVisualizer]
  );

  const cancelRecordingFlow = useCallback(
    (options?: { clearInput?: boolean }) => {
      if (isRecording) {
        void stopRecording(false);
        setIsRecording(false);
      }
      if (isTranscribing) {
        transcriptionAbortRef.current?.abort();
        transcriptionAbortRef.current = null;
        setIsTranscribing(false);
      }
      if (options?.clearInput) {
        setInput("");
      }
      setComposerError(null);
    },
    [isRecording, isTranscribing, stopRecording, setInput]
  );

  useEffect(() => {
    if (isRecording) {
      setComposerMenuOpen(false);
    }
  }, [isRecording]);

  const startRecording = useCallback(async () => {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setComposerError("Voice input isn't supported in this browser.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setComposerError("Microphone access is unavailable.");
      return;
    }
    try {
      setComposerError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      startWaveformVisualizer(stream);
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("startRecording error", error);
      setComposerError("Microphone permission was denied.");
    }
  }, [startWaveformVisualizer]);

  const transcribeAudio = useCallback(
    async (blob: Blob) => {
      const formData = new FormData();
      formData.append("audio", blob, "voice-message.webm");
      const controller = new AbortController();
      transcriptionAbortRef.current = controller;
      try {
        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Transcription failed");
        }
        const payload = (await response.json()) as { transcript?: string };
        const transcript = (payload.transcript || "").trim();
        if (transcript) {
          setInput((prev) => {
            if (!prev) return transcript;
            return `${prev.trimEnd()} ${transcript}`.trim();
          });
          textareaRef.current?.focus();
          setComposerError(null);
        } else {
          setComposerError("No speech detected in the recording.");
        }
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") {
          return;
        }
        console.error("transcribeAudio error", error);
        setComposerError("Unable to transcribe audio.");
      } finally {
        transcriptionAbortRef.current = null;
      }
    },
    []
  );

  const finishRecordingAndTranscribe = useCallback(async () => {
    if (!isRecording) {
      return;
    }
    setIsRecording(false);
    setIsTranscribing(true);
    try {
      const blob = await stopRecording(true);
      if (blob) {
        await transcribeAudio(blob);
      } else {
        setComposerError("Recording was too short.");
      }
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") {
        setComposerError("Unable to capture audio.");
      }
    } finally {
      setIsTranscribing(false);
    }
  }, [isRecording, stopRecording, transcribeAudio]);

  const handleConversationSelect = (id: string) => {
    ensureChatRoute();
    if (isCodexMode && !selectedConversationId) {
      rememberCodexLandingScroll();
    }
    setPendingNewChat(false);
    setPendingNewChatProjectId(null);
    const convo = conversations.find((c) => c.id === id);
    if (id === selectedConversationId) {
      loadMessages(id, { force: true });
    } else {
      setSelectedConversationId(id);
    }
    if (allowProjectSections) {
      setSelectedProjectId(convo?.project_id ?? null);
    } else {
      setSelectedProjectId(null);
    }
    setViewMode("chat");
    setSidebarOpen(false);
  };

  const handleProjectSelect = (id: string) => {
    if (!allowProjectSections) {
      return;
    }
    ensureChatRoute();
    setPendingNewChat(false);
    setPendingNewChatProjectId(null);
    setSelectedProjectId(id);
    setViewMode("project");
    setSidebarOpen(false);
  };

  const refreshConversations = useCallback(async () => {
    const loaded = await loadConversationsFromSupabase();
    applyConversationState(loaded);
  }, [applyConversationState, loadConversationsFromSupabase]);

  const persistMessageMetadata = useCallback(
    async (messageId: string, metadata: MessageMetadata) => {
      if (!messageId) return;
      try {
        await supabase
          .from("messages")
          .update({ metadata })
          .eq("id", messageId);
      } catch (error) {
        console.warn("Failed to persist message metadata", error);
      }
    },
    []
  );

  const persistConversationTitle = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!id || !trimmed) {
      return;
    }
    try {
      await supabase
        .from("conversations")
        .update({ title: trimmed })
        .eq("id", id);
    } catch (error) {
      console.warn("Failed to persist conversation title", error);
    }
  }, []);

  useEffect(() => {
    if (pendingMetadataPersistRef.current.size === 0) return;
    messages.forEach((msg) => {
      const messageId = msg.id;
      if (!messageId) return;
      const pending = pendingMetadataPersistRef.current.get(messageId);
      if (!pending || !msg.persistedId) return;
      pendingMetadataPersistRef.current.delete(messageId);
      persistMessageMetadata(msg.persistedId, pending);
    });
  }, [messages, persistMessageMetadata]);

  // ------------------------------------------------------------
  // CREATE CONVERSATION
  // ------------------------------------------------------------
  type CreateConversationOptions = {
    title?: string | null;
    projectId?: string | null;
    metadata?: Record<string, unknown> | null;
    agentId?: AgentId;
  };

  async function createConversation(options?: CreateConversationOptions) {
    const rawTitle = options?.title ?? "New chat";
    const resolvedTitle = rawTitle && rawTitle.trim()
      ? rawTitle.trim()
      : "New chat";
    const resolvedProjectId =
      typeof options?.projectId === "undefined"
        ? selectedProjectId ?? null
        : options.projectId ?? null;
    const resolvedAgentId: AgentId = options?.agentId ?? defaultAgentId;
    const hasMetadataOverrides =
      options?.metadata && Object.keys(options.metadata).length > 0;
    const metadataOverrides: Record<string, unknown> | undefined =
      hasMetadataOverrides && options?.metadata
        ? { ...options.metadata }
        : undefined;
    const mergedMetadata: Record<string, unknown> = {
      ...(metadataOverrides ?? {}),
      agentId: resolvedAgentId,
    };

    console.log("[SEND_PIPELINE] Preparing to create conversation", {
      title: resolvedTitle,
      projectId: resolvedProjectId,
      metadata: mergedMetadata,
    });
    let record: ConversationMeta;
    try {
      record = await createConversationRecord({
        title: resolvedTitle,
        projectId: resolvedProjectId,
        metadata: mergedMetadata,
      });
      console.log("[SEND_PIPELINE] Conversation record created", {
        id: record.id,
        metadata: record.metadata,
      });
    } catch (error) {
      console.error("[SEND_PIPELINE] createConversationRecord failed", error);
      throw error;
    }
    applyConversationState((prev) => {
      const withoutDuplicate = prev.filter((c) => c.id !== record.id);
      return [record, ...withoutDuplicate];
    });
    return record;
  }

type RetryOptions = {
  assistantMessageId: string;
  assistantPersistedId?: string | null;
  userMessagePersistedId?: string | null;
};

  type SendTextMessageOptions = {
    messageOverride?: string;
    attachmentsOverride?: ImageAttachment[];
    fileAttachmentsOverride?: FileAttachment[];
    modelOverride?: ModelFamily;
    speedOverride?: SpeedMode;
    retry?: RetryOptions;
    agentId?: AgentId;
  };

  type SendImageMessageOptions = {
    messageOverride?: string;
    modelOverride?: ImageModelKey;
    retry?: RetryOptions;
  };

  // ------------------------------------------------------------
  // SEND MESSAGE — STREAMING
  // ------------------------------------------------------------
  async function sendTextMessage(options?: SendTextMessageOptions) {
    console.log("[SEND_PIPELINE] sendTextMessage invoked", {
      selectedConversationId,
      pendingNewChat,
      isCodexMode,
      canSendMessage,
      isSending: isStreaming,
    });
    if (isStreaming) return;
    const sourceText = options?.messageOverride ?? input;
    const activeAttachments =
      options?.attachmentsOverride ?? imageAttachments;
    const activeFiles =
      options?.fileAttachmentsOverride ?? fileAttachments;
    const text = sourceText.trim();
    const hasAttachments =
      activeAttachments.length > 0 || activeFiles.length > 0;
    if (!text && !hasAttachments) return;

    let conversationId = selectedConversationId;
    let activeAgentId: AgentId =
      options?.agentId ?? getConversationAgentId(conversationId);
    let assistantMessageId: string | null = options?.retry?.assistantMessageId ?? null;
    let userMessageId: string | null = null;
    const isRetry = Boolean(options?.retry);
    const chosenFamily = options?.modelOverride ?? modelFamily;
    const chosenSpeed = options?.speedOverride ?? speedMode;
    const requestedLegacyMode = legacyModeFromFamily(chosenFamily);
    const previewFamilyForReasoning =
      chosenFamily === "auto" ? "gpt-5-mini" : chosenFamily;
    const previewPrompt =
      text || (hasAttachments ? "[attachments]" : text);
    const previewModelConfig = getModelAndReasoningConfig(
      previewFamilyForReasoning,
      chosenSpeed,
      previewPrompt
    );
    const requestedReasoningEffort = previewModelConfig.reasoning?.effort;
    console.log(
      `[reasoningDebug] model=${previewModelConfig.model} effort=${previewModelConfig.reasoning?.effort ?? "none"} speed=${chosenSpeed}`
    );
    if (!options?.messageOverride) {
      setInput("");
      if (!options?.attachmentsOverride) {
        setImageAttachments([]);
      }
      if (!options?.fileAttachmentsOverride) {
        setFileAttachments([]);
      }
    }
    setComposerError(null);
    setIsStreaming(true);
    setStreamingConversationId(selectedConversationId);
    setComposerMenuOpen(false);
    setRowMenu(null);
    setMoveMenuConversationId(null);
    setAutoScrollEnabled(true);
    setShowScrollButton(false);
    setSearchIndicator(null);
    setFileReadingIndicator(null);
    setLiveSearchDomains([]);
    responseTimingRef.current = {
      start: typeof performance !== "undefined" ? performance.now() : Date.now(),
      firstToken: null,
      assistantMessageId: null,
    };
    resetThinkingIndicator();
    showThinkingIndicator(requestedReasoningEffort ?? null);

    try {
      if (!conversationId && isRetry) {
        throw new Error("Cannot retry without a conversation");
      }
      if (!conversationId) {
        const projectTarget = allowProjectSections
          ? pendingNewChat
            ? pendingNewChatProjectId ?? null
            : selectedProjectId ?? null
          : null;
        const conv = await createConversation({
          projectId: projectTarget,
          agentId: activeAgentId,
        });
        conversationId = conv.id;
        activeAgentId =
          agentIdFromMetadata(conv.metadata) ??
          activeAgentId ??
          defaultAgentId;
        if (isCodexMode) {
          rememberCodexLandingScroll();
        }
        setSelectedConversationId(conv.id);
        if (allowProjectSections) {
          setSelectedProjectId(conv.project_id ?? projectTarget ?? null);
        } else {
          setSelectedProjectId(null);
        }
        setViewMode("chat");
        skipAutoLoadRef.current = conv.id;
        setPendingNewChat(false);
        setPendingNewChatProjectId(null);
      }

      setStreamingConversationId(conversationId);

      const resolvedAgentId: AgentId = activeAgentId ?? DEFAULT_AGENT_ID;

      if (!assistantMessageId) {
        assistantMessageId = createLocalId();
      }
      responseTimingRef.current.assistantMessageId = assistantMessageId;
      setActiveAssistantMessageId(assistantMessageId);

    const attachmentCopies = activeAttachments.map((attachment) => ({
      ...attachment,
    }));
    const fileAttachmentCopies = activeFiles.map((file) => ({
      ...file,
    }));

    if (!isRetry) {
      const newUserMessageId = createLocalId();
      userMessageId = newUserMessageId;
      const activeAssistantId = assistantMessageId!;
      const userMetadata =
        attachmentCopies.length || fileAttachmentCopies.length
          ? {
              ...(attachmentCopies.length
                ? { attachments: attachmentCopies }
                : {}),
              ...(fileAttachmentCopies.length
                ? { files: fileAttachmentCopies }
                : {}),
            }
          : undefined;
      setMessages((prev) => [
        ...prev,
        {
          id: newUserMessageId,
          role: "user",
          content: text,
          attachments: attachmentCopies,
          files: fileAttachmentCopies,
          metadata: userMetadata,
        },
        {
          id: activeAssistantId,
          role: "assistant",
          content: "",
          metadata: {
            generationType: "text",
            requestedModelMode: requestedLegacyMode,
            requestedModelFamily: chosenFamily,
            speedMode: chosenSpeed,
            reasoningEffort: requestedReasoningEffort,
          },
          requestedModelFamily: chosenFamily,
          speedMode: chosenSpeed,
          reasoningEffort: requestedReasoningEffort,
        },
      ]);
    } else {
        if (assistantMessageId) {
          pendingMetadataPersistRef.current.delete(assistantMessageId);
        }
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMessageId) return msg;
          return {
            ...msg,
            content: "",
            usedModel: undefined,
            usedModelMode: undefined,
            usedModelFamily: undefined,
            usedWebSearch: undefined,
            searchRecords: [],
            thoughtDurationSeconds: undefined,
            thoughtDurationLabel: undefined,
            metadata: {
              generationType: "text",
              requestedModelMode: requestedLegacyMode,
              requestedModelFamily: chosenFamily,
              speedMode: chosenSpeed,
              reasoningEffort: requestedReasoningEffort,
            },
            requestedModelFamily: chosenFamily,
            speedMode: chosenSpeed,
            reasoningEffort: requestedReasoningEffort,
          };
        })
      );
        setExpandedSourcesId((prev) =>
          prev === assistantMessageId ? null : prev
        );
      }

      const shouldForceWebSearch = forceWebSearch;
      setForceWebSearch(false);

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const requestBody: Record<string, unknown> = {
        message: text,
        conversationId,
        modelFamily: chosenFamily,
        speedMode: chosenSpeed,
        forceWebSearch: shouldForceWebSearch,
        agentId: resolvedAgentId,
      };
      if (attachmentCopies.length > 0) {
        requestBody.images = attachmentCopies.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
          size: attachment.size,
        }));
      }
      if (fileAttachmentCopies.length > 0) {
        requestBody.files = fileAttachmentCopies.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
          size: attachment.size,
        }));
      }

      if (options?.retry?.assistantPersistedId) {
        requestBody.retryAssistantMessageId =
          options.retry.assistantPersistedId;
      }
      if (options?.retry?.userMessagePersistedId) {
        requestBody.retryUserMessageId =
          options.retry.userMessagePersistedId;
      }

      console.log("[SEND_PIPELINE] Calling /api/chat", {
        conversationId,
        hasImages: attachmentCopies.length > 0,
        hasFiles: fileAttachmentCopies.length > 0,
        textLength: text.length,
      });
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        console.error("[SEND_PIPELINE] /api/chat returned invalid response", {
          status: res.status,
          ok: res.ok,
        });
        throw new Error("Stream failed");
      }

      console.log("[SEND_PIPELINE] /api/chat stream established", {
        status: res.status,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      const markResponseFinished = () => {
        resetThinkingIndicator();
        setSearchIndicator((prev) =>
          prev?.variant === "running" ? null : prev
        );
        setLiveSearchDomains([]);
        responseTimingRef.current = {
          start: null,
          firstToken: null,
          assistantMessageId: null,
        };
        setStreamingConversationId((current) =>
          conversationId && current === conversationId ? null : current
        );
        setIsStreaming(false);
      };

      while (!finished) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line) {
              try {
                const payload = JSON.parse(line);
                if (payload.meta) {
                  const meta = payload.meta as MessageMetadata & {
                    assistantMessageRowId?: string;
                    userMessageRowId?: string;
                  };
                  const assistantRowId =
                    (meta as { assistantMessageRowId?: string })
                      .assistantMessageRowId;
                  const userRowId = (meta as { userMessageRowId?: string })
                    .userMessageRowId;
                  if (
                    typeof meta.reasoningEffort !== "undefined" &&
                    !responseTimingRef.current.firstToken
                  ) {
                    showThinkingIndicator(meta.reasoningEffort);
                  }
                  if (userRowId && userMessageId) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === userMessageId
                          ? { ...msg, persistedId: userRowId }
                          : msg
                      )
                    );
                  }
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== assistantMessageId) return msg;
                      const resolvedRequestedFamily =
                        meta.requestedModelFamily ??
                        msg.metadata?.requestedModelFamily ??
                        chosenFamily;
                      const resolvedSpeedMode =
                        meta.speedMode ??
                        msg.metadata?.speedMode ??
                        chosenSpeed;
                      const resolvedReasoning =
                        meta.reasoningEffort ??
                        msg.metadata?.reasoningEffort ??
                        requestedReasoningEffort;
                      const incomingThinkingMs =
                        typeof meta.thinking?.durationMs === "number"
                          ? meta.thinking.durationMs
                          : typeof meta.thinkingDurationMs === "number"
                            ? meta.thinkingDurationMs
                            : msg.metadata?.thinking?.durationMs ??
                              msg.metadata?.thinkingDurationMs;
                      const incomingThinkingSeconds =
                        typeof meta.thinking?.durationSeconds === "number"
                          ? meta.thinking.durationSeconds
                          : typeof incomingThinkingMs === "number"
                            ? incomingThinkingMs / 1000
                            : msg.metadata?.thinking?.durationSeconds ??
                              msg.metadata?.thoughtDurationSeconds;
                      const mergedMetadata: MessageMetadata = {
                        ...(msg.metadata || {}),
                        usedModel: meta.usedModel ?? msg.metadata?.usedModel,
                        usedModelMode:
                          meta.usedModelMode ??
                          msg.metadata?.usedModelMode ??
                          (meta.usedModelFamily
                            ? legacyModeFromFamily(meta.usedModelFamily)
                            : undefined),
                        usedModelFamily:
                          meta.usedModelFamily ??
                          msg.metadata?.usedModelFamily,
                        requestedModelMode:
                          meta.requestedModelMode ??
                          msg.metadata?.requestedModelMode ??
                          legacyModeFromFamily(resolvedRequestedFamily),
                        requestedModelFamily: resolvedRequestedFamily,
                        speedMode: resolvedSpeedMode,
                        reasoningEffort: resolvedReasoning,
                        usedWebSearch:
                          typeof meta.usedWebSearch === "boolean"
                            ? meta.usedWebSearch
                            : msg.metadata?.usedWebSearch,
                        searchRecords: Array.isArray(meta.searchRecords)
                          ? meta.searchRecords
                          : Array.isArray(msg.metadata?.searchRecords)
                            ? msg.metadata?.searchRecords
                            : [],
                        sources: Array.isArray(meta.sources)
                          ? meta.sources
                          : Array.isArray(msg.metadata?.sources)
                            ? msg.metadata?.sources
                            : [],
                        citations: Array.isArray(meta.citations)
                          ? meta.citations
                          : Array.isArray(msg.metadata?.citations)
                            ? msg.metadata?.citations
                            : [],
                        vectorStoreIds:
                          meta.vectorStoreIds ??
                          msg.metadata?.vectorStoreIds,
                        searchedSiteLabel:
                          typeof meta.searchedSiteLabel === "string" &&
                          meta.searchedSiteLabel.trim().length > 0
                            ? meta.searchedSiteLabel.trim()
                            : msg.metadata?.searchedSiteLabel,
                        thinkingDurationMs: incomingThinkingMs,
                        thoughtDurationSeconds:
                          typeof incomingThinkingSeconds === "number"
                            ? incomingThinkingSeconds
                            : msg.thoughtDurationSeconds,
                        thoughtDurationLabel:
                          msg.thoughtDurationLabel &&
                          msg.thoughtDurationLabel.trim().length > 0
                            ? msg.thoughtDurationLabel
                            : undefined,
                      };
                      const sanitizedMetaDomains = Array.isArray(
                        meta.searchedDomains
                      )
                        ? meta.searchedDomains
                            .map((label) =>
                              typeof label === "string" ? label.trim() : ""
                            )
                            .filter((label) => label.length > 0)
                        : [];
                      const domainAdditions = [
                        ...sanitizedMetaDomains,
                        ...collectDomainsFromSearchRecords(
                          mergedMetadata.searchRecords
                        ),
                        ...collectDomainsFromCitations(
                          mergedMetadata.citations
                        ),
                      ];
                      if (domainAdditions.length > 0) {
                        mergedMetadata.searchedDomains = mergeSearchedDomains(
                          mergedMetadata.searchedDomains,
                          domainAdditions
                        );
                        applyLiveSearchDomains(domainAdditions);
                      }
                      const discoveredSiteLabel =
                        getLatestSearchedDomainLabel(mergedMetadata);
                      if (discoveredSiteLabel) {
                        mergedMetadata.searchedSiteLabel =
                          discoveredSiteLabel;
                        applyLiveSearchDomains([discoveredSiteLabel]);
                      }
                      if (!mergedMetadata.generationType) {
                        mergedMetadata.generationType = "text";
                      }
                      const mergedThinking: MessageMetadata["thinking"] = {
                        ...(msg.metadata?.thinking || {}),
                      };
                      if (meta.thinking) {
                        if (typeof meta.thinking.durationMs === "number") {
                          mergedThinking.durationMs = meta.thinking.durationMs;
                        }
                        if (typeof meta.thinking.durationSeconds === "number") {
                          mergedThinking.durationSeconds =
                            meta.thinking.durationSeconds;
                        }
                        if (meta.thinking.effort === null) {
                          mergedThinking.effort = null;
                        } else if (meta.thinking.effort) {
                          mergedThinking.effort = meta.thinking.effort;
                        }
                      }
                      if (typeof incomingThinkingMs === "number") {
                        mergedThinking.durationMs = incomingThinkingMs;
                      }
                      if (typeof incomingThinkingSeconds === "number") {
                        mergedThinking.durationSeconds =
                          incomingThinkingSeconds;
                      }
                      if (
                        typeof mergedThinking.effort === "undefined" &&
                        (meta.reasoningEffort ||
                          msg.metadata?.reasoningEffort ||
                          resolvedReasoning)
                      ) {
                        mergedThinking.effort =
                          meta.reasoningEffort ??
                          msg.metadata?.reasoningEffort ??
                          resolvedReasoning;
                      }
                      if (
                        typeof mergedThinking.durationMs === "number" ||
                        typeof mergedThinking.durationSeconds === "number" ||
                        typeof mergedThinking.effort !== "undefined"
                      ) {
                        mergedMetadata.thinking = mergedThinking;
                      }
                      return {
                        ...msg,
                        usedModel: meta.usedModel ?? msg.usedModel,
                        usedModelMode:
                          meta.usedModelMode ??
                          msg.usedModelMode ??
                          (meta.usedModelFamily
                            ? legacyModeFromFamily(meta.usedModelFamily)
                            : undefined),
                        usedModelFamily:
                          meta.usedModelFamily ?? msg.usedModelFamily,
                        requestedModelFamily: resolvedRequestedFamily,
                        speedMode: resolvedSpeedMode,
                        reasoningEffort: resolvedReasoning,
                        usedWebSearch:
                          typeof meta.usedWebSearch === "boolean"
                            ? meta.usedWebSearch
                            : msg.usedWebSearch,
                        searchRecords:
                          meta.searchRecords ?? msg.searchRecords ?? [],
                        metadata: mergedMetadata,
                        persistedId: assistantRowId ?? msg.persistedId,
                      };
                    })
                  );
                  if (assistantMessageId && assistantRowId) {
                    const pending = pendingMetadataPersistRef.current.get(
                      assistantMessageId
                    );
                    if (pending) {
                      pendingMetadataPersistRef.current.delete(
                        assistantMessageId
                      );
                      persistMessageMetadata(assistantRowId, pending);
                    }
                  }
                } else if (payload.metadata) {
                  const domainUpdates = extractDomainsFromMetadataChunk(
                    payload.metadata
                  );
                  applyLiveSearchDomains(domainUpdates);
                  if (domainUpdates.length > 0) {
                    setLiveSearchDomains((prev) => {
                      const merged = mergeSearchedDomains(
                        prev,
                        domainUpdates
                      );
                      return merged.length === prev.length ? prev : merged;
                    });
                  }
                } else if (payload.type === "web_search_domain") {
                  const domainPayload = payload as {
                    type: "web_search_domain";
                    domain?: string;
                  };
                  const domainLabel = domainPayload.domain?.trim();
                  if (domainLabel) {
                    setLiveSearchDomains((prev) => {
                      const merged = mergeSearchedDomains(prev, [domainLabel]);
                      return merged.length === prev.length ? prev : merged;
                    });
                    applyLiveSearchDomains([domainLabel]);
                  }
                } else if (typeof payload.token === "string") {
                  const token = payload.token as string;
                  if (!responseTimingRef.current.firstToken) {
                    const now =
                      typeof performance !== "undefined"
                        ? performance.now()
                        : Date.now();
                    responseTimingRef.current.firstToken = now;
                    resetThinkingIndicator();
                    setSearchIndicator((prev) =>
                      prev?.variant === "running" ? null : prev
                    );
                    setFileReadingIndicator((prev) =>
                      prev === "running" ? null : prev
                    );
                    const startTime = responseTimingRef.current.start;
                    const targetMessageId =
                      responseTimingRef.current.assistantMessageId;
                    if (startTime && targetMessageId) {
                      const elapsedMs = Math.max(0, now - startTime);
                      const seconds = elapsedMs / 1000;
                      const formatted = formatThoughtDurationLabel(seconds);
                      let persistedIdForTiming: string | undefined;
                      let updatedMetadata: MessageMetadata | null = null;
                      setMessages((prev) =>
                        prev.map((msg) => {
                          if (msg.id !== targetMessageId) return msg;
                          persistedIdForTiming = msg.persistedId;
                          const nextThinking: MessageMetadata["thinking"] = {
                            ...(msg.metadata?.thinking || {}),
                          };
                          nextThinking.durationMs = elapsedMs;
                          nextThinking.durationSeconds = seconds;
                          if (
                            typeof nextThinking.effort === "undefined" &&
                            (msg.metadata?.reasoningEffort ||
                              msg.reasoningEffort ||
                              requestedReasoningEffort)
                          ) {
                            nextThinking.effort =
                              msg.metadata?.reasoningEffort ??
                              msg.reasoningEffort ??
                              requestedReasoningEffort ??
                              null;
                          }
                          const nextMetadata: MessageMetadata = {
                            ...(msg.metadata || {}),
                            thinkingDurationMs: elapsedMs,
                            thoughtDurationSeconds: seconds,
                            thoughtDurationLabel: formatted,
                            thinking: nextThinking,
                          };
                          updatedMetadata = nextMetadata;
                          return {
                            ...msg,
                            metadata: nextMetadata,
                            thoughtDurationSeconds: seconds,
                            thoughtDurationLabel: formatted,
                          };
                        })
                      );
                      if (updatedMetadata) {
                        if (persistedIdForTiming) {
                          persistMessageMetadata(
                            persistedIdForTiming,
                            updatedMetadata
                          );
                        } else {
                          pendingMetadataPersistRef.current.set(
                            targetMessageId,
                            updatedMetadata
                          );
                        }
                      }
                    }
                  }
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: msg.content + token }
                        : msg
                    )
                  );
                } else if (payload.status) {
                  const status = payload.status as ServerStatusEvent;
                  if (status.type === "search-start") {
                    setSearchIndicator({
                      message: "Searching the web…",
                      variant: "running",
                      domains: [],
                    });
                  } else if (status.type === "search-complete") {
                    // keep indicator visible until first token arrives
                  } else if (status.type === "search-error") {
                    setSearchIndicator({
                      message:
                        status.message || "Web search failed. Using prior data.",
                      variant: "error",
                      domains: [],
                    });
                  } else if (status.type === "file-reading-start") {
                    setFileReadingIndicator("running");
                  } else if (status.type === "file-reading-complete") {
                    setFileReadingIndicator(null);
                  } else if (status.type === "file-reading-error") {
                    setFileReadingIndicator("error");
                  }
                } else if (payload.type === "sources") {
                  const sourcesEvent = payload as {
                    type: "sources";
                    conversationId?: string;
                    messageId?: string;
                    sources?: Source[];
                  };
                  if (
                    sourcesEvent.conversationId &&
                    sourcesEvent.conversationId !== selectedConversationId
                  ) {
                    continue;
                  }
                  if (!Array.isArray(sourcesEvent.sources)) {
                    continue;
                  }
                  let metadataForPersist: MessageMetadata | null = null;
                  let localMessageId: string | null = null;
                  let resolvedPersistedId: string | null = null;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      const matchesPersisted =
                        msg.persistedId === sourcesEvent.messageId;
                      const matchesActive =
                        assistantMessageId &&
                        msg.id === assistantMessageId &&
                        !msg.persistedId;
                      if (!matchesPersisted && !matchesActive) {
                        return msg;
                      }
                      const nextMetadata: MessageMetadata = {
                        ...(msg.metadata || {}),
                        citations: sourcesEvent.sources ?? [],
                      };
                      const citationDomains = collectDomainsFromCitations(
                        sourcesEvent.sources
                      );
                      if (citationDomains.length > 0) {
                        nextMetadata.searchedDomains = mergeSearchedDomains(
                          nextMetadata.searchedDomains,
                          citationDomains
                        );
                        applyLiveSearchDomains(citationDomains);
                        const latestDomain = getLatestSearchedDomainLabel(
                          nextMetadata
                        );
                        if (latestDomain) {
                          nextMetadata.searchedSiteLabel = latestDomain;
                        }
                      }
                      metadataForPersist = nextMetadata;
                      localMessageId = msg.id ?? null;
                      resolvedPersistedId = msg.persistedId ?? null;
                      return {
                        ...msg,
                        metadata: nextMetadata,
                      };
                    })
                  );
                  if (metadataForPersist) {
                    if (resolvedPersistedId) {
                      persistMessageMetadata(
                        resolvedPersistedId,
                        metadataForPersist
                      );
                    } else if (localMessageId) {
                      pendingMetadataPersistRef.current.set(
                        localMessageId,
                        metadataForPersist
                      );
                    }
                  }
                } else if (typeof payload.title === "string") {
                  const newTitle = payload.title.trim();
                  if (newTitle && conversationId) {
                    applyConversationState((prev) =>
                      prev.map((conv) =>
                        conv.id === conversationId
                          ? { ...conv, title: newTitle }
                          : conv
                      )
                    );
                    void persistConversationTitle(conversationId, newTitle);
                  }
                } else if (payload.done) {
                  markResponseFinished();
                  finished = true;
                }
              } catch (err) {
                console.warn("Failed to parse stream chunk", err);
              }
            }
            newlineIndex = buffer.indexOf("\n");
          }
        }

        if (done) {
          finished = true;
        }
      }

      // bump last activity timestamp
      if (conversationId) {
        applyConversationState((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, created_at: new Date().toISOString() }
              : c
          )
        );
      }

      void refreshConversations();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.warn("Chat request aborted");
      } else {
        console.error("[SEND_PIPELINE] sendTextMessage error", error);
        if (!conversationId) {
          setComposerError(
            "We couldn’t create a conversation record. Check the console logs and Supabase schema."
          );
        } else if (assistantMessageId) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: "Error contacting GPT. Try again." }
                : msg
            )
          );
        } else {
          setComposerError("Error contacting GPT. Try again.");
        }
      }
      resetThinkingIndicator();
      setSearchIndicator(null);
      setFileReadingIndicator(null);
      setLiveSearchDomains([]);
      responseTimingRef.current = {
        start: null,
        firstToken: null,
        assistantMessageId: null,
      };
      setStreamingConversationId((current) =>
        conversationId && current === conversationId ? null : current
      );
      if (assistantMessageId) {
        pendingMetadataPersistRef.current.delete(assistantMessageId);
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setActiveAssistantMessageId((current) =>
        assistantMessageId && current === assistantMessageId ? null : current
      );
      setFileReadingIndicator(null);
      setLiveSearchDomains([]);
      responseTimingRef.current = {
        start: null,
        firstToken: null,
        assistantMessageId: null,
      };
      setStreamingConversationId((current) =>
        conversationId && current === conversationId ? null : current
      );
      if (assistantMessageId) {
        pendingMetadataPersistRef.current.delete(assistantMessageId);
      }
    }
  }

  async function sendImageMessage(options?: SendImageMessageOptions) {
    if (isStreaming) return;
    const sourceText = options?.messageOverride ?? input;
    const prompt = sourceText.trim();
    if (!prompt) {
      setComposerError("Enter a prompt to create an image.");
      return;
    }
    if (imageAttachments.length > 0 || fileAttachments.length > 0) {
      setComposerError("Remove attachments before creating an image.");
      return;
    }

    let conversationId = selectedConversationId;
    let assistantMessageId: string | null =
      options?.retry?.assistantMessageId ?? null;
    let userMessageId: string | null = null;
    const isRetry = Boolean(options?.retry);

    if (!options?.messageOverride) {
      setInput("");
      setImageAttachments([]);
      setFileAttachments([]);
    }
    setComposerError(null);
    setIsStreaming(true);
    setComposerMenuOpen(false);
    setRowMenu(null);
    setMoveMenuConversationId(null);
    setAutoScrollEnabled(true);
    setShowScrollButton(false);
    setForceWebSearch(false);
    setSearchIndicator(null);
    setFileReadingIndicator(null);
    setLiveSearchDomains([]);
    setThinkingStatus({ variant: "thinking", label: "Generating image…" });

    try {
      if (!conversationId && isRetry) {
        throw new Error("Cannot retry without a conversation");
      }
      if (!conversationId) {
        const projectTarget = allowProjectSections
          ? pendingNewChat
            ? pendingNewChatProjectId ?? null
            : selectedProjectId ?? null
          : null;
        const conv = await createConversation({
          projectId: projectTarget,
          agentId: defaultAgentId,
        });
        conversationId = conv.id;
        if (isCodexMode) {
          rememberCodexLandingScroll();
        }
        setSelectedConversationId(conv.id);
        if (allowProjectSections) {
          setSelectedProjectId(conv.project_id ?? projectTarget ?? null);
        } else {
          setSelectedProjectId(null);
        }
        setViewMode("chat");
        skipAutoLoadRef.current = conv.id;
        setPendingNewChat(false);
        setPendingNewChatProjectId(null);
      }

      if (!assistantMessageId) {
        assistantMessageId = createLocalId();
      }
      responseTimingRef.current = {
        start:
          typeof performance !== "undefined" ? performance.now() : Date.now(),
        firstToken: null,
        assistantMessageId,
      };
      setActiveAssistantMessageId(assistantMessageId);

      if (!isRetry) {
        const newUserMessageId = createLocalId();
        userMessageId = newUserMessageId;
        const placeholderAssistantId = assistantMessageId!;
        setMessages((prev) => [
          ...prev,
          {
            id: newUserMessageId,
            role: "user",
            content: prompt,
          },
          {
            id: placeholderAssistantId,
            role: "assistant",
            content: "",
            metadata: {
              generationType: "image",
              imagePrompt: prompt,
            },
          },
        ]);
      } else {
        if (assistantMessageId) {
          pendingMetadataPersistRef.current.delete(assistantMessageId);
        }
        const promptCopy = prompt;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: "",
                  usedModel: undefined,
                  usedModelMode: undefined,
                  usedModelFamily: undefined,
                  metadata: {
                    ...(msg.metadata || {}),
                    generationType: "image",
                    imagePrompt: promptCopy,
                    generatedImages: [],
                    imageModelLabel: undefined,
                  },
                }
              : msg
          )
        );
      }

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const requestBody: Record<string, unknown> = {
        prompt,
        conversationId,
      };
      if (options?.modelOverride) {
        requestBody.model = options.modelOverride;
      }
      if (options?.retry?.assistantPersistedId) {
        requestBody.retryAssistantMessageId =
          options.retry.assistantPersistedId;
      }
      if (options?.retry?.userMessagePersistedId) {
        requestBody.retryUserMessageId =
          options.retry.userMessagePersistedId;
      }

      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
      if (!res.ok) {
        throw new Error("Image generation failed");
      }
      const payload = (await res.json()) as {
        assistantMessageId?: string;
        userMessageId?: string;
        images: GeneratedImageResult[];
        usedModel: ImageModelKey;
        metadata?: Partial<MessageMetadata>;
        content?: string;
      };

      const resolvedAssistantId =
        payload.assistantMessageId ?? assistantMessageId;
      const imageModelLabel =
        IMAGE_MODEL_LABELS[payload.usedModel] ?? payload.usedModel;
      const resolvedMetadata: MessageMetadata = {
        generationType: "image",
        imagePrompt: prompt,
        imageModelLabel,
        generatedImages: payload.images,
        ...(payload.metadata || {}),
      };
      const assistantContent =
        payload.content?.trim() ||
        (payload.images.length > 1
          ? "Created the requested images."
          : "Created the requested image.");

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMessageId) return msg;
          return {
            ...msg,
            content: assistantContent,
            metadata: resolvedMetadata,
            usedModel: payload.usedModel,
            persistedId: payload.assistantMessageId ?? msg.persistedId,
          };
        })
      );

      if (resolvedAssistantId) {
        persistMessageMetadata(resolvedAssistantId, resolvedMetadata);
      } else if (assistantMessageId) {
        pendingMetadataPersistRef.current.set(
          assistantMessageId,
          resolvedMetadata
        );
      }

      if (payload.userMessageId && userMessageId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === userMessageId
              ? { ...msg, persistedId: payload.userMessageId ?? msg.persistedId }
              : msg
          )
        );
      }
      void refreshConversations();
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") {
        console.warn("Image request aborted");
      } else {
        console.error(error);
        if (assistantMessageId) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: "Unable to create the image. Try again.",
                  }
                : msg
            )
          );
        } else {
          setComposerError("Unable to create the image. Try again.");
        }
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setActiveAssistantMessageId((current) =>
        assistantMessageId && current === assistantMessageId ? null : current
      );
      setThinkingStatus(null);
      setLiveSearchDomains([]);
      responseTimingRef.current = {
        start: null,
        firstToken: null,
        assistantMessageId: null,
      };
      setStreamingConversationId((current) =>
        conversationId && current === conversationId ? null : current
      );
      setCreateImageArmed(false);
      if (assistantMessageId) {
        pendingMetadataPersistRef.current.delete(assistantMessageId);
      }
    }
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (createImageArmed) {
        void sendImageMessage();
      } else {
        void sendTextMessage();
      }
    }
  }

  async function handleRetryWithModel(
    targetFamily: Exclude<ModelFamily, "auto">,
    targetMessage: ChatMessage
  ) {
    if (targetMessage.metadata?.generationType === "image") {
      return;
    }
    if (!targetMessage.id) return;
    const targetIndex = messages.findIndex(
      (msg) => msg.id === targetMessage.id
    );
    if (targetIndex === -1) return;
    const relatedUserMessage = [...messages]
      .slice(0, targetIndex)
      .reverse()
      .find((msg) => msg.role === "user");
    if (!relatedUserMessage) return;
    const retryPayload: RetryOptions | undefined =
      targetMessage.persistedId && relatedUserMessage.persistedId
        ? {
            assistantMessageId: targetMessage.id,
            assistantPersistedId: targetMessage.persistedId,
            userMessagePersistedId: relatedUserMessage.persistedId,
          }
        : undefined;
    setModelFamily(targetFamily);
    setOpenModelMenuId(null);
    setExpandedSourcesId((prev) =>
      prev === targetMessage.id ? null : prev
    );
    await sendTextMessage({
      messageOverride: relatedUserMessage.content,
      attachmentsOverride: relatedUserMessage.attachments ?? [],
      modelOverride: targetFamily,
      retry: retryPayload,
    });
  }

  const handleStopGeneration = useCallback(() => {
    const activeId = activeAssistantMessageId;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setStreamingConversationId(null);
    resetThinkingIndicator();
    setSearchIndicator(null);
    setFileReadingIndicator(null);
    responseTimingRef.current = {
      start: null,
      firstToken: null,
      assistantMessageId: null,
    };
    if (activeId) {
      pendingMetadataPersistRef.current.delete(activeId);
    }
    setActiveAssistantMessageId(null);
  }, [activeAssistantMessageId, resetThinkingIndicator]);

  useEffect(() => {
    const previousConversationId = previousConversationIdRef.current;
    if (previousConversationId !== selectedConversationId) {
      if (
        previousConversationId &&
        streamingConversationId === previousConversationId &&
        isStreaming
      ) {
        handleStopGeneration();
      }
      setThinkingStatus(null);
      setSearchIndicator(null);
      setFileReadingIndicator(null);
      if (
        streamingConversationId &&
        streamingConversationId !== selectedConversationId
      ) {
        setStreamingConversationId(null);
      }
    }
    previousConversationIdRef.current = selectedConversationId;
  }, [
    selectedConversationId,
    streamingConversationId,
    isStreaming,
    handleStopGeneration,
  ]);

  async function handleRetryWithImageModel(
    targetModel: ImageModelKey,
    targetMessage: ChatMessage
  ) {
    if (!targetMessage.id) return;
    const targetIndex = messages.findIndex(
      (msg) => msg.id === targetMessage.id
    );
    if (targetIndex === -1) return;
    const relatedUserMessage = [...messages]
      .slice(0, targetIndex)
      .reverse()
      .find((msg) => msg.role === "user");
    if (!relatedUserMessage) return;
    const retryPayload: RetryOptions | undefined =
      targetMessage.persistedId && relatedUserMessage.persistedId
        ? {
            assistantMessageId: targetMessage.id,
            assistantPersistedId: targetMessage.persistedId,
            userMessagePersistedId: relatedUserMessage.persistedId,
          }
        : undefined;
    await sendImageMessage({
      messageOverride: relatedUserMessage.content,
      modelOverride: targetModel,
      retry: retryPayload,
    });
  }

  async function handleCopyMessage(message: ChatMessage, fallbackId?: string) {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id ?? fallbackId ?? null);
      setTimeout(() => setCopiedMessageId(null), 1500);
    } catch (err) {
      console.error("Copy failed", err);
    }
  }

  // ------------------------------------------------------------
  // PROJECTS + CHAT MGMT
  // ------------------------------------------------------------
  const ensureChatRoute = () => {
    if (isAgentsView) {
      router.push("/");
    }
  };

  function handleNewChat(global = false) {
    ensureChatRoute();
    if (pendingNewChat) {
      return;
    }
    if (isCodexMode && !selectedConversationId) {
      rememberCodexLandingScroll();
    }
    const targetProjectId = allowProjectSections
      ? global
        ? null
        : selectedProjectId ?? null
      : null;
    setPendingNewChat(true);
    setPendingNewChatProjectId(targetProjectId);
    setSelectedConversationId(null);
    if (allowProjectSections) {
      setSelectedProjectId(targetProjectId);
    } else {
      setSelectedProjectId(null);
    }
    setMessages([]);
    setIsLoadingMessages(false);
    setViewMode("chat");
    setSidebarOpen(false);
  }

  async function handleCreateProject() {
    if (!allowProjectSections) {
      return;
    }
    const name = newProjectName.trim();
    if (!name) return;

    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: TEST_USER_ID, name })
      .select("id, name, created_at")
      .single();

    if (!error && data) {
      setProjects((prev) => [data, ...prev]);
      setSelectedProjectId(data.id);
      setViewMode("project");
      setShowProjectModal(false);
      setNewProjectName("");
    }
  }

  async function renameConversation(id: string) {
    const oldTitle =
      conversations.find((c) => c.id === id)?.title || "Untitled chat";

    const nextTitle = window.prompt("Rename chat:", oldTitle);
    if (!nextTitle || !nextTitle.trim()) return;

    await supabase
      .from("conversations")
      .update({ title: nextTitle.trim() })
      .eq("id", id);

    applyConversationState((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: nextTitle.trim() } : c))
    );
  }

  async function deleteConversation(id: string) {
    await supabase.from("messages").delete().eq("conversation_id", id);
    await supabase.from("conversations").delete().eq("id", id);
    removeConversationFromCache(id);

    applyConversationState(
      (prev) => prev.filter((c) => c.id !== id),
      (_, nextFiltered) => {
        if (selectedConversationId === id) {
          const fallback = getNewestConversation(nextFiltered);
          if (fallback) {
            setSelectedConversationId(fallback.id);
            setSelectedProjectId(fallback.project_id);
            setViewMode("chat");
          } else {
            setSelectedConversationId(null);
            setMessages([]);
          }
        }
      }
    );
  }

  const requestDeleteConversation = (id: string) => {
    const target = conversations.find((c) => c.id === id);
    setPendingDeleteConversation({
      id,
      title: target?.title?.trim() || "Untitled chat",
    });
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDeleteConversation) return;
    setDeleteConversationLoading(true);
    try {
      await deleteConversation(pendingDeleteConversation.id);
    } finally {
      setDeleteConversationLoading(false);
      setPendingDeleteConversation(null);
    }
  };

  async function moveConversation(id: string, newProjectId: string | null) {
    await supabase
      .from("conversations")
      .update({ project_id: newProjectId })
      .eq("id", id);

    applyConversationState((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, project_id: newProjectId } : c
      )
    );

    if (selectedConversationId === id) {
      setSelectedProjectId(newProjectId);
    }
  }

  async function handleMoveFromMenu(
    conversationId: string,
    targetProjectId: string | null
  ) {
    await moveConversation(conversationId, targetProjectId);
    setRowMenu(null);
    setMoveMenuConversationId(null);
  }

  async function renameProject(id: string) {
    const existingName = projects.find((p) => p.id === id)?.name || "Untitled";
    const nextName = window.prompt("Rename project:", existingName);
    if (!nextName || !nextName.trim()) return;
    await supabase
      .from("projects")
      .update({ name: nextName.trim() })
      .eq("id", id);

    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: nextName.trim() } : p))
    );
  }

  async function deleteProject(id: string) {
    if (!allowProjectSections) {
      return;
    }
    const { data: conversationRows } = await supabase
      .from("conversations")
      .select("id")
      .eq("project_id", id);

    const conversationIds = new Set(
      (conversationRows || []).map((row) => (row as { id: string }).id)
    );
    conversations
      .filter((c) => c.project_id === id)
      .forEach((c) => {
        if (c.id) {
          conversationIds.add(c.id);
        }
      });
    const idsArray = Array.from(conversationIds);

    if (idsArray.length > 0) {
      await supabase
        .from("messages")
        .delete()
        .in("conversation_id", idsArray);
      await supabase
        .from("conversations")
        .delete()
        .in("id", idsArray);
      idsArray.forEach((conversationId) =>
        removeConversationFromCache(conversationId)
      );
    }

    await supabase.from("projects").delete().eq("id", id);

    setProjects((prev) => prev.filter((p) => p.id !== id));
    const selectedConversationDeleted =
      !!selectedConversationId &&
      conversationIds.has(selectedConversationId);
    applyConversationState(
      (prev) => prev.filter((c) => !conversationIds.has(c.id)),
      (_, nextFiltered) => {
        if (selectedConversationDeleted) {
          const fallback = getNewestConversation(nextFiltered);
          if (fallback) {
            setSelectedConversationId(fallback.id);
            setSelectedProjectId(fallback.project_id);
            setViewMode("chat");
          } else {
            setSelectedConversationId(null);
            setMessages([]);
          }
        }
      }
    );

    if (!selectedConversationDeleted && selectedProjectId === id) {
      setSelectedProjectId(null);
      setViewMode("chat");
    }
  }

  const requestDeleteProject = (id: string) => {
    if (!allowProjectSections) {
      return;
    }
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    setPendingDeleteProject(target);
  };

  const confirmDeleteProject = async () => {
    if (!allowProjectSections) {
      return;
    }
    if (!pendingDeleteProject) return;
    setDeleteProjectLoading(true);
    try {
      await deleteProject(pendingDeleteProject.id);
    } finally {
      setDeleteProjectLoading(false);
      setPendingDeleteProject(null);
    }
  };

  // ------------------------------------------------------------
  // SIDEBAR CONTENT (shared between desktop + mobile)
  // ------------------------------------------------------------
  const SidebarSections = () => (
    <>
      <div className="px-3 py-3">
        <button
          onClick={() => void handleNewChat(true)}
          className="flex w-full items-center gap-2 rounded-md bg-[#202123] px-3 py-2 text-sm text-zinc-100 hover:bg-[#26272b]"
        >
          <span className="text-lg leading-none">＋</span>
          <span>New chat</span>
        </button>
        <button
          onClick={() => {
            if (!showAgentsCatalog) {
              router.push("/agents");
            }
          }}
          className={`mt-3 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
            showAgentsCatalog
              ? "bg-[#2a2b30] text-white"
              : "text-zinc-300 hover:bg-[#202123] hover:text-zinc-100"
          }`}
          aria-current={showAgentsCatalog ? "page" : undefined}
        >
          <span className="flex h-4 w-4 items-center justify-center text-current">
            <AgentsToolIcon className="h-4 w-4" />
          </span>
          <span className="leading-none">Agents</span>
        </button>
      </div>

      {allowProjectSections && (
        <>
          <div className="mt-1 flex items-center justify-between px-3 text-[11px] font-semibold uppercase text-zinc-500">
            <span>Projects</span>
            <button
              onClick={() => setShowProjectModal(true)}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              + New
            </button>
          </div>

          <div className="mt-1 flex flex-col gap-1 px-2">
            {sortedProjects.length === 0 && (
              <div className="px-1 py-2 text-[11px] text-zinc-500">No projects yet.</div>
            )}

            {sortedProjects.map((p) => {
          const isSelectedProject = sidebarActiveProjectId === p.id;
          const isMenuOpen = rowMenu?.type === "project" && rowMenu.id === p.id;
          const projectChatList = projectSidebarChats.get(p.id) || [];
          const topChats = projectChatList.slice(0, MAX_PROJECT_CHAT_PREVIEW);
          const hasMoreChats = projectChatList.length > MAX_PROJECT_CHAT_PREVIEW;
          return (
            <div key={p.id} className="group relative">
              <div
                className={`flex items-center rounded-md ${
                  isSelectedProject
                    ? "bg-[#202123] text-zinc-100"
                    : "text-zinc-300 hover:bg-[#202123]"
                }`}
              >
                <button
                  className="flex-1 truncate px-3 py-2 text-left text-sm"
                  onClick={() => handleProjectSelect(p.id)}
                >
                  {p.name}
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setMoveMenuConversationId(null);
                    setRowMenu((prev) =>
                      prev?.type === "project" && prev.id === p.id
                        ? null
                        : { type: "project", id: p.id }
                    );
                  }}
                  aria-label="Project actions"
                  className="mr-2 flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
                >
                  ⋯
                </button>

                {isMenuOpen && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute right-0 top-full z-30 mt-2 w-40 rounded-2xl border border-[#2a2a30] bg-[#101014] p-1 text-left text-xs shadow-2xl"
                  >
                    <button
                      onClick={() => {
                        renameProject(p.id);
                        setRowMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-zinc-200 hover:bg-[#1d1d24]"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => {
                        requestDeleteProject(p.id);
                        setRowMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-red-400 hover:bg-[#1d1d24]"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {isSelectedProject && topChats.length > 0 && (
                <div className="ml-6 mt-1 space-y-1 border-l border-[#2a2a30] pl-3">
                  {topChats.map((chat) => {
                    const chatActive =
                      selectedConversationId === chat.id && viewMode === "chat";
                    return (
                      <button
                        key={chat.id}
                        className={`block w-full truncate rounded-md px-2 py-1 text-left text-[12px] ${
                          chatActive
                            ? "bg-[#202123] text-white"
                            : "text-zinc-400 hover:text-white"
                        }`}
                        onClick={() => handleConversationSelect(chat.id)}
                      >
                        {chat.title || "Untitled chat"}
                      </button>
                    );
                  })}
                  {hasMoreChats && (
                    <button
                      className="block w-full truncate rounded-md px-2 py-1 text-left text-[12px] text-zinc-500 hover:text-white"
                      onClick={() => handleProjectSelect(p.id)}
                    >
                      Show more
                    </button>
                  )}
                </div>
              )}
            </div>
          );
            })}
          </div>
        </>
      )}

      {/* All chats */}
      <div className="mt-4 px-3 text-[11px] font-semibold uppercase text-zinc-500">
        All chats
      </div>

      <div className="mt-1 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {unassignedChats.length === 0 && (
          <div className="px-1 py-2 text-[11px] text-zinc-500">
            No unassigned chats yet.
          </div>
        )}

        {unassignedChats.map((c) => {
          const isActive = selectedConversationId === c.id && viewMode === "chat";
          const isMenuOpen = rowMenu?.type === "conversation" && rowMenu.id === c.id;
          const showMoveMenu = moveMenuConversationId === c.id;
          return (
            <div
              key={c.id}
              className={`group relative flex items-center rounded-md px-2 text-sm ${
                isActive
                  ? "bg-[#202123] text-zinc-100"
                  : "text-zinc-300 hover:bg-[#202123]"
              }`}
            >
              <button
                className="flex-1 truncate px-1 py-2 text-left"
                onClick={() => handleConversationSelect(c.id)}
              >
                {c.title || "Untitled chat"}
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setMoveMenuConversationId(null);
                  setRowMenu((prev) =>
                    prev?.type === "conversation" && prev.id === c.id
                      ? null
                      : { type: "conversation", id: c.id }
                  );
                }}
                aria-label="Conversation actions"
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
              >
                ⋯
              </button>

              {isMenuOpen && (
                <div
                  onClick={(event) => event.stopPropagation()}
                  className="absolute right-0 top-full z-30 mt-2 w-48 rounded-2xl border border-[#2a2a30] bg-[#101014] p-2 text-left text-xs shadow-2xl"
                >
                  <button
                    onClick={() => {
                      renameConversation(c.id);
                      setRowMenu(null);
                      setMoveMenuConversationId(null);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                  >
                    Rename
                  </button>
                  {allowProjectSections && (
                    <div className="relative">
                      <button
                        onClick={() =>
                          setMoveMenuConversationId((prev) =>
                            prev === c.id ? null : c.id
                          )
                        }
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                        aria-expanded={showMoveMenu}
                      >
                        Move to project
                        <span className="text-[10px] text-zinc-500">
                          {showMoveMenu ? "▲" : "▼"}
                        </span>
                      </button>
                      {showMoveMenu && (
                        <div className="mt-2 space-y-1 rounded-xl border border-[#2a2a30] bg-[#0f0f14] p-1">
                          <button
                            onClick={() => handleMoveFromMenu(c.id, null)}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                          >
                            No project
                          </button>
                          <div className="max-h-48 overflow-y-auto">
                            {sortedProjects.map((proj) => (
                              <button
                                key={proj.id}
                                onClick={() => handleMoveFromMenu(c.id, proj.id)}
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21] ${
                                  proj.id === c.project_id
                                    ? "bg-[#1b1b21]"
                                    : ""
                                }`}
                              >
                                {proj.name}
                                {proj.id === c.project_id && (
                                  <span className="text-[10px] text-zinc-500">Current</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      requestDeleteConversation(c.id);
                      setRowMenu(null);
                      setMoveMenuConversationId(null);
                    }}
                    className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-red-400 hover:bg-[#1b1b21]"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#202123] px-3 py-3 text-xs text-zinc-500">
        LLM Client · dev build
      </div>
    </>
  );

  const renderCodexExperience = () => {
    if (selectedConversationId || pendingNewChat) {
      const title = selectedConversationId
        ? selectedConversationMeta?.title?.trim() || "Untitled task"
        : "New chat";
      const dateLabel = selectedConversationId
        ? formatConversationDateLabel(selectedConversationMeta?.created_at)
        : "";
      return (
        <div className="flex h-screen min-h-0 flex-col bg-[#030308] text-white">
          <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedConversationId(null);
                  setPendingNewChat(false);
                  setPendingNewChatProjectId(null);
                  setMessages([]);
                  setIsLoadingMessages(false);
                  setViewMode("chat");
                  setSidebarOpen(false);
                }}
                className="rounded-full border border-white/15 p-2 text-white/80 transition hover:text-white"
                aria-label="Back to Codex tasks"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <div className="h-8 w-px bg-white/10" />
              <div>
                <div className="text-lg font-semibold text-white">{title}</div>
                <div className="text-sm text-white/60">
                  {dateLabel || ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {codexHeaderActions.map(({ label, Icon }) => (
                <button
                  key={label}
                  type="button"
                  className="flex items-center gap-1 text-sm text-white/70 transition hover:text-white"
                >
                  <Icon className="h-4 w-4 text-white/70" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </header>
          <div className="flex flex-1 min-h-0 flex-col">
            {renderChatInterface({
              composerVariant: "codexBottom",
              messageContainerClass:
                "flex h-full flex-col overflow-y-auto overflow-x-hidden px-4 py-6 pb-32 md:px-12",
              showInlineTitle: false,
            })}
          </div>
        </div>
      );
    }

    const agentEntries = [
      { id: "codex", label: "Codex", active: true },
      { id: "market", label: "Market agent", active: false },
      { id: "automation", label: "Automation builder", active: false },
      { id: "data", label: "Data interpreter", active: false },
    ];
    const codexTabs: Array<{ id: typeof codexActiveTab; label: string }> = [
      { id: "tasks", label: "Tasks" },
      { id: "code-reviews", label: "Code reviews" },
      { id: "archive", label: "Archive" },
    ];
    return (
      <div className="flex h-screen min-h-0 bg-[#030308] text-white">
        <aside className="hidden w-64 flex-col border-r border-white/5 bg-[#050509] p-4 lg:flex">
          <button
            type="button"
            onClick={() => router.push("/agents")}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <AgentsToolIcon className="h-4 w-4" />
            </span>
            <span>Agents</span>
          </button>
          <div className="mt-6 space-y-1 text-sm text-white/70">
            {agentEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`flex w-full items-center rounded-xl px-3 py-2 text-left transition ${
                  entry.active
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </aside>
        <div
          className="flex-1 overflow-y-auto"
          ref={codexLandingScrollRef}
        >
          <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-10">
            <div className="w-full lg:hidden">
              <button
                type="button"
                onClick={() => router.push("/agents")}
                className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:text-white"
              >
                <AgentsToolIcon className="h-4 w-4" />
                <span>Agents</span>
              </button>
              <div className="flex gap-2 overflow-x-auto text-xs text-white/60">
                {agentEntries.map((entry) => (
                  <div
                    key={`mobile-${entry.id}`}
                    className={`rounded-full px-3 py-1 ${
                      entry.active
                        ? "bg-white/15 text-white"
                        : "bg-white/5"
                    }`}
                  >
                    {entry.label}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex w-full flex-col items-center gap-4 text-center">
              <h1 className="text-3xl font-semibold text-white">
                What should we code next?
              </h1>
            </div>

            {renderComposerArea("codexTop")}

            <div className="mt-6 w-full max-w-3xl">
              <div className="flex flex-wrap gap-4 text-sm text-white/70">
                {codexTabs.map((tab) => {
                  const isActive = codexActiveTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCodexActiveTab(tab.id)}
                      className={`border-b-2 px-1 pb-1 transition ${
                        isActive
                          ? "border-white text-white"
                          : "border-transparent text-white/60"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 space-y-2">
                {codexActiveTab === "tasks" ? (
                  sortedConversations.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                      No tasks yet.
                    </div>
                  ) : (
                    sortedConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => handleConversationSelect(conversation.id)}
                        className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
                      >
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {conversation.title?.trim() || "Untitled task"}
                          </div>
                          <div className="text-xs text-white/60">
                            {formatConversationTimestamp(conversation.created_at) ||
                              "Just now"}
                          </div>
                        </div>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          className="h-4 w-4 text-white/50"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      </button>
                    ))
                  )
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                    {codexActiveTab === "code-reviews"
                      ? "Code reviews will appear here soon."
                      : "Archived tasks will live here soon."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const confirmDialogs = (
    <>
      <ConfirmDialog
        open={Boolean(pendingDeleteConversation)}
        title="Delete chat?"
        body={
          <span>
            This will delete &ldquo;
            {pendingDeleteConversation?.title || "this chat"}
            &rdquo;.
          </span>
        }
        confirmLoading={deleteConversationLoading}
        onCancel={() => {
          if (!deleteConversationLoading) {
            setPendingDeleteConversation(null);
          }
        }}
        onConfirm={() => {
          if (!deleteConversationLoading) {
            void confirmDeleteConversation();
          }
        }}
      />
      {allowProjectSections && (
        <ConfirmDialog
          open={Boolean(pendingDeleteProject)}
          title="Delete this project?"
          body={
            <span>
              This will delete &ldquo;
              {pendingDeleteProject?.name || "this project"}
              &rdquo; and all of its conversations.
            </span>
          }
          confirmLabel="Delete project"
          confirmLoading={deleteProjectLoading}
          onCancel={() => {
            if (!deleteProjectLoading) {
              setPendingDeleteProject(null);
            }
          }}
          onConfirm={() => {
            if (!deleteProjectLoading) {
              void confirmDeleteProject();
            }
          }}
        />
      )}
    </>
  );

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  if (isCodexMode) {
    return (
      <>
        {renderCodexExperience()}
        {confirmDialogs}
      </>
    );
  }

  return (
    <>
      <div className="flex h-screen min-h-0 bg-[#212121] text-zinc-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 min-h-0 flex-col border-r border-[#202123] bg-[#181818] md:flex">
        <SidebarSections />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="flex w-64 flex-col border-r border-[#202123] bg-[#181818]">
            <div className="flex items-center justify-between border-b border-[#202123] px-3 py-3">
              <span className="text-sm font-semibold">Menu</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-sm text-zinc-400 hover:text-zinc-200"
              >
                Close
              </button>
            </div>
            <SidebarSections />
          </div>
          <button
            className="flex-1 bg-black/40"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="flex flex-1 min-h-0 flex-col bg-[#212121]">
        {/* Header */}
        <header className="relative flex shrink-0 items-center justify-between border-b border-[#2a2a2a] bg-transparent px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-[#2f2f32] px-2 py-1 text-sm text-zinc-300 hover:bg-[#2a2a2e] md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            {showAgentsCatalog ? (
              <span className="text-base font-semibold text-white md:text-lg">
                Explore Agents
              </span>
            ) : isCodexMode ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/agents")}
                  className="text-sm font-semibold text-white/80 transition hover:text-white"
                >
                  Agents
                </button>
                <span className="text-white/40">/</span>
                <span className="text-base font-semibold text-white">
                  Codex
                </span>
              </div>
            ) : (
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={headerModelMenuOpen}
                  aria-label="Choose model and speed"
                  onClick={(event) => {
                    event.stopPropagation();
                    setHeaderModelMenuOpen((prev) => !prev);
                  }}
                  className={`group inline-flex items-center gap-2 text-base font-semibold text-white/80 transition hover:text-white focus-visible:outline-none focus-visible:underline md:text-lg ${
                    headerModelMenuOpen ? "text-white" : ""
                  }`}
                >
                  <span className="text-white">LLM Client</span>
                  <span className="text-white">{headerModelLabel}</span>
                  {headerSpeedDisplay && (
                    <span className="text-white">{headerSpeedDisplay}</span>
                  )}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className={`h-3 w-3 text-white/70 transition ${
                      headerModelMenuOpen ? "-rotate-180 text-white" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {headerModelMenuOpen && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute right-0 top-full z-40 mt-3 min-w-[18rem] rounded-2xl border border-white/10 bg-[#111116] text-left text-xs text-white shadow-2xl"
                    style={{ width: "min(20rem, calc(100vw - 2rem))" }}
                  >
                    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-4 py-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {describeModelFamily("gpt-5.1")}
                        </div>
                        <div className="text-[11px] text-white/60">Speed controls</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        {SPEED_OPTIONS.map((option) => {
                          const isActive =
                            modelFamily === "gpt-5.1" &&
                            speedMode === option.value;
                          return (
                            <button
                              key={option.value}
                              onClick={() => {
                                setModelFamily("gpt-5.1");
                                setSpeedMode(option.value);
                                setHeaderModelMenuOpen(false);
                              }}
                              className={`flex items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                                isActive
                                  ? "bg-white/10 text-white font-semibold"
                                  : "text-white/70 hover:bg-white/5"
                              }`}
                            >
                              <span className="flex flex-col">
                                <span className="text-sm">{option.label}</span>
                                <span className="text-[11px] text-white/60">
                                  {option.hint}
                                </span>
                              </span>
                              {isActive && (
                                <CheckmarkIcon className="h-3.5 w-3.5 text-white" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="pt-1">
                        <div className="text-sm font-semibold text-white">
                          Other Models
                        </div>
                        <div className="text-[11px] text-white/60">
                          Mini &amp; Nano presets
                        </div>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setOtherModelsMenuOpen((prev) => !prev);
                          }}
                          className="mt-2 flex w-full items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-left text-white/80 transition hover:text-white"
                          aria-expanded={otherModelsMenuOpen}
                        >
                          <span className="text-sm font-medium text-white">
                            Other Models
                          </span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className={`h-3.5 w-3.5 transition ${
                              otherModelsMenuOpen ? "rotate-180 text-white" : "text-white/60"
                            }`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </button>
                        {otherModelsMenuOpen && (
                          <div className="mt-3 rounded-2xl border border-white/10 bg-[#111116] text-left text-xs text-white shadow-2xl">
                            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-3 py-3">
                              {OTHER_MODEL_GROUPS.map((group) => (
                                <div key={group.family} className="space-y-1">
                                  <div className="text-xs uppercase tracking-wide text-white/60">
                                    {group.label}
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    {group.supportsSpeedModes === false ? (
                                      <button
                                        onClick={() => {
                                          setModelFamily(group.family);
                                          setHeaderModelMenuOpen(false);
                                        }}
                                        className={`flex items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                                          modelFamily === group.family
                                            ? "bg-white/10 text-white font-semibold"
                                            : "text-white/70 hover:bg-white/5"
                                        }`}
                                      >
                                        <span>{group.label}</span>
                                        {modelFamily === group.family && (
                                          <CheckmarkIcon className="h-3.5 w-3.5 text-white" />
                                        )}
                                      </button>
                                    ) : (
                                      SPEED_OPTIONS.map((option) => {
                                        const isComboActive =
                                          modelFamily === group.family &&
                                          speedMode === option.value;
                                        return (
                                          <button
                                            key={`${group.family}-${option.value}`}
                                            onClick={() => {
                                              setModelFamily(group.family);
                                              setSpeedMode(option.value);
                                              setHeaderModelMenuOpen(false);
                                            }}
                                            className={`flex items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                                              isComboActive
                                                ? "bg-white/10 text-white font-semibold"
                                                : "text-white/70 hover:bg-white/5"
                                            }`}
                                          >
                                            <span>{`${group.shortLabel} ${option.label}`}</span>
                                            {isComboActive && (
                                              <CheckmarkIcon className="h-3.5 w-3.5 text-white" />
                                            )}
                                          </button>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isCodexMode &&
              codexHeaderActions.map(({ label, Icon }) => (
                <button
                  key={label}
                  type="button"
                  className="flex items-center gap-1 text-sm text-white/70 transition hover:text-white"
                >
                  <Icon className="h-3.5 w-3.5 text-white/70" />
                  <span>{label}</span>
                </button>
              ))}
          </div>
        </header>

        {/* MAIN CONTENT SWITCH */}
        {showAgentsCatalog ? (
          <AgentsCatalog />
        ) : inProjectView && currentProject ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6">
            <div className="mx-auto max-w-3xl">
              <h1 className="mb-4 text-lg font-semibold">
                {currentProject.name}
              </h1>

              <button
                onClick={() => void handleNewChat(false)}
                className="mb-6 w-full rounded-2xl bg-[#181818] px-4 py-3 text-sm text-zinc-300 hover:bg-[#202123]"
              >
                ＋ New chat in {currentProject.name}
              </button>

              {projectChats.length === 0 && (
                <div className="text-sm text-zinc-500">
                  No chats in this project yet.
                </div>
              )}

              <div className="space-y-2">
                {projectChats.map((c) => (
                  <div
                    key={c.id}
                    className="space-y-2 rounded-xl bg-[#181818] px-4 py-3 text-sm hover:bg-[#202123]"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        className="flex-1 text-left"
                        onClick={() => {
                          handleConversationSelect(c.id);
                          setSidebarOpen(false);
                        }}
                      >
                        <div className="font-medium text-zinc-100">
                          {c.title || "Untitled chat"}
                        </div>
                      </button>

                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        requestDeleteConversation(c.id);
                      }}
                      aria-label="Delete chat"
                      className="rounded-md p-1 text-xs text-zinc-500 transition hover:text-red-400"
                    >
                      ×
                    </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                      <button
                        onClick={() => renameConversation(c.id)}
                        className="hover:text-zinc-200"
                      >
                        Rename
                      </button>

                      <span>·</span>

                      <select
                        className="rounded-md border border-[#3f3f46] bg-transparent px-1 py-0.5"
                        value={c.project_id || ""}
                        onChange={(e) =>
                          moveConversation(
                            c.id,
                            e.target.value === "" ? null : e.target.value
                          )
                        }
                      >
                        <option value="">No project</option>
                        {sortedProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>

                      <span>·</span>

                      <button
                        onClick={() => requestDeleteConversation(c.id)}
                        className="hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="h-10" />
            </div>
          </div>
        ) : (
          /* CHAT VIEW */
          <>
            {/* Messages */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={chatContainerRef}
                className="flex h-full flex-col overflow-y-auto overflow-x-hidden px-4 py-6 pb-32"
              >
                <div
                  className="mx-auto flex w-full flex-col space-y-4 pb-6"
                  style={{ maxWidth: MAX_MESSAGE_WIDTH }}
                >
                  {(() => {
                    const titleLabel = selectedConversationMeta?.title?.trim()
                      ? selectedConversationMeta.title.trim()
                      : pendingNewChat
                        ? "New chat"
                        : null;
                    if (!titleLabel) {
                      return null;
                    }
                    return (
                      <div className="text-center text-sm font-semibold text-white/80">
                        {titleLabel}
                      </div>
                    );
                  })()}

                  {isLoadingMessages && (
                    <div className="mb-2 text-center text-xs text-zinc-500">
                      Loading messages...
                    </div>
                  )}

                  {!isLoadingMessages && messages.length === 0 && (
                    <div className="mt-10 text-center text-sm text-zinc-400">
                      Start chatting — {describeModelFamily("gpt-5.1")} chat is
                      streaming live.
                    </div>
                  )}

                  {messages.map((m, i) => {
                    const messageId = m.id ?? `msg-${i}`;
                    const isAssistant = m.role === "assistant";
                    const rawCitations = ensureArray<Source>(
                      m.metadata?.citations
                    );
                    const displayableSources = rawCitations.filter(
                      (source) =>
                        typeof source?.url === "string" &&
                        source.url.trim().length > 0
                    );
                    const usedWebSearchFlag = Boolean(
                      m.usedWebSearch || m.metadata?.usedWebSearch
                    );
                    const showSourcesButton =
                      isAssistant &&
                      (usedWebSearchFlag || displayableSources.length > 0);
                    const generatedImages = ensureArray<GeneratedImageResult>(
                      m.metadata?.generatedImages
                    );
                    const isImageMessage =
                      m.metadata?.generationType === "image" &&
                      generatedImages.length > 0;
                    const imageModelLabel =
                      isImageMessage && typeof m.usedModel === "string"
                        ? IMAGE_MODEL_LABELS[
                            m.usedModel as ImageModelKey
                          ] || m.usedModel
                        : null;
                    const sourceChips = ensureArray<SourceChip>(
                      m.metadata?.sources
                    ).filter(
                      (chip) =>
                        typeof chip?.url === "string" &&
                        chip.url.trim().length > 0 &&
                        typeof chip?.domain === "string" &&
                        chip.domain.trim().length > 0
                    );
                    const showSourceChips = sourceChips.length > 0;
                    const isStreamingAssistantMessage =
                      isAssistant &&
                      activeAssistantMessageId === messageId;
                    const derivedThoughtSeconds =
                      typeof m.metadata?.thinking?.durationSeconds === "number"
                        ? m.metadata?.thinking?.durationSeconds
                        : typeof m.metadata?.thinking?.durationMs === "number"
                          ? m.metadata?.thinking?.durationMs / 1000
                          : m.thoughtDurationSeconds;
                    const thoughtLabel =
                      m.thoughtDurationLabel &&
                      m.thoughtDurationLabel.trim().length > 0
                        ? m.thoughtDurationLabel
                        : typeof derivedThoughtSeconds === "number"
                          ? formatThoughtDurationLabel(
                              derivedThoughtSeconds
                            )
                          : null;
                    const finalSearchLine = formatSearchedDomainsLine(
                      m.metadata?.searchedDomains
                    );
                    const showSearchChip =
                      isAssistant &&
                      !isStreamingAssistantMessage &&
                      Boolean(finalSearchLine);
                    const assistantWrapperClass =
                      "flex w-full max-w-[95%] flex-col md:max-w-[85%]";
                    const userWrapperClass =
                      "inline-flex max-w-[90%] flex-col md:max-w-[70%]";

                    return (
                      <div
                        key={messageId}
                        className={`flex ${
                          isAssistant ? "justify-start" : "justify-end"
                        }`}
                      >
                        {isAssistant ? (
                          <div
                            className={`${assistantWrapperClass} px-1 py-1 text-left text-[15px] leading-relaxed text-zinc-100 md:px-2`}
                          >
                            {(() => {
                              const statusChips: ReactNode[] = [];
                              if (thoughtLabel) {
                                statusChips.push(
                                  <div
                                    key={`${messageId}-thought-chip`}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#15151a]/80 px-3 py-1 text-xs text-zinc-300"
                                  >
                                    <span
                                      className="h-2 w-2 rounded-full bg-zinc-500"
                                      aria-hidden
                                    />
                                    <span>{thoughtLabel}</span>
                                  </div>
                                );
                              }
                              if (
                                isStreamingAssistantMessage &&
                                searchIndicator?.variant === "running" &&
                                liveSearchDomains.length > 0
                              ) {
                                liveSearchDomains.forEach((domain, index) => {
                                  statusChips.push(
                                    <div
                                      key={`${messageId}-live-search-${domain}-${index}`}
                                      className="flex items-center rounded-full border border-[#2f3750] bg-[#141826]/80 px-3 py-1 text-xs text-[#9bb8ff]"
                                    >
                                      <span>{`Searched ${domain}`}</span>
                                    </div>
                                  );
                                });
                              }
                              if (showSearchChip && finalSearchLine) {
                                statusChips.push(
                                  <div
                                    key={`${messageId}-search-chip`}
                                    className="flex flex-col rounded-2xl border border-[#2f3750] bg-[#141826]/80 px-3 py-1.5 text-xs text-[#9bb8ff]"
                                  >
                                    <span>{finalSearchLine}</span>
                                  </div>
                                );
                              }
                              if (!statusChips.length) {
                                return null;
                              }
                              return (
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  {statusChips.map((chip) => chip)}
                                </div>
                              );
                            })()}
                            <div className="space-y-3 text-[15px] leading-relaxed">
                              <div className="prose prose-invert max-w-none text-sm">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkBreaks]}
                                  rehypePlugins={[rehypeRaw]}
                                  components={markdownComponents}
                                >
                                  {m.content}
                                </ReactMarkdown>
                              </div>
                            </div>

                            {isImageMessage ? (
                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                {generatedImages.map((image) => (
                                  <div
                                    key={`${messageId}-generated-${image.id}`}
                                    className="overflow-hidden rounded-2xl border border-white/10 bg-black/30"
                                  >
                                    <Image
                                      src={image.dataUrl}
                                      alt={
                                        image.prompt
                                          ? `Generated: ${image.prompt}`
                                          : "Generated image"
                                      }
                                      width={512}
                                      height={512}
                                      className="h-auto w-full object-cover"
                                      unoptimized
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {m.attachments?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {m.attachments.map((attachment) => (
                                  <div
                                    key={`${messageId}-assistant-attachment-${attachment.id}`}
                                    className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                                  >
                                    <Image
                                      src={attachment.dataUrl}
                                      alt={attachment.name || "Attachment"}
                                      width={96}
                                      height={96}
                                      className="h-24 w-24 object-cover"
                                      unoptimized
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {showSourceChips && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {sourceChips.map((chip) => (
                                  <a
                                    key={`${messageId}-source-${chip.id}-${chip.domain}`}
                                    href={chip.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="rounded-full border border-[#2f2f36] bg-[#141417] px-3 py-1 text-[12px] text-[#bac4ff] transition hover:border-[#5c5cf5]"
                                    title={chip.title}
                                  >
                                    {chip.domain}
                                  </a>
                                ))}
                              </div>
                            )}

                            {!isStreamingAssistantMessage && (
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleCopyMessage(m, messageId);
                                  }}
                                  className="rounded-full border border-[#3a3a3f] px-3 py-1 text-xs text-zinc-300 hover:border-[#5c5cf5]"
                                >
                                  {copiedMessageId === messageId ? "Copied" : "Copy"}
                                </button>

                                {showSourcesButton && (
                                  <>
                                    <span
                                      className="h-4 w-px bg-[#38383d]"
                                      aria-hidden
                                    />
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setExpandedSourcesId((prev) =>
                                          prev === messageId ? null : messageId
                                        );
                                      }}
                                      className="rounded-full border border-[#35353a] px-3 py-1 text-xs text-zinc-300 hover:border-[#5c5cf5]"
                                      aria-expanded={
                                        expandedSourcesId === messageId
                                      }
                                    >
                                      {expandedSourcesId === messageId
                                        ? "Hide sources"
                                        : "Sources"}
                                    </button>
                                  </>
                                )}

                                {m.usedModel && (
                                  <>
                                    <span
                                      className="h-4 w-px bg-[#38383d]"
                                      aria-hidden
                                    />
                                    <div className="relative">
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setOpenModelMenuId((prev) =>
                                            prev === messageId ? null : messageId
                                          );
                                        }}
                                        className="rounded-full border border-[#3a3a40] px-3 py-1 text-[11px] text-zinc-200 hover:border-[#5c5cf5]"
                                      >
                                        {imageModelLabel
                                          ? imageModelLabel
                                          : m.usedModelFamily
                                            ? describeModelFamily(
                                                m.usedModelFamily
                                              )
                                            : m.usedModel}
                                      </button>

                                      {openModelMenuId === messageId && (
                                        <div className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-[#2d2d33] bg-[#101014] p-2 text-left text-xs shadow-2xl">
                                          {(isImageMessage
                                            ? IMAGE_MODEL_OPTIONS
                                            : MODEL_RETRY_OPTIONS
                                          ).map((option) => {
                                            if (isImageMessage) {
                                              const imageOption =
                                                option as (typeof IMAGE_MODEL_OPTIONS)[number];
                                              const isCurrentImage =
                                                m.usedModel === imageOption.value;
                                              return (
                                                <button
                                                  key={imageOption.value}
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleRetryWithImageModel(
                                                      imageOption.value,
                                                      m
                                                    );
                                                  }}
                                                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                                                >
                                                  <span>
                                                    Retry with {imageOption.label}
                                                  </span>
                                                  {isCurrentImage && (
                                                    <span className="text-[10px] text-zinc-500">
                                                      current
                                                    </span>
                                                  )}
                                                </button>
                                              );
                                            }
                                            const typedOption = option as (typeof MODEL_RETRY_OPTIONS)[number];
                                            const legacyMode =
                                              typedOption.value === "gpt-5-nano"
                                                ? "nano"
                                                : typedOption.value === "gpt-5-mini"
                                                  ? "mini"
                                                  : "full";
                                            const isCurrent =
                                              m.usedModelFamily === typedOption.value ||
                                              (!m.usedModelFamily &&
                                                m.usedModelMode === legacyMode);
                                            return (
                                              <button
                                                key={typedOption.value}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  handleRetryWithModel(
                                                    typedOption.value,
                                                    m
                                                  );
                                                }}
                                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                                              >
                                                <span>
                                                  Retry with {typedOption.label}
                                                </span>
                                                {isCurrent && (
                                                  <span className="text-[10px] text-zinc-500">
                                                    current
                                                  </span>
                                                )}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}

                                {showSourcesButton &&
                                  expandedSourcesId === messageId && (
                                    <div className="mt-3 rounded-2xl border border-[#2f2f36] bg-[#141417] p-3 text-[13px] text-zinc-200">
                                      {displayableSources.length > 0 ? (
                                        <div className="space-y-2">
                                          {displayableSources.map((source, idx) => {
                                            const domain =
                                              source.domain ||
                                              extractDomainFromUrl(source.url);
                                            const title =
                                              (source.title || domain || source.url)?.trim() ||
                                              source.url;
                                            return (
                                              <a
                                                key={`${source.url}-${idx}`}
                                                href={source.url}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                                className="block rounded-xl border border-[#2f2f36] bg-[#1b1b20] p-3 transition hover:border-[#5c5cf5]"
                                              >
                                                <div className="text-[13px] font-semibold text-white">
                                                  {title}
                                                </div>
                                                {domain && (
                                                  <div className="text-[11px] text-zinc-500">
                                                    {domain}
                                                  </div>
                                                )}
                                              </a>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-[12px] text-zinc-400">
                                          {isStreamingAssistantMessage
                                            ? "Gathering live citations…"
                                            : "No citations were shared for this response."}
                                        </p>
                                      )}
                                    </div>
                                  )}
                          </div>
                        ) : (
                          <div
                            className={`relative ${userWrapperClass} rounded-3xl bg-[#1e4fd8] px-5 py-4 text-left text-[15px] leading-relaxed text-white`}
                          >
                            <div className="whitespace-pre-wrap break-words">
                              {m.content && m.content.trim().length > 0 ? (
                                m.content
                              ) : m.attachments?.length ? (
                                <span className="italic text-white/80">
                                  Sent {m.attachments.length > 1
                                    ? `${m.attachments.length} images`
                                    : "an image"}
                                </span>
                              ) : null}
                            </div>
                            {m.attachments?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {m.attachments.map((attachment) => (
                                  <div
                                    key={`${m.id}-attachment-${attachment.id}`}
                                    className="overflow-hidden rounded-2xl border border-white/10 bg-white/10"
                                  >
                                    <Image
                                      src={attachment.dataUrl}
                                      alt={attachment.name || "Chat attachment"}
                                      width={96}
                                      height={96}
                                      className="h-24 w-24 object-cover"
                                      unoptimized
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {m.files?.length ? (
                              <div className="mt-3 space-y-2">
                                {m.files.map((file) => {
                                  const sizeLabel = formatAttachmentSize(file.size);
                                  return (
                                    <div
                                      key={`${m.id}-file-${file.id}`}
                                      className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[12px]"
                                    >
                                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70">
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          viewBox="0 0 24 24"
                                          className="h-4 w-4"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth={1.6}
                                        >
                                          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                                          <path d="M14 3v6h6" />
                                        </svg>
                                      </div>
                                      <div className="min-w-0 flex-1 text-left">
                                        <div className="truncate text-white">
                                          {file.name || "File"}
                                        </div>
                                        {sizeLabel && (
                                          <div className="text-[10px] uppercase tracking-wide text-white/50">
                                            {sizeLabel}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(searchIndicator || thinkingStatus || fileReadingIndicator) && (
                    <div
                      className="mx-auto mt-2 flex flex-col items-center gap-2"
                      style={{ maxWidth: MAX_MESSAGE_WIDTH }}
                    >
                      {fileReadingIndicator && (
                        <StatusBubble
                          label="Reading documents"
                          variant={
                            fileReadingIndicator === "error"
                              ? "error"
                              : "reading"
                          }
                        />
                      )}
                      {searchIndicator && (
                        <StatusBubble
                          label={searchIndicator.message}
                          variant={
                            searchIndicator.variant === "error"
                              ? "error"
                              : "search"
                          }
                          subtext={
                            searchIndicator.variant === "running" &&
                            searchStatusSubtext
                              ? searchStatusSubtext
                              : undefined
                          }
                        />
                      )}
                      {thinkingStatus && (
                        <StatusBubble
                          label={thinkingStatus.label}
                          variant={
                            thinkingStatus.variant === "extended"
                              ? "extended"
                              : "default"
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>

              {showScrollButton && messages.length > 0 && (
                <button
                  onClick={handleJumpToBottom}
                  className="pointer-events-auto absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/15 bg-[#1b1b25]/90 p-3 text-white shadow-xl transition hover:bg-[#242433] sm:bottom-6"
                  aria-label="Jump to latest message"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-[#202123] bg-[#212121] px-4 py-3">
              <div
                className="mx-auto flex w-full flex-col gap-3"
                style={{ maxWidth: MAX_MESSAGE_WIDTH }}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {forceWebSearch && (
                      <button
                        type="button"
                        onClick={() => setForceWebSearch(false)}
                        className="flex items-center gap-1 rounded-full border border-[#4b64ff]/50 bg-[#1a1e2f] px-3 py-1 text-[11px] text-[#a5bfff]"
                      >
                        <span className="text-base leading-none">🌐</span>
                        <span>Web search</span>
                      </button>
                    )}
                    {createImageArmed && (
                      <button
                        type="button"
                        onClick={() => {
                          setCreateImageArmed(false);
                          setComposerError(null);
                        }}
                        className="flex items-center gap-1 rounded-full border border-white/30 bg-[#2b2b31] px-3 py-1 text-[11px] text-zinc-200"
                      >
                        <span className="text-base leading-none">🎨</span>
                        <span>Create image</span>
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {imageAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {imageAttachments.map((attachment) => {
                          const sizeLabel = formatAttachmentSize(
                            attachment.size
                          );
                          return (
                            <div
                              key={`${attachment.id}-preview`}
                              className="group flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2 py-1"
                            >
                              <div className="h-12 w-12 overflow-hidden rounded-xl bg-black/20">
                                <Image
                                  src={attachment.dataUrl}
                                  alt={attachment.name || "Attachment"}
                                  width={48}
                                  height={48}
                                  className="h-full w-full object-cover"
                                  unoptimized
                                />
                              </div>
                              <div className="min-w-0 flex-1 text-left">
                                <div className="truncate text-[12px] font-medium text-white">
                                  {attachment.name || "Image"}
                                </div>
                                {sizeLabel && (
                                  <div className="text-[10px] uppercase tracking-wide text-white/50">
                                    {sizeLabel}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                aria-label="Remove attachment"
                                onClick={() => handleRemoveImageAttachment(attachment.id)}
                                className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {fileAttachments.length > 0 && (
                      <div className="space-y-2">
                        {fileAttachments.map((file) => {
                          const sizeLabel = formatAttachmentSize(file.size);
                          return (
                            <div
                              key={`${file.id}-file`}
                              className="group flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                            >
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1b1b21] text-white/70">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  className="h-4 w-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={1.6}
                                >
                                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                                  <path d="M14 3v6h6" />
                                </svg>
                              </div>
                              <div className="min-w-0 flex-1 text-left">
                                <div className="truncate text-[12px] font-medium text-white">
                                  {file.name || "File"}
                                </div>
                                {sizeLabel && (
                                  <div className="text-[10px] uppercase tracking-wide text-white/50">
                                    {sizeLabel}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                aria-label="Remove file attachment"
                                onClick={() => handleRemoveFileAttachment(file.id)}
                                className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <div className="flex w-full flex-col gap-2">
                        <div className={composerContainerClass}>
                          {isRecording ? (
                            <>
                              <button
                                type="button"
                                aria-label="Cancel voice recording"
                                onClick={() =>
                                  cancelRecordingFlow({ clearInput: true })
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-red-500/60 bg-red-500/10 text-red-300 transition hover:bg-red-500/20"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  className="h-4 w-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                >
                                  <path d="M6 6l12 12M6 18 18 6" />
                                </svg>
                              </button>
                              <div
                                className="flex flex-1 items-center py-1.5"
                                aria-live="polite"
                              >
                                <svg
                                  viewBox="0 0 100 32"
                                  className="h-8 w-full"
                                  aria-hidden
                                >
                                  <path
                                    d={recordingWaveformPath}
                                    fill="none"
                                    stroke="#f87171"
                                    strokeWidth={2}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </div>
                              {renderPrimaryButton()}
                            </>
                          ) : (
                            <>
                              <div className="relative mr-1 flex shrink-0 items-center self-end">
                                <button
                                  type="button"
                                  aria-label="Composer options"
                                  aria-expanded={
                                    !isRecording ? composerMenuOpen : undefined
                                  }
                                  disabled={isRecording}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (isRecording) {
                                      return;
                                    }
                                    setComposerMenuOpen((prev) => !prev);
                                  }}
                                  className={`flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 ${
                                    isRecording ? "cursor-not-allowed text-white/30" : ""
                                  }`}
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    className="h-5 w-5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    strokeLinecap="round"
                                  >
                                    <path d="M12 5v14M5 12h14" />
                                  </svg>
                                </button>
                                {!isRecording && composerMenuOpen && (
                                  <div
                                    onClick={(event) => event.stopPropagation()}
                                    className="absolute left-0 bottom-full z-30 mb-2 w-60 rounded-2xl border border-[#2a2a30] bg-[#101014] p-1.5 text-left text-xs shadow-2xl"
                                  >
                                    <div className="flex flex-col text-[13px] text-white/80">
                                      {isCodexMode ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setInput((prev) =>
                                                prev && prev.trim().length > 0
                                                  ? prev
                                                  : "Plan:"
                                              );
                                              setComposerMenuOpen(false);
                                              textareaRef.current?.focus();
                                            }}
                                            className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                          >
                                            Plan
                                          </button>
                                          <div className="my-1 h-px bg-white/10" />
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleAddFilesClick();
                                              setComposerMenuOpen(false);
                                            }}
                                            className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                          >
                                            Add photos &amp; files
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleTakePhotoClick();
                                              setComposerMenuOpen(false);
                                            }}
                                            className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                          >
                                            Take photo
                                          </button>
                                          <div className="my-1 h-px bg-white/10" />
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleAddFilesClick();
                                              setComposerMenuOpen(false);
                                            }}
                                            className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                          >
                                            Add photos &amp; files
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (hasComposerAttachments) {
                                                setComposerError(
                                                  "Image generation does not support attachments yet."
                                                );
                                              } else {
                                                setComposerError(null);
                                              }
                                              setCreateImageArmed(true);
                                              setForceWebSearch(false);
                                              setComposerMenuOpen(false);
                                            }}
                                            className="flex w-full items-center justify-between px-2.5 py-2 text-left transition hover:text-white"
                                          >
                                            <span>Create image</span>
                                            {createImageArmed && (
                                              <span className="text-[#8ab4ff]">Armed</span>
                                            )}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setComposerMenuOpen(false)}
                                            className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                          >
                                            Deep research
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setForceWebSearch((prev) => {
                                                const next = !prev;
                                                if (next) {
                                                  setCreateImageArmed(false);
                                                }
                                                return next;
                                              });
                                              setComposerMenuOpen(false);
                                            }}
                                            className="flex w-full items-center justify-between px-2.5 py-2 text-left transition hover:text-white"
                                          >
                                            <span>Web search</span>
                                            {forceWebSearch && (
                                              <span className="text-[#8ab4ff]">On</span>
                                            )}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setComposerMenuOpen(false)}
                                            className="flex w-full items-center px-2.5 py-2 text-left transition hover:text-white"
                                          >
                                            Agent mode
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-1 items-center self-stretch">
                                <textarea
                                  ref={textareaRef}
                                  className="block w-full resize-none border-none bg-transparent py-1.5 text-[15px] leading-[1.5] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-0"
                                  style={{
                                    maxHeight: MAX_INPUT_HEIGHT,
                                    minHeight: resolvedMinInputHeight,
                                  }}
                                  value={input}
                                  onChange={(e) => setInput(e.target.value)}
                                  onKeyDown={handleKeyDown}
                                  placeholder={composerPlaceholder}
                                  rows={1}
                                />
                                <input
                                  ref={photoInputRef}
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  className="sr-only"
                                  onChange={handlePhotoInputChange}
                                />
                                <input
                                  ref={filePickerInputRef}
                                  type="file"
                                  accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.tsv,.json,.md,.rtf,.html,.zip,.log"
                                  multiple
                                  className="sr-only"
                                  onChange={handleFilePickerChange}
                                />
                              </div>

                              <div className="flex items-center gap-2 self-end pl-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!micDisabled) {
                                      void startRecording();
                                    }
                                  }}
                                  disabled={micDisabled}
                                  aria-label="Start dictation"
                                  className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/80 transition ${
                                    micDisabled
                                      ? "cursor-not-allowed opacity-40"
                                      : "hover:bg-white/10"
                                  }`}
                                >
                                  <MicrophoneIcon className="h-4 w-4" />
                                </button>
                                {renderPrimaryButton()}
                              </div>
                            </>
                          )}
                        </div>
                        {isTranscribing && !isRecording && (
                          <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <span
                              className="h-2 w-2 animate-pulse rounded-full bg-white/60"
                              aria-hidden
                            />
                            <span>Transcribing…</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {composerError && (
                    <div className="text-xs text-red-400">{composerError}</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* PROJECT MODAL */}
      {allowProjectSections && showProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-[#3f3f46] bg-[#181818] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">New project</h2>
              <button
                onClick={() => setShowProjectModal(false)}
                className="text-lg text-zinc-400 hover:text-zinc-200"
              >
                ×
              </button>
            </div>

            <input
              className="w-full rounded-md border border-[#3f3f46] bg-[#303030] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowProjectModal(false)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#26272b]"
              >
                Cancel
              </button>

              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="rounded-md bg-[#1e4fd8] px-3 py-1.5 text-xs text-white hover:bg-[#2658e4] disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
      {confirmDialogs}
    </>
  );
}
