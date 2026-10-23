"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft, 
  Sparkles, 
  Clock, 
  Calendar, 
  FileAudio, 
  ListTodo, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Play, 
  User, 
  MessageSquare,
  BotMessageSquare
} from "lucide-react";
import { 
  getMeeting, 
  summarizeMeeting, 
  getAudioUrl, 
  MeetingDetail, 
  parseSummary, 
  formatDuration, 
  formatTimestamp, 
  formatDate 
} from "@/lib/api";

function MeetingDetailInner() {
  const params = useParams();
  const meetingId = (params?.id as string) || "";

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const loadMeetingDetails = async () => {
    try {
      setError(null);
      const data = await getMeeting(meetingId);
      setMeeting(data);
    } catch (err: any) {
      setError(err.message || "Failed to load meeting details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (meetingId) {
      loadMeetingDetails();
    }
  }, [meetingId]);

  const handleSeek = (timeInSeconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = timeInSeconds;
      audioRef.current.play();
    }
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    setSummaryMsg(null);
    try {
      await summarizeMeeting(meetingId);
      setSummaryMsg("Summary and action items successfully extracted with Llama 3.2 3B!");
      await loadMeetingDetails();
    } catch (err: any) {
      setError(err.message || "Summarization failed.");
    } finally {
      setSummarizing(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-sm">Loading meeting details...</p>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-4">
        <Link href="/meetings" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to meetings
        </Link>
        <div className="p-6 rounded-2xl bg-rose-950/40 border border-rose-800/50 text-rose-300 space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-5 h-5 text-rose-400" />
            Error Loading Meeting
          </div>
          <p className="text-sm">{error || "Meeting not found."}</p>
        </div>
      </div>
    );
  }

  const summary = parseSummary(meeting.summary);

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/meetings"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to all meetings
        </Link>
        <Link
          href={`/copilot?meeting_id=${meeting.id}`}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/25 text-xs font-semibold transition-colors"
        >
          <BotMessageSquare className="w-3.5 h-3.5" />
          Chat about this meeting
        </Link>
      </div>

      {/* Header Info */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-white tracking-tight">{meeting.title}</h1>
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  meeting.status === "completed"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                }`}
              >
                {meeting.status}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(meeting.created_at)}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {formatDuration(meeting.duration_seconds)}
              </span>
              <span>•</span>
              <span>{meeting.segments.length} speech segments</span>
            </div>
          </div>

          {/* Re-summarize action button */}
          <button
            onClick={handleSummarize}
            disabled={summarizing || meeting.segments.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all shrink-0"
          >
            {summarizing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Analyzing with Llama 3.2...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                {meeting.summary ? "Re-summarize with AI" : "Generate AI Summary"}
              </>
            )}
          </button>
        </div>

        {/* Audio Player */}
        <div className="pt-4 border-t border-slate-800/80">
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-300 font-medium shrink-0">
              <FileAudio className="w-4 h-4 text-indigo-400" />
              <span>Audio Playback</span>
            </div>
            <audio
              ref={audioRef}
              controls
              src={getAudioUrl(meeting.id)}
              onTimeUpdate={() => {
                if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
              }}
              className="w-full h-8 accent-indigo-500 rounded focus:outline-none"
            />
          </div>
        </div>
      </div>

      {summaryMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{summaryMsg}</span>
        </div>
      )}

      {/* Main Grid: Transcript & Summary/Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (7 cols): Interactive Transcript */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex flex-col h-[700px]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <span>Transcript</span>
              </div>
              <span className="text-xs text-slate-400">Click timestamps to jump audio</span>
            </div>

            {meeting.segments.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
                No transcript segments available.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                {meeting.segments.map((seg, idx) => {
                  const isCurrent =
                    currentTime >= seg.start_time && currentTime <= seg.end_time;

                  return (
                    <div
                      key={seg.id || idx}
                      className={`p-3.5 rounded-xl border transition-all text-sm ${
                        isCurrent
                          ? "bg-indigo-950/30 border-indigo-500/50 text-indigo-100 shadow-sm"
                          : "bg-slate-950/40 border-slate-800/60 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                        <button
                          onClick={() => handleSeek(seg.start_time)}
                          className="font-mono text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 font-semibold"
                        >
                          <Play className="w-3 h-3" />
                          {formatTimestamp(seg.start_time)} - {formatTimestamp(seg.end_time)}
                        </button>
                        {seg.speaker && (
                          <span className="text-[11px] text-slate-400 font-medium">
                            {seg.speaker}
                          </span>
                        )}
                      </div>
                      <p className="leading-relaxed">{seg.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (5 cols): AI Summary & Action Items */}
        <div className="lg:col-span-5 space-y-6">
          {/* AI Summary Card */}
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>AI Summary (Llama 3.2 3B)</span>
            </div>

            {!summary ? (
              <div className="py-8 text-center text-xs text-slate-400 space-y-3">
                <p>No summary generated for this meeting yet.</p>
                <button
                  onClick={handleSummarize}
                  disabled={summarizing || meeting.segments.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs font-semibold hover:bg-indigo-600/30"
                >
                  Generate Summary Now
                </button>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Executive Summary */}
                {summary.executive_summary && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Executive Summary
                    </p>
                    <p className="text-slate-200 text-sm leading-relaxed p-3 rounded-xl bg-slate-950/60 border border-slate-800/70">
                      {summary.executive_summary}
                    </p>
                  </div>
                )}

                {/* Key Discussion Points */}
                {summary.key_discussion_points && summary.key_discussion_points.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Key Discussion Points
                    </p>
                    <ul className="space-y-1.5 list-disc list-inside text-slate-300">
                      {summary.key_discussion_points.map((pt, i) => (
                        <li key={i} className="leading-relaxed">
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Decisions */}
                {summary.key_decisions && summary.key_decisions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                      Key Decisions
                    </p>
                    <div className="space-y-1.5">
                      {summary.key_decisions.map((dec, i) => (
                        <div
                          key={i}
                          className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-emerald-200 text-xs flex items-start gap-2"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{dec}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Items Checklist */}
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ListTodo className="w-4 h-4 text-amber-400" />
                <span>Action Items ({meeting.action_items.length})</span>
              </div>
            </div>

            {meeting.action_items.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                No action items detected in this meeting.
              </p>
            ) : (
              <div className="space-y-2.5">
                {meeting.action_items.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded border border-slate-600 mt-0.5 flex items-center justify-center shrink-0">
                        {item.completed && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      </div>
                      <p className="text-sm font-medium text-slate-200 leading-snug">{item.task}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs pl-6">
                      <span className="flex items-center gap-1 text-slate-300">
                        <User className="w-3 h-3 text-indigo-400" />
                        {item.owner ? (
                          <span className="font-medium text-indigo-300">{item.owner}</span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </span>
                      {item.due_date && (
                        <span className="flex items-center gap-1 text-amber-300">
                          <Calendar className="w-3 h-3 text-amber-400" />
                          <span>{item.due_date}</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MeetingDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <p className="text-sm">Loading meeting...</p>
        </div>
      }
    >
      <MeetingDetailInner />
    </Suspense>
  );
}
