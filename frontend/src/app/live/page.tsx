"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { 
  Mic, 
  Play, 
  Pause, 
  Square, 
  Radio, 
  AlertCircle, 
  Loader2, 
  CheckCircle2, 
  Clock, 
  ArrowRight
} from "lucide-react";
import { getLiveWebSocketUrl, formatTimestamp, API_BASE } from "@/lib/api";

interface LiveSegment {
  start_time: number;
  end_time: number;
  text: string;
}

export default function LiveMeetingPage() {
  const [meetingTitle, setMeetingTitle] = useState("");
  const [recordingState, setRecordingState] = useState<
    "idle" | "requesting" | "recording" | "paused" | "finalizing" | "completed"
  >("idle");

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [completedMeetingId, setCompletedMeetingId] = useState<string | null>(null);
  const [completedTitle, setCompletedTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recordingStateRef = useRef(recordingState);
  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  const currentMeetingIdRef = useRef<string | null>(null);
  const currentTitleRef = useRef<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript when new segments arrive
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments]);

  const cleanupResources = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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
    if (webSocketRef.current) {
      try {
        webSocketRef.current.close();
      } catch {}
      webSocketRef.current = null;
    }
  }, []);

  // Clean up mic tracks & timers when unmounting
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  const startRecording = async () => {
    setError(null);
    setSegments([]);
    setCompletedMeetingId(null);
    setCompletedTitle(null);
    currentMeetingIdRef.current = null;
    currentTitleRef.current = null;
    setElapsedSeconds(0);
    setRecordingState("requesting");

    // 1. Request microphone permission
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
    } catch (err: unknown) {
      setRecordingState("idle");
      const errName = (err as Error)?.name || "";
      const errMsg = (err as Error)?.message || "";
      if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
        setError(
          "Microphone access was denied. Please allow microphone permissions in your browser address bar to record."
        );
      } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
        setError("No microphone detected. Please connect an audio input device.");
      } else {
        setError(`Microphone error: ${errMsg || "Failed to access audio hardware."}`);
      }
      return;
    }

    // 2. Determine best supported audio format
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

    // 3. Connect to Backend WebSocket
    const titleParam = meetingTitle.trim() || undefined;
    const wsUrl = getLiveWebSocketUrl(titleParam);
    const ws = new WebSocket(wsUrl);
    webSocketRef.current = ws;

    ws.onopen = () => {
      try {
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(event.data);
          }
        };

        // Emit audio chunks every 2.5 seconds for responsive live transcription
        recorder.start(2500);
        setRecordingState("recording");

        // Start elapsed timer
        timerRef.current = setInterval(() => {
          setElapsedSeconds((prev) => prev + 1);
        }, 1000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Recorder failed";
        setError(`Failed to initialize recorder: ${msg}`);
        cleanupResources();
        setRecordingState("idle");
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ready") {
          currentMeetingIdRef.current = data.meeting_id;
          currentTitleRef.current = data.title;
        } else if (data.type === "segment") {
          setSegments((prev) => [
            ...prev,
            {
              start_time: data.start_time,
              end_time: data.end_time,
              text: data.text,
            },
          ]);
        } else if (data.type === "completed") {
          setCompletedMeetingId(data.meeting_id);
          setCompletedTitle(data.title);
          setRecordingState("completed");
          cleanupResources();
        } else if (data.type === "error") {
          setError(data.message || "Recording error occurred.");
          cleanupResources();
          setRecordingState("idle");
        }
      } catch (e) {
        console.error("Error parsing live websocket message:", e);
      }
    };

    ws.onerror = () => {
      if (recordingStateRef.current !== "finalizing") {
        setError("Lost connection to FastAPI backend WebSocket server.");
        cleanupResources();
        setRecordingState("idle");
      }
    };

    ws.onclose = async () => {
      const state = recordingStateRef.current;
      if (state === "recording" || state === "paused") {
        setRecordingState("idle");
      } else if (state === "finalizing") {
        // Fallback polling with environment-based API_BASE
        const mid = currentMeetingIdRef.current;
        if (mid) {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((r) => setTimeout(r, 1500));
            try {
              const res = await fetch(`${API_BASE}/api/meetings/${mid}`);
              if (res.ok) {
                const meetingData = await res.json();
                if (meetingData.status === "completed") {
                  setCompletedMeetingId(mid);
                  setCompletedTitle(meetingData.title || currentTitleRef.current || "Live Meeting");
                  setRecordingState("completed");
                  cleanupResources();
                  return;
                }
              }
            } catch {}
          }
        }
        setError("Session closed before confirmation. Please check Meeting History.");
        cleanupResources();
        setRecordingState("idle");
      }
    };
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        webSocketRef.current.send(JSON.stringify({ type: "pause" }));
      }
      setRecordingState("paused");
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        webSocketRef.current.send(JSON.stringify({ type: "resume" }));
      }
      setRecordingState("recording");
    }
  };

  const stopRecording = () => {
    setRecordingState("finalizing");
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    const ws = webSocketRef.current;

    const sendStopCommand = () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stop" }));
      }
    };

    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        sendStopCommand();
      };
      try {
        recorder.stop();
      } catch {
        sendStopCommand();
      }
    } else {
      sendStopCommand();
    }
  };

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto w-full space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Radio className="w-6 h-6 text-rose-500" />
            Live Microphone Transcription
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time speech transcription powered by local <span className="font-mono text-indigo-400">faster-whisper</span>.
          </p>
        </div>

        {/* Status Indicator Pill */}
        <div className="flex items-center gap-2">
          {recordingState === "recording" && (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold animate-pulse shadow-sm">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Recording Active ({formatTimer(elapsedSeconds)})
            </div>
          )}
          {recordingState === "paused" && (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold shadow-sm">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Paused ({formatTimer(elapsedSeconds)})
            </div>
          )}
          {recordingState === "finalizing" && (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold shadow-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              Finalizing with Whisper...
            </div>
          )}
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Microphone or Connection Error</p>
            <p className="text-xs text-rose-300/80">{error}</p>
          </div>
        </div>
      )}

      {/* Completion Success Card */}
      {recordingState === "completed" && completedMeetingId && (
        <div className="p-6 rounded-2xl bg-emerald-950/30 border border-emerald-800/50 space-y-4 text-emerald-200 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-semibold text-base text-emerald-300">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            Live Meeting Successfully Saved to Database!
          </div>
          <p className="text-xs text-emerald-200/80 leading-relaxed">
            Your recording &ldquo;{completedTitle}&rdquo; was transcribed, indexed with SQLite FTS5, and saved in your meeting history.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href={`/meetings/${completedMeetingId}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all"
            >
              View Meeting & Summary <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={() => {
                setRecordingState("idle");
                setCompletedMeetingId(null);
                setSegments([]);
                setMeetingTitle("");
              }}
              className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
            >
              Record Another Meeting
            </button>
          </div>
        </div>
      )}

      {/* Recording Control Console */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-6 shadow-sm">
        {/* Title Input */}
        <div className="space-y-1.5 max-w-lg">
          <label className="text-xs font-medium text-slate-300">Meeting Title (Optional)</label>
          <input
            type="text"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            disabled={recordingState !== "idle"}
            placeholder="e.g. Sprint Planning & Architecture Review"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
          />
        </div>

        {/* Live Controls */}
        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-800/70">
          {recordingState === "idle" && (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm shadow-lg shadow-rose-600/20 active:scale-[0.98] transition-all"
            >
              <Mic className="w-4 h-4" />
              Start Recording
            </button>
          )}

          {recordingState === "requesting" && (
            <button
              disabled
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 text-slate-400 font-semibold text-sm cursor-not-allowed"
            >
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              Requesting Microphone...
            </button>
          )}

          {recordingState === "recording" && (
            <>
              <button
                onClick={pauseRecording}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-all"
              >
                <Pause className="w-3.5 h-3.5" />
                Pause
              </button>
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/20 active:scale-[0.98] transition-all"
              >
                <Square className="w-3.5 h-3.5" />
                Stop & Save Meeting
              </button>

              {/* Sound wave activity indicator */}
              <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="w-1 bg-rose-500 rounded-full animate-soundwave-1" />
                <div className="w-1 bg-rose-500 rounded-full animate-soundwave-2" />
                <div className="w-1 bg-rose-500 rounded-full animate-soundwave-3" />
                <div className="w-1 bg-rose-500 rounded-full animate-soundwave-4" />
                <div className="w-1 bg-rose-500 rounded-full animate-soundwave-5" />
                <span className="text-[11px] text-slate-400 font-mono pl-1">Live Audio</span>
              </div>
            </>
          )}

          {recordingState === "paused" && (
            <>
              <button
                onClick={resumeRecording}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 active:scale-[0.98] transition-all"
              >
                <Play className="w-3.5 h-3.5" />
                Resume Recording
              </button>
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/20 active:scale-[0.98] transition-all"
              >
                <Square className="w-3.5 h-3.5" />
                Stop & Save Meeting
              </button>
            </>
          )}

          {recordingState === "finalizing" && (
            <div className="flex items-center gap-2 text-xs text-indigo-300 font-medium py-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Transcribing final speech with faster-whisper and persisting to SQLite...</span>
            </div>
          )}

          {/* Active Timer Display */}
          {(recordingState === "recording" || recordingState === "paused") && (
            <div className="ml-auto font-mono text-sm text-slate-200 flex items-center gap-2 bg-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-800 shadow-inner">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>{formatTimer(elapsedSeconds)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Live Real-time Transcript Stream */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Radio className="w-4 h-4 text-rose-400" />
            <span>Live Transcript Feed</span>
          </div>
          <span className="text-xs text-slate-400">
            {segments.length} segment{segments.length === 1 ? "" : "s"} captured
          </span>
        </div>

        <div className="h-[380px] overflow-y-auto space-y-3 pr-2">
          {segments.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 space-y-2">
              <Mic className="w-10 h-10 text-slate-600" />
              <p className="text-sm font-medium text-slate-300">
                {recordingState === "recording"
                  ? "Listening to microphone... Speech will appear here within seconds."
                  : "Click 'Start Recording' above to begin capturing speech."}
              </p>
              <p className="text-xs text-slate-500 max-w-sm">
                Speech is transcribed in real-time on your laptop CPU using faster-whisper.
              </p>
            </div>
          ) : (
            segments.map((seg, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/70 text-sm space-y-1 transition-all"
              >
                <div className="text-[11px] font-mono text-indigo-400 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  {formatTimestamp(seg.start_time)} - {formatTimestamp(seg.end_time)}
                </div>
                <p className="text-slate-200 leading-relaxed">{seg.text}</p>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>
    </div>
  );
}
