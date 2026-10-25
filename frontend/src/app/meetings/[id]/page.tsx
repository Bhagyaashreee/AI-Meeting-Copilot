"use client";

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from "react";
import { useParams } from "next/navigation";
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
  BotMessageSquare,
  Mail,
  Download,
  Copy,
  Check,
  Search,
  CheckSquare,
  Square
} from "lucide-react";
import { 
  getMeeting, 
  summarizeMeeting, 
  getAudioUrl, 
  toggleActionItem,
  generateEmailDraft,
  MeetingDetail, 
  parseSummary, 
  formatDuration, 
  formatTimestamp, 
  formatDate,
  ActionItem
} from "@/lib/api";

function MeetingDetailInner() {
  const params = useParams();
  const meetingId = (params?.id as string) || "";

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);

  // Audio Playback
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // Transcript local search filter
  const [transcriptFilter, setTranscriptFilter] = useState("");

  // Email draft state
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Action items update state
  const [updatingItemId, setUpdatingItemId] = useState<number | null>(null);

  const loadMeetingDetails = useCallback(async () => {
    if (!meetingId) return;
    try {
      setError(null);
      const data = await getMeeting(meetingId);
      setMeeting(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load meeting details.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) return;
    let ignore = false;
    async function init() {
      try {
        const data = await getMeeting(meetingId);
        if (!ignore) {
          setMeeting(data);
        }
      } catch (err: unknown) {
        if (!ignore) {
          const msg = err instanceof Error ? err.message : "Failed to load meeting details.";
          setError(msg);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
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
      setSummaryMsg("Meeting summary and action items extracted with Llama 3.2 3B!");
      await loadMeetingDetails();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Summarization failed.";
      setError(msg);
    } finally {
      setSummarizing(false);
    }
  };

  // Toggle Action Item completion directly in SQLite
  const handleToggleActionItem = async (item: ActionItem) => {
    if (!item.id) return;
    setUpdatingItemId(item.id);
    const newStatus = !item.completed;
    try {
      const updated = await toggleActionItem(meetingId, item.id, newStatus);
      setMeeting((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          action_items: prev.action_items.map((ai) =>
            ai.id === item.id ? { ...ai, completed: updated.completed } : ai
          ),
        };
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update action item.";
      setError(msg);
    } finally {
      setUpdatingItemId(null);
    }
  };

  // Generate Follow-up Email draft
  const handleGenerateEmail = async () => {
    setGeneratingEmail(true);
    setError(null);
    try {
      const res = await generateEmailDraft(meetingId);
      setEmailDraft(res.email_draft);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate follow-up email.";
      setError(msg);
    } finally {
      setGeneratingEmail(false);
    }
  };

  const handleCopyEmail = () => {
    if (!emailDraft) return;
    navigator.clipboard.writeText(emailDraft);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  // Export summary to Markdown file
  const handleExportMarkdown = () => {
    if (!meeting) return;
    const summary = parseSummary(meeting.summary);
    let md = `# Meeting: ${meeting.title}\n`;
    md += `**Date:** ${formatDate(meeting.created_at)}\n`;
    md += `**Duration:** ${formatDuration(meeting.duration_seconds)}\n\n`;

    if (summary?.executive_summary) {
      md += `## Executive Summary\n${summary.executive_summary}\n\n`;
    }

    if (summary?.key_discussion_points && summary.key_discussion_points.length > 0) {
      md += `## Key Discussion Points\n`;
      summary.key_discussion_points.forEach((pt) => {
        md += `- ${pt}\n`;
      });
      md += `\n`;
    }

    if (summary?.key_decisions && summary.key_decisions.length > 0) {
      md += `## Key Decisions\n`;
      summary.key_decisions.forEach((dec) => {
        md += `- [x] ${dec}\n`;
      });
      md += `\n`;
    }

    if (meeting.action_items && meeting.action_items.length > 0) {
      md += `## Action Items\n`;
      meeting.action_items.forEach((ai) => {
        const check = ai.completed ? "[x]" : "[ ]";
        const owner = ai.owner ? ` (@${ai.owner})` : "";
        const due = ai.due_date ? ` [Due: ${ai.due_date}]` : "";
        md += `- ${check} ${ai.task}${owner}${due}\n`;
      });
      md += `\n`;
    }

    md += `## Transcript\n`;
    meeting.segments.forEach((seg) => {
      md += `**[${formatTimestamp(seg.start_time)} - ${formatTimestamp(seg.end_time)}]** ${seg.text}\n\n`;
    });

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${meeting.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_summary.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export action items to CSV
  const handleExportCSV = () => {
    if (!meeting || meeting.action_items.length === 0) return;
    let csv = "ID,Task,Owner,Due Date,Status\n";
    meeting.action_items.forEach((ai, idx) => {
      const cleanTask = `"${(ai.task || "").replace(/"/g, '""')}"`;
      const cleanOwner = `"${(ai.owner || "Unassigned").replace(/"/g, '""')}"`;
      const cleanDue = `"${(ai.due_date || "None").replace(/"/g, '""')}"`;
      const status = ai.completed ? "Completed" : "Pending";
      csv += `${ai.id || idx + 1},${cleanTask},${cleanOwner},${cleanDue},${status}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${meeting.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_action_items.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Filter transcript segments
  const filteredSegments = useMemo(() => {
    if (!meeting) return [];
    if (!transcriptFilter.trim()) return meeting.segments;
    const q = transcriptFilter.toLowerCase();
    return meeting.segments.filter((seg) => seg.text.toLowerCase().includes(q));
  }, [meeting, transcriptFilter]);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-sm">Loading meeting details...</p>
      </div>
    );
  }

  if (error && !meeting) {
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

  if (!meeting) return null;

  const summary = parseSummary(meeting.summary);
  const completedCount = meeting.action_items.filter((ai) => ai.completed).length;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Top Navigation & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Link
          href="/meetings"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to all meetings
        </Link>

        {/* Quick Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href={`/copilot?meeting_id=${meeting.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/25 text-xs font-semibold transition-colors shadow-sm"
          >
            <BotMessageSquare className="w-3.5 h-3.5 text-indigo-400" />
            Chat with Copilot
          </Link>
          <button
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            Export Markdown
          </button>
          {meeting.action_items.length > 0 && (
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              Export Tasks CSV
            </button>
          )}
        </div>
      </div>

      {/* Header Info Card */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
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
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-0.5">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                {formatDate(meeting.created_at)}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                {formatDuration(meeting.duration_seconds)}
              </span>
              <span>•</span>
              <span>{meeting.segments.length} speech segments</span>
              {meeting.action_items.length > 0 && (
                <>
                  <span>•</span>
                  <span className="text-amber-400 font-medium">
                    {completedCount} of {meeting.action_items.length} tasks completed
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={handleSummarize}
              disabled={summarizing || meeting.segments.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all"
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

            <button
              onClick={handleGenerateEmail}
              disabled={generatingEmail || (!meeting.summary && meeting.action_items.length === 0)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold transition-all"
            >
              {generatingEmail ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  Drafting Email...
                </>
              ) : (
                <>
                  <Mail className="w-3.5 h-3.5 text-indigo-400" />
                  Draft Follow-up Email
                </>
              )}
            </button>
          </div>
        </div>

        {/* Audio Player Bar */}
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
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{summaryMsg}</span>
        </div>
      )}

      {/* Generated Follow-up Email Modal / Card */}
      {emailDraft && (
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-indigo-500/40 space-y-3 animate-in fade-in duration-200 shadow-lg shadow-indigo-950/30">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Mail className="w-4 h-4 text-indigo-400" />
              <span>Follow-up Stakeholder Email Draft (Grounded in Transcript)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyEmail}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
              >
                {copiedEmail ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedEmail ? "Copied!" : "Copy Email"}
              </button>
              <button
                onClick={() => setEmailDraft(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1"
              >
                Close
              </button>
            </div>
          </div>
          <pre className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-72">
            {emailDraft}
          </pre>
        </div>
      )}

      {/* Main Grid: Interactive Transcript & AI Summary/Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (7 cols): Interactive Transcript */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex flex-col h-[740px] shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-slate-800/80 mb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <span>Transcript ({meeting.segments.length})</span>
              </div>

              {/* Local Transcript Filter Search */}
              <div className="relative max-w-xs w-full">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={transcriptFilter}
                  onChange={(e) => setTranscriptFilter(e.target.value)}
                  placeholder="Filter in transcript..."
                  className="w-full pl-8 pr-3 py-1 text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {meeting.segments.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
                No transcript segments available for this meeting.
              </div>
            ) : filteredSegments.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
                No segments match &ldquo;{transcriptFilter}&rdquo;.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                {filteredSegments.map((seg, idx) => {
                  const isCurrent =
                    currentTime >= seg.start_time && currentTime <= seg.end_time;

                  return (
                    <div
                      key={seg.id || idx}
                      className={`p-3.5 rounded-xl border transition-all text-sm ${
                        isCurrent
                          ? "bg-indigo-950/40 border-indigo-500/60 text-indigo-100 shadow-sm"
                          : "bg-slate-950/40 border-slate-800/60 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                        <button
                          onClick={() => handleSeek(seg.start_time)}
                          className="font-mono text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1.5 font-semibold"
                        >
                          <Play className="w-3 h-3" />
                          {formatTimestamp(seg.start_time)} - {formatTimestamp(seg.end_time)}
                        </button>
                        {seg.speaker && (
                          <span className="text-[11px] text-slate-400 font-medium bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
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
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 shadow-sm">
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
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs font-semibold hover:bg-indigo-600/30 transition-colors"
                >
                  Generate Summary Now
                </button>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Executive Summary */}
                {summary.executive_summary && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Executive Summary
                    </p>
                    <p className="text-slate-200 text-sm leading-relaxed p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/70">
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
                    <div className="space-y-2">
                      {summary.key_decisions.map((dec, i) => (
                        <div
                          key={i}
                          className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-800/30 text-emerald-200 text-xs flex items-start gap-2.5"
                        >
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <span className="leading-snug">{dec}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Items Checklist with Interactive SQLite Toggle */}
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ListTodo className="w-4 h-4 text-amber-400" />
                <span>Action Items ({meeting.action_items.length})</span>
              </div>
              {meeting.action_items.length > 0 && (
                <span className="text-[11px] text-slate-400 font-mono">
                  {completedCount}/{meeting.action_items.length} done
                </span>
              )}
            </div>

            {meeting.action_items.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                No action items detected in this meeting transcript.
              </p>
            ) : (
              <div className="space-y-2.5">
                {meeting.action_items.map((item, idx) => {
                  const isUpdating = updatingItemId === item.id;

                  return (
                    <div
                      key={item.id || idx}
                      onClick={() => handleToggleActionItem(item)}
                      className={`p-3.5 rounded-xl border space-y-2 cursor-pointer transition-all ${
                        item.completed
                          ? "bg-emerald-950/15 border-emerald-800/30 opacity-75"
                          : "bg-slate-950/60 border-slate-800/80 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          disabled={isUpdating}
                          className="mt-0.5 text-slate-400 hover:text-white shrink-0 focus:outline-none"
                        >
                          {isUpdating ? (
                            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                          ) : item.completed ? (
                            <CheckSquare className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 hover:text-slate-300" />
                          )}
                        </button>
                        <p
                          className={`text-sm leading-snug font-medium transition-all ${
                            item.completed
                              ? "text-slate-400 line-through"
                              : "text-slate-200"
                          }`}
                        >
                          {item.task}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs pl-7">
                        <span className="flex items-center gap-1 text-slate-300">
                          <User className="w-3 h-3 text-indigo-400" />
                          {item.owner ? (
                            <span className="font-medium text-indigo-300">{item.owner}</span>
                          ) : (
                            <span className="text-slate-500 italic">Unassigned</span>
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
                  );
                })}
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
