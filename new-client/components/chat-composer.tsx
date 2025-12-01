"use client";

import { useState, KeyboardEvent, FormEvent, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, ArrowUp, Square } from "lucide-react";
import { AttachmentMenuButton } from "@/components/chat/attachment-menu";

type UploadedFragment = {
  id: string;
  name: string;
  dataUrl: string;
  mime?: string;
  size?: number;
};

type ChatComposerProps = {
  onSubmit?: (message: string, attachments?: UploadedFragment[]) => void;
  onSendMessage?: (message: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  onRegenerate?: () => void;
  placeholder?: string;
};

export function ChatComposer({
  onSubmit,
  onSendMessage,
  isStreaming,
  onStop,
  onRegenerate,
  placeholder,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<UploadedFragment[]>([]);
  const trimmedValue = value.trim();

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [waveformLevels, setWaveformLevels] = useState<number[]>(Array(120).fill(0));
  
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
      const payload = (await response.json()) as { transcript?: string };
      const transcript = (payload.transcript || "").trim();
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

  const effectiveSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (onSubmit) onSubmit(trimmed, attachments);
    else if (onSendMessage) onSendMessage(trimmed);
    setValue("");
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      effectiveSubmit(value);
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    effectiveSubmit(value);
  };

  const handleOpenFilePicker = () => {
    // Close the menu and open the native file picker
    setIsMenuOpen(false);
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      // Convert files to base64 data URLs (like legacy client)
      const fileReads = Array.from(files).map(file => {
        return new Promise<UploadedFragment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name,
              dataUrl: reader.result as string,
              mime: file.type || undefined,
              size: file.size,
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

  return (
    <form onSubmit={handleFormSubmit}>
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
      <div className="relative flex items-center gap-1.5 sm:gap-2 rounded-3xl border border-border bg-muted/30 px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5 transition-all focus-within:border-ring focus-within:bg-background">
        {isRecording ? (
          <div className="flex items-center gap-2">
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
              className="accent-send-button flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition"
              aria-label="Finish recording"
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
        ) : (
          <>
            {/* Left action button (plus) */}
            <div className="flex items-center">
              <AttachmentMenuButton
                open={isMenuOpen}
                onOpenChange={setIsMenuOpen}
                onPickFiles={handleOpenFilePicker}
              />
            </div>

            {/* Textarea */}
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isTranscribing ? "Transcribing…" : placeholder ?? "Message LLM Client..."}
              rows={1}
              disabled={isRecording || isTranscribing}
              className="flex-1 min-h-[36px] max-h-[200px] border-0 bg-transparent dark:bg-transparent px-0 py-2 text-sm leading-5 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none rounded-none"
            />

            {/* Right actions: mic + send OR transcribing OR stop if streaming */}
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={startRecording}
                disabled={micDisabled}
                aria-label="Start dictation"
                className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
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
                    className="accent-send-button flex h-10 w-10 items-center justify-center rounded-full shadow-lg"
                    aria-label="Transcribing"
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    </span>
                  </button>
                ) : trimmedValue ? (
                  <button
                    type="submit"
                    className="accent-send-button flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition"
                    aria-label="Send message"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {}}
                    className="accent-send-button flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition"
                    aria-label="Voice input unavailable"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 66 56"
                      className="h-5 w-5"
                      fill="currentColor"
                    >
                      <rect x="0" y="15" width="12" height="30" rx="" />
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
                  className="accent-send-button flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition"
                  aria-label="Stop generating"
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
