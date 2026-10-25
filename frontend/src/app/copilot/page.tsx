"use client";

import { useState, useEffect, useRef, useCallback, Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { 
  BotMessageSquare, 
  Send, 
  Loader2, 
  User, 
  Sparkles, 
  Clock, 
  AlertCircle,
  HelpCircle,
  Mic,
  Square,
  Volume2,
  VolumeX,
  X,
  Volume1,
  FileText,
  Play,
  Pause,
  PhoneOff,
  Radio,
  CheckCircle2
} from "lucide-react";
import { 
  askCopilot, 
  voiceChatCopilot, 
  getMeetings, 
  MeetingSummary, 
  ReferenceItem, 
  formatTimestamp,
  ConversationMode,
  ChatHistoryItem
} from "@/lib/api";

interface ChatMessage {
  id: string;
  sender: "user" | "copilot";
  text: string;
  isVoice?: boolean;
  mode?: ConversationMode;
  references?: ReferenceItem[];
}

type PushToTalkState = "idle" | "requesting" | "recording" | "processing";
type ContinuousVoiceState = "idle" | "listening" | "thinking" | "speaking" | "paused";

/**
 * Safe message ID generator declared outside component render scope
 */
let messageIdCounter = 0;
function createChatMessageId(prefix: "user" | "copilot"): string {
  messageIdCounter += 1;
  return `${prefix}-${Date.now()}-${messageIdCounter}`;
}

/**
 * Safe timestamp reader declared outside component render scope
 */
function getTimestampNow(): number {
  return Date.now();
}

/**
 * External store subscription and snapshots for SpeechSynthesis support
 */
function subscribeSpeech() {
  return () => {};
}
function getSpeechSnapshot(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
function getSpeechServerSnapshot(): boolean {
  return false;
}

/**
 * External store subscription and snapshots for browser voices
 */
let cachedVoices: SpeechSynthesisVoice[] = [];
let hasAttemptedInitialFetch = false;
function subscribeVoices(callback: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return () => {};
  }
  const handler = () => {
    cachedVoices = window.speechSynthesis.getVoices();
    callback();
  };
  window.speechSynthesis.addEventListener("voiceschanged", handler);
  return () => {
    window.speechSynthesis.removeEventListener("voiceschanged", handler);
  };
}
function getVoicesSnapshot(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return cachedVoices;
  }
  if (!hasAttemptedInitialFetch) {
    hasAttemptedInitialFetch = true;
    const initial = window.speechSynthesis.getVoices();
    if (initial.length > 0) {
      cachedVoices = initial;
    }
  }
  return cachedVoices;
}
function getVoicesServerSnapshot(): SpeechSynthesisVoice[] {
  return cachedVoices;
}

/**
 * Strips markdown symbols, citation brackets, and URLs so browser TTS
 * sounds natural, fluent, and conversational.
 */
function cleanTextForSpeech(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[[^\]]*?\|\s*Time:[^\]]*?\]/gi, "")
    .replace(/\([^)]*?\|\s*Time:[^)]*?\)/gi, "")
    .replace(/[#*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Selects an optimal English voice from available browser voices,
 * prioritizing natural/online voices, then standard en-US/en-GB,
 * with graceful fallbacks.
 */
function selectBestVoice(availableVoices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  if (!availableVoices || availableVoices.length === 0) return undefined;

  // 1. Natural / Google / Neural / Online English voices
  const naturalEn = availableVoices.find(
    (v) =>
      v.lang.toLowerCase().startsWith("en") &&
      (v.name.includes("Natural") ||
       v.name.includes("Online") ||
       v.name.includes("Google") ||
       v.name.includes("Neural"))
  );
  if (naturalEn) return naturalEn;

  // 2. Standard en-US or en-GB voices
  const standardEn = availableVoices.find(
    (v) => {
      const l = v.lang.toLowerCase().replace("_", "-");
      return l === "en-us" || l === "en-gb";
    }
  );
  if (standardEn) return standardEn;

  // 3. Any English voice
  const anyEn = availableVoices.find((v) => v.lang.toLowerCase().startsWith("en"));
  if (anyEn) return anyEn;

  // 4. Default voice
  const defaultVoice = availableVoices.find((v) => v.default);
  if (defaultVoice) return defaultVoice;

  // 5. Fallback to first available voice
  return availableVoices[0];
}

function CopilotChatInner() {
  const searchParams = useSearchParams();
  const initialMeetingId = searchParams.get("meeting_id") || "";

  // Mode selection: General Conversation is default for casual voice chat
  const [mode, setMode] = useState<ConversationMode>(initialMeetingId ? "meeting" : "general");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>(initialMeetingId);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Push-to-Talk Voice state (one-off recording)
  const [pushVoiceState, setPushVoiceState] = useState<PushToTalkState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Continuous Hands-Free Voice Session State
  const [continuousActive, setContinuousActive] = useState(false);
  const [continuousState, setContinuousState] = useState<ContinuousVoiceState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);

  // Speech synthesis (TTS) state
  const speechSupported = useSyncExternalStore(subscribeSpeech, getSpeechSnapshot, getSpeechServerSnapshot);
  const voices = useSyncExternalStore(subscribeVoices, getVoicesSnapshot, getVoicesServerSnapshot);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [activeSpeakingId, setActiveSpeakingId] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  // Refs for audio hardware and callbacks
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechKeepAliveRef = useRef<NodeJS.Timeout | null>(null);

  // Web Audio API refs for VAD (Voice Activity Detection)
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);

  // Sync state refs for event listeners and timeouts
  const modeRef = useRef(mode);
  const continuousActiveRef = useRef(continuousActive);
  const continuousStateRef = useRef(continuousState);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const autoSpeakRef = useRef(autoSpeak);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    modeRef.current = mode;
    continuousActiveRef.current = continuousActive;
    continuousStateRef.current = continuousState;
    voicesRef.current = voices;
    autoSpeakRef.current = autoSpeak;
    messagesRef.current = messages;
  }, [mode, continuousActive, continuousState, voices, autoSpeak, messages]);

  // Build clean conversation history for Ollama context memory
  const getRecentHistoryPayload = useCallback((): ChatHistoryItem[] => {
    return messagesRef.current.slice(-8).map((m) => ({
      role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    }));
  }, []);

  // --- Audio Cleanup Utilities ---
  const stopAudioAnalyser = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== "closed") {
          audioContextRef.current.close();
        }
      } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch (e) {
        console.warn("[SpeechSynthesis] Notice while cancelling speech:", e);
      }
    }
    if (speechKeepAliveRef.current) {
      clearInterval(speechKeepAliveRef.current);
      speechKeepAliveRef.current = null;
    }
    currentUtteranceRef.current = null;
    setActiveSpeakingId(null);
  }, []);

  const cleanupAllAudioResources = useCallback(() => {
    stopSpeaking();
    stopAudioAnalyser();

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    audioChunksRef.current = [];
  }, [stopSpeaking, stopAudioAnalyser]);

  // Initialize meetings & configure voice synthesis cleanup
  useEffect(() => {
    let ignore = false;
    getMeetings()
      .then((data) => {
        if (!ignore) {
          setMeetings(data);
        }
      })
      .catch(() => {});

    return () => {
      ignore = true;
      cleanupAllAudioResources();
    };
  }, [cleanupAllAudioResources]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, pushVoiceState, continuousState]);

  /**
   * Speaks given text using browser SpeechSynthesis API with strong GC reference,
   * keepalive timer, and optional completion callback for continuous conversation.
   */
  const speakMessage = (
    messageId: string,
    text: string,
    onPlaybackFinished?: () => void
  ) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setTtsError("Speech synthesis is not supported by your browser.");
      onPlaybackFinished?.();
      return;
    }

    if (activeSpeakingId === messageId) {
      stopSpeaking();
      return;
    }

    stopSpeaking();
    setTtsError(null);

    const cleaned = cleanTextForSpeech(text);
    if (!cleaned) {
      setTtsError("No speakable text found in this message.");
      onPlaybackFinished?.();
      return;
    }

    let availableVoices = voicesRef.current;
    if (availableVoices.length === 0 && typeof window !== "undefined" && "speechSynthesis" in window) {
      availableVoices = window.speechSynthesis.getVoices();
    }

    const chosenVoice = selectBestVoice(availableVoices);

    try {
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = 1.05; // Slightly brisk, natural cadence
      utterance.pitch = 1.0;

      if (chosenVoice) {
        utterance.voice = chosenVoice;
        utterance.lang = chosenVoice.lang || "en-US";
      } else {
        utterance.lang = "en-US";
      }

      currentUtteranceRef.current = utterance;

      utterance.onstart = () => {
        setActiveSpeakingId(messageId);
        setTtsError(null);
      };

      utterance.onend = () => {
        setActiveSpeakingId(null);
        currentUtteranceRef.current = null;
        if (speechKeepAliveRef.current) {
          clearInterval(speechKeepAliveRef.current);
          speechKeepAliveRef.current = null;
        }
        onPlaybackFinished?.();
      };

      utterance.onerror = (event) => {
        setActiveSpeakingId(null);
        currentUtteranceRef.current = null;
        if (speechKeepAliveRef.current) {
          clearInterval(speechKeepAliveRef.current);
          speechKeepAliveRef.current = null;
        }

        if (event.error !== "canceled" && event.error !== "interrupted") {
          setTtsError(`Audio playback error (${event.error || "playback failed"}).`);
        }
        onPlaybackFinished?.();
      };

      setTimeout(() => {
        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
          window.speechSynthesis.speak(utterance);
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setTtsError(`Failed to start speech playback: ${msg}`);
          setActiveSpeakingId(null);
          currentUtteranceRef.current = null;
          onPlaybackFinished?.();
        }
      }, 40);

      speechKeepAliveRef.current = setInterval(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }, 12000);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTtsError(`Speech synthesis initialization failed: ${msg}`);
      setActiveSpeakingId(null);
      currentUtteranceRef.current = null;
      onPlaybackFinished?.();
    }
  };

  const handleTestVoice = () => {
    setTtsError(null);
    speakMessage(
      "test-voice-button",
      mode === "general"
        ? "Hello! I am your AI personal voice assistant. I can hear you loud and clear!"
        : "Hello! I am your AI Meeting Copilot. Ready to answer questions about your meetings."
    );
  };

  // --- Text Chat Submission ---
  const handleSend = async (queryText?: string) => {
    const q = (queryText || inputQuery).trim();
    if (!q || loading || pushVoiceState === "recording" || pushVoiceState === "processing") return;

    // If continuous session is currently active, pause or exit it to avoid conflict
    if (continuousActive) {
      pauseContinuousSession();
    }

    stopSpeaking();
    setError(null);
    setTtsError(null);

    const userMsgId = createChatMessageId("user");
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: "user",
      text: q,
      isVoice: false,
      mode: mode,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");
    setLoading(true);

    try {
      const historyPayload = getRecentHistoryPayload();
      const response = await askCopilot(q, {
        mode: mode,
        meetingId: mode === "meeting" ? selectedMeetingId || undefined : undefined,
        history: historyPayload,
      });

      const copilotMsgId = createChatMessageId("copilot");
      const copilotMsg: ChatMessage = {
        id: copilotMsgId,
        sender: "copilot",
        text: response.answer,
        mode: response.mode || mode,
        references: response.references,
      };
      setMessages((prev) => [...prev, copilotMsg]);

      if (autoSpeakRef.current && response.answer) {
        speakMessage(copilotMsgId, response.answer);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get answer from AI Assistant.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // --- Continuous Hands-Free Voice Conversation Engine ---

  /**
   * Starts a single turn of continuous hands-free listening with real-time VAD.
   * ECHO-PREVENTION: The microphone is opened ONLY after speech playback has fully stopped.
   */
  const startContinuousListeningTurn = async () => {
    if (!continuousActiveRef.current || continuousStateRef.current === "paused") {
      return;
    }

    stopSpeaking();
    stopAudioAnalyser();
    setContinuousState("listening");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else {
          mimeType = "";
        }
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stopAudioAnalyser();
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }

        const durationSec = (getTimestampNow() - recordingStartTimeRef.current) / 1000;
        const mime = recorder.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mime });

        // If turn was stopped by user ending the session or had no speech data
        if (!continuousActiveRef.current) {
          setContinuousState("idle");
          return;
        }

        if (audioBlob.size < 120 || durationSec < 0.6) {
          // If turn was empty or too short, listen again if still active
          if (continuousActiveRef.current && continuousStateRef.current !== "paused") {
            setTimeout(() => {
              if (continuousActiveRef.current && continuousStateRef.current !== "paused") {
                startContinuousListeningTurn();
              }
            }, 300);
          } else {
            setContinuousState("idle");
          }
          return;
        }

        await processContinuousTurn(audioBlob);
      };

      recorder.start(200);
      recordingStartTimeRef.current = getTimestampNow();
      hasSpokenRef.current = false;

      // Start Web Audio VAD monitoring for natural silence completion
      setupVADMonitoring(stream, () => {
        // Automatically finish speaking when user stops talking
        if (recorder.state === "recording") {
          try {
            recorder.stop();
          } catch {}
        }
      });

    } catch (err: unknown) {
      setContinuousActive(false);
      setContinuousState("idle");
      const errObj = err as { name?: string; message?: string };
      if (errObj.name === "NotAllowedError" || errObj.name === "PermissionDeniedError") {
        setError("Microphone permission was denied. Please allow microphone access to use voice conversation.");
      } else {
        setError(`Microphone error: ${errObj.message || "Failed to access microphone hardware."}`);
      }
    }
  };

  /**
   * Sets up Web Audio AnalyserNode to calculate real-time RMS/volume.
   * Automatically triggers onSpeechEnd after user has spoken and pauses for 1.3 seconds.
   */
  const setupVADMonitoring = (stream: MediaStream, onSpeechEnd: () => void) => {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart: number | null = null;
      const startTime = getTimestampNow();

      const monitorLoop = () => {
        if (!analyserRef.current || continuousStateRef.current !== "listening") return;

        analyserRef.current.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length;
        setAudioLevel(Math.min(100, Math.round((avg / 120) * 100)));

        const speechThreshold = 12; // Voice presence threshold
        const elapsed = getTimestampNow() - startTime;

        if (avg > speechThreshold) {
          hasSpokenRef.current = true;
          silenceStart = null;
        } else if (hasSpokenRef.current && elapsed > 1200) {
          if (!silenceStart) {
            silenceStart = getTimestampNow();
          } else if (getTimestampNow() - silenceStart > 1300) {
            // 1.3s of post-speech silence detected -> complete user turn
            stopAudioAnalyser();
            onSpeechEnd();
            return;
          }
        }

        animFrameRef.current = requestAnimationFrame(monitorLoop);
      };

      animFrameRef.current = requestAnimationFrame(monitorLoop);
    } catch (e) {
      console.warn("VAD monitoring setup notice:", e);
    }
  };

  /**
   * Manually completes the current listening turn (Done Speaking button).
   */
  const handleManualDoneSpeaking = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      stopAudioAnalyser();
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
  };

  /**
   * Sends user turn audio to backend, receives response, and speaks it aloud.
   * On speech end, automatically resumes listening turn if session is still active.
   */
  const processContinuousTurn = async (audioBlob: Blob) => {
    setContinuousState("thinking");
    setError(null);
    setTtsError(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const historyPayload = getRecentHistoryPayload();
      const currentMode = modeRef.current;
      const response = await voiceChatCopilot(
        audioBlob,
        {
          mode: currentMode,
          meetingId: currentMode === "meeting" ? selectedMeetingId || undefined : undefined,
          history: historyPayload,
          signal: abortController.signal,
        }
      );

      const userMsgId = createChatMessageId("user");
      const userMsg: ChatMessage = {
        id: userMsgId,
        sender: "user",
        text: response.query,
        isVoice: true,
        mode: currentMode,
      };

      const copilotMsgId = createChatMessageId("copilot");
      const copilotMsg: ChatMessage = {
        id: copilotMsgId,
        sender: "copilot",
        text: response.answer,
        mode: response.mode || currentMode,
        references: response.references,
      };

      setMessages((prev) => [...prev, userMsg, copilotMsg]);

      // If user ended session while waiting for AI response
      if (!continuousActiveRef.current) {
        setContinuousState("idle");
        return;
      }

      // Enter speaking state (microphone strictly OFF during speech for echo-prevention)
      setContinuousState("speaking");

      speakMessage(copilotMsgId, response.answer, () => {
        // Callback after assistant finishes speaking:
        // Automatically resume listening for next user turn if session is active and not paused!
        if (continuousActiveRef.current && continuousStateRef.current !== "paused") {
          // 300ms buffer ensures all speaker audio is extinguished before mic reopens
          setTimeout(() => {
            if (continuousActiveRef.current && continuousStateRef.current !== "paused") {
              startContinuousListeningTurn();
            }
          }, 320);
        } else if (!continuousActiveRef.current) {
          setContinuousState("idle");
        }
      });

    } catch (err: unknown) {
      const errObj = err as { name?: string; message?: string };
      if (errObj.name === "AbortError") {
        setContinuousState("idle");
        return;
      }
      setError(errObj.message || "Failed to process voice query.");

      // Resume listening or idle on error
      if (continuousActiveRef.current && continuousStateRef.current !== "paused") {
        setTimeout(() => {
          if (continuousActiveRef.current && continuousStateRef.current !== "paused") {
            startContinuousListeningTurn();
          }
        }, 1500);
      } else {
        setContinuousState("idle");
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  /**
   * Starts a continuous hands-free voice session.
   */
  const startContinuousSession = () => {
    stopSpeaking();
    setError(null);
    setTtsError(null);
    setContinuousActive(true);
    setContinuousState("listening");

    // Decouple start to ensure previous resources are fully unmounted
    setTimeout(() => {
      startContinuousListeningTurn();
    }, 50);
  };

  /**
   * Pauses continuous voice session listening.
   */
  const pauseContinuousSession = () => {
    stopSpeaking();
    stopAudioAnalyser();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setContinuousState("paused");
  };

  /**
   * Resumes continuous voice session from paused state.
   */
  const resumeContinuousSession = () => {
    setError(null);
    setTtsError(null);
    setContinuousState("listening");
    startContinuousListeningTurn();
  };

  /**
   * Ends continuous hands-free voice session completely.
   */
  const endContinuousSession = () => {
    setContinuousActive(false);
    setContinuousState("idle");
    cleanupAllAudioResources();
  };

  // --- Push-To-Talk Voice Recording (Fallback / One-off) ---
  const startPushVoiceRecording = async () => {
    if (continuousActive) {
      endContinuousSession();
    }
    stopSpeaking();
    setError(null);
    setTtsError(null);
    setPushVoiceState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else {
          mimeType = "";
        }
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
      };

      recorder.start(250);
      recordingStartTimeRef.current = getTimestampNow();
      setRecordingSeconds(0);
      setPushVoiceState("recording");

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      setPushVoiceState("idle");
      const errObj = err as { name?: string; message?: string };
      if (errObj.name === "NotAllowedError" || errObj.name === "PermissionDeniedError") {
        setError("Microphone permission was denied. Please allow microphone access to record.");
      } else {
        setError(`Microphone error: ${errObj.message || "Failed to access microphone."}`);
      }
    }
  };

  const stopPushVoiceRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const durationSec = (getTimestampNow() - recordingStartTimeRef.current) / 1000;
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      cancelPushVoiceRecording();
      return;
    }

    recorder.onstop = async () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (durationSec < 0.6) {
        setError("Recording was too short. Please speak clearly into your microphone.");
        setPushVoiceState("idle");
        return;
      }

      const mime = recorder.mimeType || "audio/webm";
      const audioBlob = new Blob(audioChunksRef.current, { type: mime });

      if (audioBlob.size < 100) {
        setError("No audio data was captured. Please check your microphone and try again.");
        setPushVoiceState("idle");
        return;
      }

      await submitPushVoiceQuery(audioBlob);
    };

    try {
      recorder.stop();
    } catch {
      cancelPushVoiceRecording();
    }
  };

  const cancelPushVoiceRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    audioChunksRef.current = [];
    setPushVoiceState("idle");
    setRecordingSeconds(0);
  };

  const submitPushVoiceQuery = async (audioBlob: Blob) => {
    setPushVoiceState("processing");
    setError(null);
    setTtsError(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const historyPayload = getRecentHistoryPayload();
      const response = await voiceChatCopilot(
        audioBlob,
        {
          mode: mode,
          meetingId: mode === "meeting" ? selectedMeetingId || undefined : undefined,
          history: historyPayload,
          signal: abortController.signal,
        }
      );

      const userMsgId = createChatMessageId("user");
      const userMsg: ChatMessage = {
        id: userMsgId,
        sender: "user",
        text: response.query,
        isVoice: true,
        mode: mode,
      };

      const copilotMsgId = createChatMessageId("copilot");
      const copilotMsg: ChatMessage = {
        id: copilotMsgId,
        sender: "copilot",
        text: response.answer,
        mode: response.mode || mode,
        references: response.references,
      };

      setMessages((prev) => [...prev, userMsg, copilotMsg]);
      setPushVoiceState("idle");

      if (autoSpeakRef.current && response.answer) {
        speakMessage(copilotMsgId, response.answer);
      }
    } catch (err: unknown) {
      const errObj = err as { name?: string; message?: string };
      if (errObj.name === "AbortError") {
        setPushVoiceState("idle");
        return;
      }
      setError(errObj.message || "Failed to process voice question.");
      setPushVoiceState("idle");
    } finally {
      abortControllerRef.current = null;
    }
  };

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const generalPrompts = [
    "Hi, can you hear me?",
    "What can you help me with today?",
    "Give me 3 best practices for conducting productive sprint retrospectives.",
    "Tell me a quick tip to stay focused during long remote meetings.",
  ];

  const meetingPrompts = [
    "What were the key decisions in recent meetings?",
    "Who is assigned action items and what are the deadlines?",
    "What was discussed regarding the project roadmap?",
  ];

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto w-full flex flex-col h-[calc(100vh-2rem)]">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800/80 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <BotMessageSquare className="w-6 h-6 text-indigo-400" />
            AI Voice Assistant & Copilot
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Personal conversational voice assistant & grounded meeting intelligence running 100% locally on Llama 3.2 3B & faster-whisper.
          </p>
        </div>

        {/* Global Quick Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Active Speaking Indicator */}
          {activeSpeakingId && (
            <button
              onClick={stopSpeaking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 border border-rose-500/40 text-rose-300 text-xs font-semibold hover:bg-rose-600/30 transition-all animate-pulse shadow-sm"
              title="Stop speech playback"
            >
              <VolumeX className="w-3.5 h-3.5 text-rose-400" />
              <span>Stop Speaking</span>
            </button>
          )}

          {/* Test Voice Diagnostic Button */}
          <button
            onClick={handleTestVoice}
            title='Test voice output'
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              activeSpeakingId === "test-voice-button"
                ? "bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse"
                : "bg-slate-900 border-slate-800 text-slate-300 hover:text-indigo-300 hover:border-indigo-500/50"
            }`}
          >
            {activeSpeakingId === "test-voice-button" ? (
              <>
                <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                <span>Stop Test</span>
              </>
            ) : (
              <>
                <Volume1 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Test Voice</span>
              </>
            )}
          </button>

          {/* Auto-Read Aloud Toggle */}
          {speechSupported ? (
            <button
              onClick={() => {
                if (activeSpeakingId) stopSpeaking();
                setAutoSpeak(!autoSpeak);
              }}
              title={autoSpeak ? "Auto-read AI responses enabled (click to mute)" : "Auto-read AI responses muted (click to enable)"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                autoSpeak
                  ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {autoSpeak ? <Volume2 className="w-3.5 h-3.5 text-indigo-400" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{autoSpeak ? "Voice Out: On" : "Voice Out: Off"}</span>
            </button>
          ) : (
            <span
              className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-1"
              title="Speech synthesis is not supported by your browser."
            >
              TTS Unavailable
            </span>
          )}
        </div>
      </div>

      {/* Mode Switcher & Voice Hero Bar */}
      <div className="py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-800/60 shrink-0">
        {/* Mode Switcher Tabs */}
        <div className="flex items-center gap-2 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
          <button
            onClick={() => setMode("general")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === "general"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>General Conversation</span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-500/30">
              Default
            </span>
          </button>

          <button
            onClick={() => setMode("meeting")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === "meeting"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Meeting Assistant</span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
              RAG
            </span>
          </button>
        </div>

        {/* Meeting Scope & Start Continuous Voice Button */}
        <div className="flex items-center gap-2.5">
          {mode === "meeting" ? (
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-slate-400 font-medium whitespace-nowrap">Scope:</label>
              <select
                value={selectedMeetingId}
                onChange={(e) => setSelectedMeetingId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[170px] sm:max-w-[210px]"
              >
                <option value="">All Past Meetings</option>
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="text-xs text-slate-400 italic hidden sm:inline">
              Natural chat & greetings without meeting data
            </span>
          )}

          {/* Primary CTA: Start Hands-Free Voice Conversation */}
          {!continuousActive ? (
            <button
              onClick={startContinuousSession}
              disabled={loading || pushVoiceState === "recording"}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/25 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
              title="Start hands-free, continuous conversational voice loop"
            >
              <Radio className="w-4 h-4 text-white animate-pulse" />
              <span>Start Voice Conversation</span>
            </button>
          ) : (
            <button
              onClick={endContinuousSession}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600/20 border border-rose-500/50 hover:bg-rose-600/30 text-rose-300 text-xs font-semibold transition-all"
              title="End active voice session"
            >
              <PhoneOff className="w-4 h-4 text-rose-400" />
              <span>End Voice Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Visible Speech Synthesis Error Alert */}
      {ttsError && (
        <div className="mt-3 p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/50 text-xs text-amber-200 flex items-center justify-between gap-3 shadow-sm shrink-0 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{ttsError}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTestVoice}
              className="px-2.5 py-1 rounded-md bg-amber-900/60 hover:bg-amber-850 border border-amber-700/50 text-amber-100 text-[11px] font-medium transition-colors"
            >
              Test Voice
            </button>
            <button
              onClick={() => setTtsError(null)}
              className="text-amber-400 hover:text-amber-200 p-1 rounded-md hover:bg-amber-900/40 transition-colors"
              title="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Continuous Voice Session HUD (Visible when active) */}
      {continuousActive && (
        <div className={`mt-3 p-4 rounded-2xl border shadow-xl transition-all duration-300 shrink-0 ${
          continuousState === "listening"
            ? "bg-slate-900/95 border-emerald-500/50 shadow-emerald-950/20 ring-1 ring-emerald-500/30"
            : continuousState === "thinking"
            ? "bg-slate-900/95 border-indigo-500/50 shadow-indigo-950/20 ring-1 ring-indigo-500/30"
            : continuousState === "speaking"
            ? "bg-slate-900/95 border-violet-500/50 shadow-violet-950/20 ring-1 ring-violet-500/30"
            : "bg-slate-900/95 border-amber-500/50 shadow-amber-950/20 ring-1 ring-amber-500/30"
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* State Indicator */}
            <div className="flex items-center gap-3">
              {continuousState === "listening" && (
                <span className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500" />
                </span>
              )}
              {continuousState === "thinking" && (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
              )}
              {continuousState === "speaking" && (
                <span className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-violet-500" />
                </span>
              )}
              {continuousState === "paused" && (
                <span className="h-3.5 w-3.5 rounded-full bg-amber-500 shrink-0" />
              )}

              <div>
                <p className="text-xs font-bold text-white flex items-center gap-2">
                  <span>
                    {continuousState === "listening" && "Listening to you... (hands-free)"}
                    {continuousState === "thinking" && "Thinking... transcribing & analyzing"}
                    {continuousState === "speaking" && "Assistant speaking (microphone muted for echo-prevention)"}
                    {continuousState === "paused" && "Voice session paused"}
                  </span>
                  <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded border ${
                    continuousState === "listening"
                      ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                      : continuousState === "thinking"
                      ? "bg-indigo-950 text-indigo-300 border-indigo-800"
                      : continuousState === "speaking"
                      ? "bg-violet-950 text-violet-300 border-violet-800"
                      : "bg-amber-950 text-amber-300 border-amber-800"
                  }`}>
                    {continuousState}
                  </span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {continuousState === "listening" && "Speak naturally. When you finish speaking, I will respond and listen again."}
                  {continuousState === "thinking" && "Transcribing with faster-whisper and answering via Ollama llama3.2:3b..."}
                  {continuousState === "speaking" && "I will automatically resume listening when finished speaking."}
                  {continuousState === "paused" && "Click Resume Listening when you are ready to continue."}
                </p>
              </div>
            </div>

            {/* Live Audio Level Meter (When listening) */}
            {continuousState === "listening" && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-950/70 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 font-mono">Mic:</span>
                <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-75"
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
              </div>
            )}

            {/* Session Action Controls */}
            <div className="flex items-center gap-2 shrink-0">
              {continuousState === "listening" && (
                <>
                  <button
                    onClick={handleManualDoneSpeaking}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1"
                    title="Finish speaking and submit immediately"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Done Speaking</span>
                  </button>
                  <button
                    onClick={pauseContinuousSession}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors flex items-center gap-1"
                    title="Pause voice listening"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </button>
                </>
              )}

              {continuousState === "speaking" && (
                <>
                  <button
                    onClick={stopSpeaking}
                    className="px-3 py-1.5 rounded-lg bg-rose-600/30 border border-rose-500/50 hover:bg-rose-600/40 text-rose-300 text-xs font-semibold transition-all flex items-center gap-1"
                    title="Stop playback"
                  >
                    <VolumeX className="w-3.5 h-3.5" />
                    <span>Stop Speaking</span>
                  </button>
                  <button
                    onClick={pauseContinuousSession}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors flex items-center gap-1"
                    title="Pause session"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </button>
                </>
              )}

              {continuousState === "paused" && (
                <button
                  onClick={resumeContinuousSession}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1"
                  title="Resume voice listening"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume Listening</span>
                </button>
              )}

              <button
                onClick={endContinuousSession}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 hover:text-rose-300 text-slate-400 text-xs font-medium transition-colors flex items-center gap-1"
                title="End voice session"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">End</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto py-5 space-y-6">
        {messages.length === 0 ? (
          <div className="py-10 sm:py-14 text-center space-y-6 max-w-lg mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto text-indigo-400 shadow-inner">
              <Sparkles className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base sm:text-lg font-semibold text-slate-200">
                {mode === "general"
                  ? "Talk or type to your Personal AI Assistant"
                  : "Search & Ask your AI Meeting Copilot"}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {mode === "general"
                  ? "Answers greetings, general questions, and casual conversation naturally. Click 'Start Voice Conversation' for continuous hands-free dialogue!"
                  : "All meeting queries are strictly grounded with verified timestamps and SQLite FTS5 transcript citations."}
              </p>
            </div>

            {/* Suggested Prompts based on active mode */}
            <div className="space-y-2 text-left pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
                Try asking:
              </p>
              <div className="space-y-2">
                {(mode === "general" ? generalPrompts : meetingPrompts).map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(prompt)}
                    className="w-full text-left p-3 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 text-xs text-slate-300 transition-colors shadow-sm"
                  >
                    &ldquo;{prompt}&rdquo;
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${
                msg.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.sender === "copilot" && (
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 mt-0.5">
                  <BotMessageSquare className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-2xl rounded-2xl p-4 text-sm leading-relaxed space-y-3 ${
                  msg.sender === "user"
                    ? "bg-indigo-600 text-white rounded-tr-sm shadow-md shadow-indigo-600/10"
                    : "bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-sm shadow-md"
                }`}
              >
                {/* Message Header Badges */}
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-white/10 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    {msg.sender === "user" && msg.isVoice && (
                      <span className="flex items-center gap-1 font-medium text-indigo-200">
                        <Mic className="w-3 h-3 text-indigo-200" />
                        <span>Spoken Question</span>
                      </span>
                    )}
                    {msg.sender === "copilot" && (
                      <span className="text-slate-400 font-medium">
                        {msg.mode === "meeting" ? "Meeting Assistant" : "General Assistant"}
                      </span>
                    )}
                  </div>

                  {/* Speaker control on Copilot response */}
                  {msg.sender === "copilot" && (
                    <button
                      onClick={() => speakMessage(msg.id, msg.text)}
                      title={activeSpeakingId === msg.id ? "Stop reading aloud" : "Read response aloud"}
                      className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 shrink-0 transition-colors ${
                        activeSpeakingId === msg.id
                          ? "bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse"
                          : "bg-slate-950/60 border-slate-800 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/40"
                      }`}
                    >
                      {activeSpeakingId === msg.id ? (
                        <>
                          <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                          <span className="text-[10px] font-medium hidden sm:inline">Stop</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3.5 h-3.5 text-slate-300" />
                          <span className="text-[10px] font-medium hidden sm:inline">Listen</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>

                {/* Citations / Source References (Meeting Assistant Mode) */}
                {msg.references && msg.references.length > 0 && (
                  <div className="pt-3 border-t border-slate-800/80 space-y-2 text-xs">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Meeting Sources & Timestamps:
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {msg.references.slice(0, 4).map((ref, i) => (
                        <Link
                          key={i}
                          href={`/meetings/${ref.meeting_id}`}
                          className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/60 hover:border-indigo-500/40 text-xs block space-y-1 transition-colors"
                        >
                          <div className="flex items-center justify-between text-indigo-300 font-medium">
                            <span className="truncate max-w-[280px]">{ref.meeting_title}</span>
                            <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTimestamp(ref.start_time)} - {formatTimestamp(ref.end_time)}
                            </span>
                          </div>
                          <p className="text-slate-400 text-[11px] line-clamp-1 italic">
                            &ldquo;{ref.text}&rdquo;
                          </p>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {msg.sender === "user" && (
                <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))
        )}

        {/* Text Loading State */}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <BotMessageSquare className="w-4 h-4" />
            </div>
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center gap-2.5 shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>
                {mode === "meeting"
                  ? "Searching meeting transcripts with FTS5 and synthesizing with Llama 3.2..."
                  : "Thinking with local Llama 3.2 3B assistant..."}
              </span>
            </div>
          </div>
        )}

        {/* Push-to-Talk Voice Processing State */}
        {pushVoiceState === "processing" && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <BotMessageSquare className="w-4 h-4" />
            </div>
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-xs text-slate-300 flex items-center justify-between gap-4 shadow-sm w-full max-w-xl">
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Transcribing question with faster-whisper and processing answer...</span>
              </div>
              <button
                onClick={cancelPushVoiceRecording}
                className="text-xs text-slate-400 hover:text-rose-400 px-2 py-1 rounded-md bg-slate-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/40 text-xs text-rose-300 flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-rose-400 hover:text-rose-200 p-1 rounded-md hover:bg-rose-900/30 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Push-to-Talk Voice Recording Active Card */}
      {pushVoiceState === "recording" && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-rose-500/40 shadow-xl shadow-rose-950/20 mb-3 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in duration-200 shrink-0">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
            </span>
            <div>
              <p className="text-xs font-semibold text-rose-300 flex items-center gap-2">
                <span>Listening to your question...</span>
                <span className="font-mono bg-rose-950 px-2 py-0.5 rounded text-rose-200 text-[11px] border border-rose-800/60">
                  {formatTimer(recordingSeconds)}
                </span>
              </p>
              <p className="text-[11px] text-slate-400">Speak clearly. Click &ldquo;Stop & Ask&rdquo; when finished.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={cancelPushVoiceRecording}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={stopPushVoiceRecording}
              className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/30 transition-all flex items-center gap-1.5"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop & Ask</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Input Form Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="pt-3 border-t border-slate-800/80 flex items-center gap-2 shrink-0"
      >
        {/* Push-to-Talk Microphone Button (Fallback / One-off) */}
        {pushVoiceState === "recording" ? (
          <button
            type="button"
            onClick={stopPushVoiceRecording}
            className="p-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium text-sm transition-all flex items-center gap-1.5 shrink-0 shadow-lg shadow-rose-600/30 animate-pulse"
            title="Stop recording and submit question"
          >
            <Square className="w-4 h-4 fill-current" />
            <span className="text-xs font-semibold hidden sm:inline">Stop</span>
          </button>
        ) : pushVoiceState === "requesting" ? (
          <button
            type="button"
            disabled
            className="p-3 rounded-xl bg-slate-800 text-slate-400 text-sm flex items-center gap-1.5 shrink-0 cursor-not-allowed"
          >
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            <span className="text-xs hidden sm:inline">Mic...</span>
          </button>
        ) : pushVoiceState === "processing" ? (
          <button
            type="button"
            disabled
            className="p-3 rounded-xl bg-slate-800 text-slate-400 text-sm flex items-center gap-1.5 shrink-0 cursor-not-allowed"
          >
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            <span className="text-xs hidden sm:inline">Processing...</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={startPushVoiceRecording}
            disabled={loading || continuousActive}
            className={`p-3 rounded-xl border font-medium text-sm transition-all flex items-center gap-1.5 shrink-0 shadow-inner group ${
              continuousActive
                ? "bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed"
                : "bg-slate-900 hover:bg-slate-800 border-slate-800 hover:border-indigo-500/50 text-slate-200 hover:text-indigo-300"
            }`}
            title="One-off voice question (Push-to-talk)"
          >
            <Mic className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs hidden sm:inline">Mic</span>
          </button>
        )}

        {/* Text Input Field */}
        <input
          type="text"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          placeholder={
            continuousActive
              ? `Voice mode active (${continuousState}). You can speak aloud or type here...`
              : mode === "general"
              ? "Type or speak to chat with your personal AI assistant..."
              : "Ask questions about past meetings, decisions, or action items..."
          }
          disabled={loading || pushVoiceState === "recording" || pushVoiceState === "processing"}
          className="flex-1 px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 shadow-inner disabled:opacity-60"
        />

        {/* Text Send Button */}
        <button
          type="submit"
          disabled={!inputQuery.trim() || loading || pushVoiceState === "recording" || pushVoiceState === "processing"}
          className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-400 text-white font-medium text-sm transition-colors flex items-center gap-2 shrink-0 shadow-md shadow-indigo-600/20"
          title="Send query"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">Send</span>
        </button>
      </form>
    </div>
  );
}

export default function CopilotPage() {
  return (
    <Suspense
      fallback={
        <div className="py-24 flex justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      }
    >
      <CopilotChatInner />
    </Suspense>
  );
}
