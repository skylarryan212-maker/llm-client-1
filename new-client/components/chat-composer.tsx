"use client";

import {
  useState,
  KeyboardEvent,
  FormEvent,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  ClipboardEvent,
  type CSSProperties,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, ArrowUp, ChevronDown, Bot, Search } from "lucide-react";
import { AttachmentMenuButton } from "@/components/chat/attachment-menu";
import { uploadFilesAndGetUrls } from "@/lib/uploads";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AgentPickerPanel } from "@/components/chat/agent-picker-panel";
import { getFeaturedAgentById } from "@/lib/agents/featuredAgents";

type UploadedFragment = {
  id: string;
  name: string;
  dataUrl?: string;
  url?: string;
  mime?: string;
  size?: number;
  file?: File;
};

type ChatComposerProps = {
  onSubmit?: (message: string, attachments?: UploadedFragment[], searchControls?: SearchControls) => void;
  onSendMessage?: (message: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  onCreateImage?: () => void;
  placeholder?: string;
  conversationId?: string | null;
  prefillValue?: string | null;
  onPrefillUsed?: () => void;
  selectedAgentId?: string | null;
  onAgentChange?: (agentId: string | null) => void;
  sendButtonClassName?: string;
  sendButtonStyle?: CSSProperties;
  disableAccentStyles?: boolean;
  showAttachmentButton?: boolean;
  shouldGrowDownward?: boolean;
  stackedActions?: boolean;
  searchControls?: SearchControls;
  onSearchControlsChange?: (next: SearchControls) => void;
};

const RESTORE_FOCUS_KEY = "llm-client:composer:restore-focus";

export type SearchControls = {
  sourceLimit: number | "auto";
  excerptMode: "snippets" | "balanced" | "rich" | "auto";
};

const SOURCE_OPTIONS: Array<{ value: SearchControls["sourceLimit"]; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Let the model decide" },
  { value: 5, label: "Lean (5)", description: "Faster, fewer sites" },
  { value: 10, label: "Standard (10)", description: "Balanced coverage" },
  { value: 20, label: "Deep (20)", description: "Broader sweep" },
];

const EXCERPT_OPTIONS: Array<{ value: SearchControls["excerptMode"]; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Let the model decide" },
  { value: "snippets", label: "Snippets", description: "Short pulls" },
  { value: "balanced", label: "Balanced", description: "Moderate excerpts" },
  { value: "rich", label: "Rich", description: "Longer excerpts" },
];

function readRestoreFocusFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(RESTORE_FOCUS_KEY) === "1";
  } catch {
    return false;
  }
}

export function ChatComposer({
  onSubmit,
  onSendMessage,
  isStreaming,
  onStop,
  onCreateImage,
  placeholder,
  conversationId,
  prefillValue,
  onPrefillUsed,
  selectedAgentId: selectedAgentIdProp,
  onAgentChange,
  sendButtonClassName,
  sendButtonStyle,
  disableAccentStyles = false,
  showAttachmentButton = true,
  shouldGrowDownward = false,
  stackedActions = false,
  searchControls,
  onSearchControlsChange,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchMenuOpen, setIsSearchMenuOpen] = useState(false);
  const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreFocusOnMountRef = useRef(readRestoreFocusFlag());
  const [attachments, setAttachments] = useState<UploadedFragment[]>([]);
  const [selectedAgentByConversation, setSelectedAgentByConversation] = useState<Record<string, string | null>>({});
  const trimmedValue = value.trim();
  const defaultSearchControls: SearchControls = { sourceLimit: "auto", excerptMode: "auto" };
  const [localSearchControls, setLocalSearchControls] = useState<SearchControls>(searchControls ?? defaultSearchControls);
  const effectiveSearchControls = searchControls ?? localSearchControls;

  useEffect(() => {
    if (searchControls) {
      setLocalSearchControls(searchControls);
    }
  }, [searchControls]);

  const NEW_CONVERSATION_KEY = "__new__";
  const conversationKey = conversationId ?? NEW_CONVERSATION_KEY;
  const isAgentControlled = typeof selectedAgentIdProp !== "undefined";
  const selectedAgentId = isAgentControlled
    ? selectedAgentIdProp ?? null
    : selectedAgentByConversation[conversationKey] ?? null;
  const selectedAgent = getFeaturedAgentById(selectedAgentId);
  const selectedAgentName = selectedAgent?.name ?? selectedAgentId ?? "";
  const SelectedAgentIcon = selectedAgent?.icon ?? Bot;
  const shouldShowAgentPill = Boolean(selectedAgentId);
  const [agentPillHighlight, setAgentPillHighlight] = useState(false);

  useEffect(() => {
    if (!selectedAgentId) return;
    setAgentPillHighlight(true);
    const timer = setTimeout(() => setAgentPillHighlight(false), 720);
    return () => clearTimeout(timer);
  }, [selectedAgentId]);

  const previousConversationKeyRef = useRef(conversationKey);
  useEffect(() => {
    if (isAgentControlled) return;
    const prevKey = previousConversationKeyRef.current;
    if (prevKey === conversationKey) return;
    previousConversationKeyRef.current = conversationKey;

    // If a new conversation was just created, carry over any selection made before the ID existed.
    if (conversationId && prevKey === NEW_CONVERSATION_KEY) {
      setSelectedAgentByConversation((prev) => {
        const pending = prev[NEW_CONVERSATION_KEY] ?? null;
        if (!pending) return prev;
        if (prev[conversationId]) {
          return { ...prev, [NEW_CONVERSATION_KEY]: null };
        }
        const { [NEW_CONVERSATION_KEY]: removed, ...rest } = prev;
        void removed;
        return { ...rest, [conversationId]: pending };
      });
    }
  }, [conversationId, conversationKey, isAgentControlled]);

  const setSelectedAgentIdForConversation = useCallback(
    (next: string | null) => {
      if (!isAgentControlled) {
        setSelectedAgentByConversation((prev) => ({ ...prev, [conversationKey]: next }));
      }
      onAgentChange?.(next);
    },
    [conversationKey, isAgentControlled, onAgentChange]
  );

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [waveformLevels, setWaveformLevels] = useState<number[]>(Array(120).fill(0));
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  
  // Voice recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
	  const audioContextRef = useRef<AudioContext | null>(null);
	  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	  const analyserRef = useRef<AnalyserNode | null>(null);
	  const waveformDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
	  const waveformAnimationRef = useRef<number | null>(null);

  // Build waveform SVG path (fluid wave style)
  const buildWaveformPath = useCallback((levels: number[], width = 200, height = 40) => {
    if (!levels.length) {
      return `M0 ${height / 2} L${width} ${height / 2}`;
    }
    const centerY = height / 2;
    const barWidth = width / levels.length;
    const bars: string[] = [];
    
    levels.forEach((level, index) => {
      const intensity = Math.max(0.05, Math.min(1, level));
      // Add randomness for organic feel
      const randomMultiplier = 0.6 + Math.random() * 0.8;
      // Calculate bar height (extends both up and down from center) - increased max height
      const barHeight = intensity * randomMultiplier * (centerY - 1);
      const x = index * barWidth + barWidth / 2;
      const topY = centerY - barHeight;
      const bottomY = centerY + barHeight;
      
      // Create sharp vertical bar from top to bottom through center
      bars.push(`M${x.toFixed(2)} ${topY.toFixed(2)} L${x.toFixed(2)} ${bottomY.toFixed(2)}`);
    });
    
    return bars.join(' ');
  }, []);

  const recordingWaveformPath = buildWaveformPath(waveformLevels, 200, 40);
  const micDisabled = isRecording || isTranscribing || isStreaming;

  // Cleanup waveform visualizer
  const cleanupWaveformVisualizer = useCallback(() => {
    if (waveformAnimationRef.current) {
      cancelAnimationFrame(waveformAnimationRef.current);
      waveformAnimationRef.current = null;
    }
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => null);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    waveformDataRef.current = null;
    setWaveformLevels(Array(120).fill(0));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupWaveformVisualizer();
    };
  }, [cleanupWaveformVisualizer]);

  // If we were focused when a new chat URL navigation happened, restore focus before paint.
  useLayoutEffect(() => {
    if (!restoreFocusOnMountRef.current) return;
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(RESTORE_FOCUS_KEY);
    } catch {
      // Ignore storage failures
    }
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const markRestoreFocus = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      if (document.activeElement === textareaRef.current) {
        window.sessionStorage.setItem(RESTORE_FOCUS_KEY, "1");
      }
    } catch {
      // Ignore storage failures
    }
  }, []);

  // Start waveform visualizer
  const startWaveformVisualizer = useCallback(
    (stream: MediaStream) => {
      if (typeof window === "undefined") return;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      try {
        cleanupWaveformVisualizer();
        const audioContext = new AudioCtx();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        const buffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

        audioContextRef.current = audioContext;
        audioSourceRef.current = source;
        analyserRef.current = analyser;
        waveformDataRef.current = buffer;

	        const tick = () => {
	          if (!analyserRef.current || !waveformDataRef.current) return;
	          analyserRef.current.getByteTimeDomainData(waveformDataRef.current);
	          const data = waveformDataRef.current;
	          let sum = 0;
	          for (let i = 0; i < data.length; i++) {
	            sum += Math.abs(data[i] - 128);
	          }
	          const normalized = Math.min(1, sum / data.length / 64);
	          // Update all bars randomly instead of flowing
	          setWaveformLevels((prev) => {
	            return prev.map(() => normalized * (0.3 + Math.random() * 0.7));
	          });
	          waveformAnimationRef.current = requestAnimationFrame(tick);
	        };
        waveformAnimationRef.current = requestAnimationFrame(tick);
        if (audioContext.resume) {
          audioContext.resume().catch(() => null);
        }
      } catch (error) {
        console.warn("Unable to initialize waveform visualization", error);
      }
    },
    [cleanupWaveformVisualizer]
  );

  // Stop recording and return blob
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

  // Transcribe audio
	  const transcribeAudio = useCallback(async (blob: Blob) => {
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
	      const payload = (await response.json()) as { transcript?: string; noSpeech?: boolean };
	      const transcript = (payload.transcript || "").trim();
	      if (payload.noSpeech) {
	        setRecordingError("No speech detected in the recording.");
	        return;
	      }
	      if (transcript) {
	        setValue((prev) => {
	          if (!prev) return transcript;
	          return `${prev.trimEnd()} ${transcript}`.trim();
	        });
        setRecordingError(null);
      } else {
        setRecordingError("No speech detected in the recording.");
      }
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") {
        return;
      }
      console.error("transcribeAudio error", error);
      setRecordingError("Unable to transcribe audio.");
    } finally {
      transcriptionAbortRef.current = null;
    }
  }, []);

  // Start recording
	  const startRecording = useCallback(async () => {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setRecordingError("Voice input isn't supported in this browser.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("Microphone access is unavailable.");
      return;
    }
	    try {
	      setRecordingError(null);
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
      setIsMenuOpen(false); // Close attachment menu when recording starts
    } catch (error) {
      console.error("startRecording error", error);
      const err = error as DOMException;
      if (err.name === "NotAllowedError") {
        setRecordingError(
          "Microphone access denied. Click the microphone icon in your browser's address bar to allow access."
        );
      } else if (err.name === "NotFoundError") {
        setRecordingError("No microphone found. Please connect a microphone and try again.");
      } else {
        setRecordingError("Unable to access microphone. Please check your browser settings.");
      }
    }
  }, [startWaveformVisualizer]);

  // Finish recording and transcribe
	  const finishRecordingAndTranscribe = useCallback(async () => {
	    if (!isRecording) return;
	    setIsRecording(false);
	    setIsTranscribing(true);
	    try {
	      const blob = await stopRecording(true);
	      if (blob) {
	        await transcribeAudio(blob);
	      } else {
	        setRecordingError("Recording was too short.");
	      }
	    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") {
        setRecordingError("Unable to capture audio.");
      }
    } finally {
      setIsTranscribing(false);
    }
  }, [isRecording, stopRecording, transcribeAudio]);

  // Cancel recording
  const cancelRecording = useCallback(() => {
    if (isRecording) {
      stopRecording(false);
      setIsRecording(false);
    }
    if (isTranscribing) {
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      setIsTranscribing(false);
    }
    setRecordingError(null);
  }, [isRecording, isTranscribing, stopRecording]);

  const uploadPendingAttachments = useCallback(async () => {
    if (!attachments.length) return attachments;

    const pending = attachments.filter((a) => !a.url && a.file);
    if (!pending.length) return attachments;

    try {
      setIsUploading(true);
      const uploaded = await uploadFilesAndGetUrls(pending.map((a) => a.file!));

      let uploadIndex = 0;
      const merged = attachments.map((att) => {
        if (!att.url && att.file) {
          const uploadedInfo = uploaded[uploadIndex++];
          if (uploadedInfo) {
            return {
              ...att,
              url: uploadedInfo.url,
              mime: uploadedInfo.mime ?? att.mime,
            };
          }
        }
        return att;
      });
      setAttachments(merged);
      setAttachmentError(null);
      return merged;
    } catch (error) {
      console.error("Attachment upload failed", error);
      setAttachmentError("File upload failed. Please retry.");
      return attachments;
    } finally {
      setIsUploading(false);
    }
  }, [attachments]);

  const effectiveSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isUploading) return;

    const attachmentsWithUrls = await uploadPendingAttachments();
    const pendingWithoutUrl =
      attachmentsWithUrls?.filter((att) => att.file && !att.url) ?? [];

    if (pendingWithoutUrl.length) {
      setAttachmentError("Please wait for uploads to finish, then try again.");
      return;
    }

    const attachmentsToSend = attachmentsWithUrls
      ?.filter((att) => att.url)
      .map((att) => ({
        id: att.id,
        name: att.name,
        url: att.url,
        mime: att.mime,
        size: att.size,
      }));
    setAttachmentError(null);

    if (onSubmit) onSubmit(trimmed, attachmentsToSend, effectiveSearchControls);
    else if (onSendMessage) onSendMessage(trimmed);
    setValue("");
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      markRestoreFocus();
      e.preventDefault();
      void effectiveSubmit(value);
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    markRestoreFocus();
    void effectiveSubmit(value);
  };

  const handleOpenFilePicker = () => {
    // Close the menu and open the native file picker
    setIsMenuOpen(false);
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (files: FileList | File[] | null) => {
    const fileArray = Array.isArray(files) ? files : Array.from(files ?? []);
    if (fileArray.length === 0) return;
    try {
      // Convert files to base64 data URLs (like legacy client)
      const fileReads = fileArray.map((file) => {
        return new Promise<UploadedFragment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name,
              dataUrl: reader.result as string,
              mime: file.type || undefined,
              size: file.size,
              file,
            });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      });

      const newItems = await Promise.all(fileReads);
      setAttachments((prev) => [...prev, ...newItems]);
      
      // Reset the file input to allow re-selecting the same file later
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      console.error("File read error:", err);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (!files.length) return;

    e.preventDefault();
    setAttachmentError(null);
    void handleFilesSelected(files);
  };

  const applySearchControls = (next: SearchControls) => {
    setLocalSearchControls(next);
    onSearchControlsChange?.(next);
    setIsSearchMenuOpen(false);
  };

  useEffect(() => {
    if (typeof prefillValue !== "string" || prefillValue.length === 0) return;
    setValue(prefillValue);
    // Focus composer to make follow-ups fast
    textareaRef.current?.focus();
    onPrefillUsed?.();
  }, [prefillValue, onPrefillUsed]);

  return (
    <form onSubmit={handleFormSubmit}>
      {/* Selected agent pill (UI-only) */}
      {shouldShowAgentPill ? (
        <div className="mb-2 flex pl-2">
          <DropdownMenu open={isAgentPickerOpen} onOpenChange={setIsAgentPickerOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`inline-flex max-w-full items-center gap-2 rounded-2xl border bg-card/85 px-3 py-2 text-xs font-medium text-foreground shadow-sm transition hover:bg-card/95 hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  agentPillHighlight ? "border-primary/60 ring-2 ring-primary/45 shadow-md shadow-primary/20" : "border-border"
                }`}
                aria-label="Change selected agent"
                title="Click to change agent"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                  {SelectedAgentIcon ? <SelectedAgentIcon className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="truncate">Agent: {selectedAgentName}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={10}
              className="rounded-xl border border-border bg-popover p-0 shadow-lg"
            >
              <AgentPickerPanel
                selectedAgentId={selectedAgentId}
                onSelectAgentId={(id) => setSelectedAgentIdForConversation(id)}
                onClearAgentId={() => setSelectedAgentIdForConversation(null)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {/* Attachments preview list (above composer) */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="group flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2">
              <div className="h-8 w-8 overflow-hidden rounded-lg bg-background/40 flex items-center justify-center">
                {a.mime?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.dataUrl} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                    <path d="M14 3v6h6" />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{a.name}</div>
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}>
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
      <div
        className={`composer-shell relative z-10 ${stackedActions ? "flex flex-col items-stretch min-h-[112px] space-y-2 py-3" : `flex ${shouldGrowDownward ? "items-start" : "items-end"} gap-1.5 sm:gap-2 py-2 sm:py-2.5`} rounded-3xl border border-border bg-card px-2 sm:px-3 lg:px-4 transition-all focus-within:border-ring`}
      >
        {isRecording ? (
          <div className="flex items-center gap-2 flex-1 w-full">
            <button
              type="button"
              aria-label="Cancel voice recording"
              onClick={cancelRecording}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 border-2 border-red-500/20 text-red-500 transition hover:bg-red-500/30 hover:border-red-500/30"
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
            <div className="flex flex-1 items-center justify-center" aria-live="polite">
              <svg viewBox="0 0 200 40" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
                <path
                  d={recordingWaveformPath}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  className="text-primary"
                />
              </svg>
            </div>
            <button
              type="button"
              onClick={finishRecordingAndTranscribe}
              className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
              aria-label="Finish recording"
              style={sendButtonStyle}
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
                <path d="M5 12l5 5L20 7" />
              </svg>
            </button>
          </div>
        ) : stackedActions ? (
          <>
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              title="Tip: paste images/files to attach"
              placeholder={isTranscribing ? "Transcribing..." : placeholder ?? "Ask Quarry..."}
              rows={1}
              disabled={isRecording || isTranscribing}
              className="min-h-[40px] max-h-[200px] border-0 bg-transparent dark:bg-transparent px-0 py-2 text-base leading-5 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none rounded-none"
            />
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {showAttachmentButton ? (
                  <AttachmentMenuButton
                    open={isMenuOpen}
                    onOpenChange={setIsMenuOpen}
                    onPickFiles={handleOpenFilePicker}
                    onCreateImage={onCreateImage}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={(id) => {
                      setSelectedAgentIdForConversation(id);
                      setIsAgentPickerOpen(false);
                      setIsMenuOpen(false);
                    }}
                    onClearAgent={() => {
                      setSelectedAgentIdForConversation(null);
                      setIsAgentPickerOpen(false);
                      setIsMenuOpen(false);
                    }}
                  />
                ) : null}
                <DropdownMenu open={isSearchMenuOpen} onOpenChange={setIsSearchMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Search options"
                      className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-accent"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="bottom"
                    sideOffset={8}
                    className="w-72 rounded-xl border border-border bg-popover p-3 shadow-xl"
                  >
                    <div className="space-y-2">
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground">Sources to search</div>
                        <div className="mt-2 grid gap-1">
                          {SOURCE_OPTIONS.map((option) => {
                            const isActive = effectiveSearchControls.sourceLimit === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() =>
                                  applySearchControls({ ...effectiveSearchControls, sourceLimit: option.value })
                                }
                                className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                                  isActive
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border hover:bg-muted/70"
                                }`}
                              >
                                <span className="flex flex-col">
                                  <span className="font-medium">{option.label}</span>
                                  <span className="text-xs text-muted-foreground">{option.description}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">→</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="pt-2">
                        <div className="text-xs font-semibold text-muted-foreground">Depth per source</div>
                        <div className="mt-2 grid gap-1">
                          {EXCERPT_OPTIONS.map((option) => {
                            const isActive = effectiveSearchControls.excerptMode === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() =>
                                  applySearchControls({ ...effectiveSearchControls, excerptMode: option.value })
                                }
                                className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                                  isActive
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border hover:bg-muted/70"
                                }`}
                              >
                                <span className="flex flex-col">
                                  <span className="font-medium">{option.label}</span>
                                  <span className="text-xs text-muted-foreground">{option.description}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">→</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={micDisabled || isUploading}
                  aria-label="Start dictation"
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition ${micDisabled ? "cursor-not-allowed opacity-40" : "hover:bg-accent"}`}
                >
                  <Mic className="h-4 w-4" />
                </button>
                {!isStreaming ? (
                  isTranscribing ? (
                    <button
                      type="button"
                      disabled
                      className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
                      aria-label="Transcribing"
                      style={sendButtonStyle}
                    >
                      <span className="inline-flex h-5 w-5 items-center justify-center">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      </span>
                    </button>
                  ) : trimmedValue ? (
                    <button
                      type="submit"
                      onMouseDown={markRestoreFocus}
                      disabled={isUploading}
                      className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition disabled:opacity-50${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
                      aria-label="Send message"
                      style={sendButtonStyle}
                    >
                      {isUploading ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        </span>
                      ) : (
                        <ArrowUp className="h-5 w-5" />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {}}
                      className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
                      aria-label="Voice input unavailable"
                      style={sendButtonStyle}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 66 56"
                        className="h-5 w-5"
                        fill="currentColor"
                      >
                        <rect x="0" y="15" width="12" height="30" rx="3" />
                        <rect x="18" y="0" width="12" height="70" rx="3" />
                        <rect x="36" y="6" width="12" height="50" rx="3" />
                        <rect x="55" y="15" width="12" height="30" rx="3" />
                      </svg>
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={onStop}
                    className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
                    aria-label="Stop generating"
                    style={sendButtonStyle}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-6 w-6"
                      fill="currentColor"
                    >
                      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Left action buttons (plus + search controls) */}
            <div className="flex items-center gap-1">
              {showAttachmentButton ? (
                <div className="flex items-center">
                  <AttachmentMenuButton
                    open={isMenuOpen}
                    onOpenChange={setIsMenuOpen}
                    onPickFiles={handleOpenFilePicker}
                    onCreateImage={onCreateImage}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={(id) => {
                      setSelectedAgentIdForConversation(id);
                      setIsAgentPickerOpen(false);
                      setIsMenuOpen(false);
                    }}
                    onClearAgent={() => {
                      setSelectedAgentIdForConversation(null);
                      setIsAgentPickerOpen(false);
                      setIsMenuOpen(false);
                    }}
                  />
                </div>
              ) : null}
              <DropdownMenu open={isSearchMenuOpen} onOpenChange={setIsSearchMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Search options"
                    className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-accent"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="bottom"
                  sideOffset={8}
                  className="w-72 rounded-xl border border-border bg-popover p-3 shadow-xl"
                >
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground">Sources to search</div>
                      <div className="mt-2 grid gap-1">
                        {SOURCE_OPTIONS.map((option) => {
                          const isActive = effectiveSearchControls.sourceLimit === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() =>
                                applySearchControls({ ...effectiveSearchControls, sourceLimit: option.value })
                              }
                              className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                                isActive
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border hover:bg-muted/70"
                              }`}
                            >
                              <span className="flex flex-col">
                                <span className="font-medium">{option.label}</span>
                                <span className="text-xs text-muted-foreground">{option.description}</span>
                              </span>
                              <span className="text-xs text-muted-foreground">→</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-2">
                      <div className="text-xs font-semibold text-muted-foreground">Depth per source</div>
                      <div className="mt-2 grid gap-1">
                        {EXCERPT_OPTIONS.map((option) => {
                          const isActive = effectiveSearchControls.excerptMode === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() =>
                                applySearchControls({ ...effectiveSearchControls, excerptMode: option.value })
                              }
                              className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                                isActive
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border hover:bg-muted/70"
                              }`}
                            >
                              <span className="flex flex-col">
                                <span className="font-medium">{option.label}</span>
                                <span className="text-xs text-muted-foreground">{option.description}</span>
                              </span>
                              <span className="text-xs text-muted-foreground">→</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Textarea */}
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              title="Tip: paste images/files to attach"
              placeholder={isTranscribing ? "Transcribing..." : placeholder ?? "Ask Quarry..."}
              rows={1}
              disabled={isRecording || isTranscribing}
              className="flex-1 min-h-[40px] max-h-[200px] border-0 bg-transparent dark:bg-transparent px-0 py-2.5 text-base leading-5 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none rounded-none"
            />

            {/* Right actions: mic + send OR transcribing OR stop if streaming */}
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={startRecording}
                disabled={micDisabled || isUploading}
                aria-label="Start dictation"
                className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                  micDisabled
                    ? "cursor-not-allowed opacity-40"
                    : "hover:bg-accent"
                }`}
              >
                <Mic className="h-4 w-4" />
              </button>
              {!isStreaming ? (
                isTranscribing ? (
                  <button
                    type="button"
                    disabled
                    className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
                    aria-label="Transcribing"
                    style={sendButtonStyle}
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    </span>
                  </button>
                ) : trimmedValue ? (
                        <button
                          type="submit"
                          onMouseDown={markRestoreFocus}
                          disabled={isUploading}
                          className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition disabled:opacity-50${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
                          aria-label="Send message"
                          style={sendButtonStyle}
                        >
                    {isUploading ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      </span>
                    ) : (
                      <ArrowUp className="h-5 w-5" />
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {}}
                    className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
                    aria-label="Voice input unavailable"
                    style={sendButtonStyle}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 66 56"
                      className="h-5 w-5"
                      fill="currentColor"
                    >
                      <rect x="0" y="15" width="12" height="30" rx="3" />
                      <rect x="18" y="0" width="12" height="70" rx="3" />
                      <rect x="36" y="6" width="12" height="50" rx="3" />
                      <rect x="55" y="15" width="12" height="30" rx="3" />
                    </svg>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={onStop}
                  className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition${disableAccentStyles ? ` ${sendButtonClassName ?? ""}` : ` accent-send-button ${sendButtonClassName ?? ""}`}`}
                  aria-label="Stop generating"
                  style={sendButtonStyle}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-6 w-6"
                    fill="currentColor"
                  >
                    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Recording/transcription error display */}
      {recordingError && (
        <div className="mt-2 text-xs text-red-400">{recordingError}</div>
      )}
      {attachmentError && !recordingError && (
        <div className="mt-2 text-xs text-red-400">{attachmentError}</div>
      )}
      
      {/* Hidden file input for attachments */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf,application/*,text/*"
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />
    </form>
  );
}
