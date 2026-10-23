export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface TranscriptSegment {
  id?: number;
  start_time: number;
  end_time: number;
  text: string;
  speaker?: string | null;
}

export interface ActionItem {
  id?: number;
  task: string;
  owner?: string | null;
  due_date?: string | null;
  completed: boolean;
}

export interface SummaryContent {
  executive_summary?: string;
  key_discussion_points?: string[];
  key_decisions?: string[];
}

export interface MeetingSummary {
  id: string;
  title: string;
  audio_filename?: string | null;
  duration_seconds: number;
  status: "processing" | "completed" | "failed";
  summary?: string | null;
  created_at: string;
  updated_at: string;
  segment_count: number;
  action_item_count: number;
}

export interface MeetingDetail extends MeetingSummary {
  segments: TranscriptSegment[];
  action_items: ActionItem[];
}

export interface SearchResult {
  meeting_id: string;
  segment_id: number;
  text: string;
  meeting_title: string;
  start_time: number;
  end_time: number;
}

export type ConversationMode = "general" | "meeting";

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ReferenceItem {
  meeting_id: string;
  meeting_title: string;
  start_time: number;
  end_time: number;
  text: string;
}

export interface ChatResponse {
  answer: string;
  references: ReferenceItem[];
  mode?: ConversationMode;
}

export interface VoiceChatResponse {
  query: string;
  answer: string;
  references: ReferenceItem[];
  mode?: ConversationMode;
}

export interface ChatOptions {
  mode?: ConversationMode;
  meetingId?: string;
  history?: ChatHistoryItem[];
  signal?: AbortSignal;
}

export interface TranscribeResponse {
  text: string;
  duration_seconds: number;
  language: string;
}

export interface SummarizeResponse {
  meeting_id: string;
  executive_summary: string;
  key_discussion_points: string[];
  key_decisions: string[];
  action_items: ActionItem[];
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function parseSummary(rawSummary?: string | null): SummaryContent | null {
  if (!rawSummary) return null;
  try {
    const parsed = JSON.parse(rawSummary);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch {
    // If it's plain text summary
    return {
      executive_summary: rawSummary,
      key_discussion_points: [],
      key_decisions: [],
    };
  }
  return null;
}

// API client methods
export async function getMeetings(): Promise<MeetingSummary[]> {
  const res = await fetch(`${API_BASE}/api/meetings`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load meetings (${res.status})`);
  return res.json();
}

export async function getMeeting(id: string): Promise<MeetingDetail> {
  const res = await fetch(`${API_BASE}/api/meetings/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load meeting (${res.status})`);
  return res.json();
}

export async function searchTranscripts(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const res = await fetch(`${API_BASE}/api/meetings/search?q=${encodeURIComponent(query)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return res.json();
}

export async function uploadAudio(
  file: File,
  title?: string
): Promise<{ meeting_id: string; title: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);

  const res = await fetch(`${API_BASE}/api/meetings/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Upload failed with status ${res.status}`);
  }

  return res.json();
}

export async function summarizeMeeting(id: string): Promise<SummarizeResponse> {
  const res = await fetch(`${API_BASE}/api/meetings/${id}/summarize`, {
    method: "POST",
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Summarization failed (${res.status})`);
  }
  return res.json();
}

export async function askCopilot(
  query: string,
  meetingIdOrOptions?: string | ChatOptions
): Promise<ChatResponse> {
  let mode: ConversationMode = "general";
  let meetingId: string | undefined = undefined;
  let history: ChatHistoryItem[] = [];
  let signal: AbortSignal | undefined = undefined;

  if (typeof meetingIdOrOptions === "string") {
    meetingId = meetingIdOrOptions || undefined;
    mode = meetingId ? "meeting" : "general";
  } else if (meetingIdOrOptions) {
    mode = meetingIdOrOptions.mode || (meetingIdOrOptions.meetingId ? "meeting" : "general");
    meetingId = meetingIdOrOptions.meetingId;
    history = meetingIdOrOptions.history || [];
    signal = meetingIdOrOptions.signal;
  }

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      mode,
      meeting_id: meetingId || null,
      history,
    }),
    signal,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Chat query failed (${res.status})`);
  }

  return res.json();
}

export async function voiceChatCopilot(
  audioBlob: Blob,
  meetingIdOrOptions?: string | ChatOptions,
  signalArg?: AbortSignal
): Promise<VoiceChatResponse> {
  let mode: ConversationMode = "general";
  let meetingId: string | undefined = undefined;
  let history: ChatHistoryItem[] = [];
  let signal: AbortSignal | undefined = signalArg;

  if (typeof meetingIdOrOptions === "string") {
    meetingId = meetingIdOrOptions || undefined;
    mode = meetingId ? "meeting" : "general";
  } else if (meetingIdOrOptions) {
    mode = meetingIdOrOptions.mode || (meetingIdOrOptions.meetingId ? "meeting" : "general");
    meetingId = meetingIdOrOptions.meetingId;
    history = meetingIdOrOptions.history || [];
    signal = meetingIdOrOptions.signal || signalArg;
  }

  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("mode", mode);
  if (meetingId) {
    formData.append("meeting_id", meetingId);
  }
  if (history.length > 0) {
    formData.append("history", JSON.stringify(history));
  }

  const res = await fetch(`${API_BASE}/api/chat/voice`, {
    method: "POST",
    body: formData,
    signal,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Voice chat query failed (${res.status})`);
  }

  return res.json();
}

export async function transcribeAudioQuery(
  audioBlob: Blob,
  signal?: AbortSignal
): Promise<TranscribeResponse> {
  const formData = new FormData();
  formData.append("file", audioBlob, "speech.webm");

  const res = await fetch(`${API_BASE}/api/chat/transcribe`, {
    method: "POST",
    body: formData,
    signal,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Speech transcription failed (${res.status})`);
  }

  return res.json();
}

export function getAudioUrl(meetingId: string): string {
  return `${API_BASE}/api/meetings/${meetingId}/audio`;
}

export function getLiveWebSocketUrl(title?: string): string {
  const wsProto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  let host = "localhost:8000";
  try {
    const url = new URL(API_BASE);
    host = url.host;
  } catch {}
  const q = title ? `?title=${encodeURIComponent(title)}` : "";
  return `${wsProto}//${host}/api/live/ws${q}`;
}
