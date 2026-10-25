"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { 
  FolderKanban, 
  Search, 
  Clock, 
  ListTodo, 
  Loader2, 
  FileText, 
  Calendar,
  Play
} from "lucide-react";
import { 
  getMeetings, 
  searchTranscripts, 
  MeetingSummary, 
  SearchResult, 
  formatDuration, 
  formatDate, 
  formatTimestamp 
} from "@/lib/api";

type StatusFilter = "all" | "completed" | "processing";

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const data = await getMeetings();
        if (!ignore) {
          setMeetings(data);
        }
      } catch (err: unknown) {
        if (!ignore) {
          const msg = err instanceof Error ? err.message : "Failed to load meetings.";
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
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchTranscripts(searchQuery.trim());
      setSearchResults(results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Search failed.";
      setError(msg);
    } finally {
      setSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
  };

  // Filter meetings by status and local text match
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [meetings, statusFilter]);

  const totalDuration = useMemo(() => {
    return meetings.reduce((acc, m) => acc + (m.duration_seconds || 0), 0);
  }, [meetings]);

  const totalTasks = useMemo(() => {
    return meetings.reduce((acc, m) => acc + (m.action_item_count || 0), 0);
  }, [meetings]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <FolderKanban className="w-6 h-6 text-indigo-400" />
            Meetings & Transcripts
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse indexed meetings or perform full-text search across all transcripts with SQLite FTS5.
          </p>
        </div>

        {/* Global FTS5 Search Input */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-md w-full">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search words across all meeting transcripts..."
              className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shrink-0 flex items-center gap-1.5"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors shrink-0"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Quick Summary Pill Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-xs">
        <div className="flex flex-wrap items-center gap-6 text-slate-300">
          <div>
            <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold block">Total Recorded</span>
            <span className="text-sm font-bold text-white">{meetings.length} meeting{meetings.length === 1 ? "" : "s"}</span>
          </div>
          <div className="h-6 w-px bg-slate-800 hidden sm:block" />
          <div>
            <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold block">Total Duration</span>
            <span className="text-sm font-bold text-indigo-400">{formatDuration(totalDuration)}</span>
          </div>
          <div className="h-6 w-px bg-slate-800 hidden sm:block" />
          <div>
            <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold block">Action Items</span>
            <span className="text-sm font-bold text-amber-400">{totalTasks} tasks</span>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800/80">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === "all"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All ({meetings.length})
          </button>
          <button
            onClick={() => setStatusFilter("completed")}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === "completed"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Completed
          </button>
          <button
            onClick={() => setStatusFilter("processing")}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === "processing"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Processing
          </button>
        </div>
      </div>

      {/* Search Results Section */}
      {searchQuery && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              FTS5 Search Results ({searchResults.length})
            </h2>
            <span className="text-xs text-indigo-400 font-mono">
              Matching: &ldquo;{searchQuery}&rdquo;
            </span>
          </div>

          {searching ? (
            <div className="py-12 flex justify-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center rounded-2xl border border-slate-800 bg-slate-900/40 text-slate-400 text-sm">
              No matching transcripts found for &ldquo;{searchQuery}&rdquo;. Try another keyword or phrase.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {searchResults.map((res, idx) => (
                <Link
                  key={`${res.meeting_id}-${res.segment_id}-${idx}`}
                  href={`/meetings/${res.meeting_id}`}
                  className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition-all group block space-y-1.5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-400 group-hover:underline flex items-center gap-1.5">
                      <Play className="w-3 h-3 text-indigo-400" />
                      {res.meeting_title}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {formatTimestamp(res.start_time)} - {formatTimestamp(res.end_time)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed line-clamp-2">
                    &ldquo;{res.text}&rdquo;
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* All Meetings List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            {statusFilter === "all" ? "All Recorded Meetings" : `${statusFilter.toUpperCase()} Meetings`} ({filteredMeetings.length})
          </h2>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="h-44 rounded-2xl bg-slate-950/40 border border-slate-800/60 animate-pulse" />
            ))}
          </div>
        ) : filteredMeetings.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-slate-800/80 rounded-2xl space-y-3 bg-slate-950/40">
            <FileText className="w-12 h-12 text-slate-500 mx-auto" />
            <p className="text-base font-semibold text-slate-200">
              {meetings.length === 0 ? "No meetings recorded yet" : "No meetings match the active filter"}
            </p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {meetings.length === 0
                ? "Return to the dashboard to upload your first audio recording."
                : "Try switching the status filter to 'All' to see all recorded sessions."}
            </p>
            {meetings.length === 0 && (
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20"
              >
                Go to Dashboard
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMeetings.map((meeting) => (
              <Link
                key={meeting.id}
                href={`/meetings/${meeting.id}`}
                className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 hover:border-indigo-500/40 hover:bg-slate-900 transition-all flex flex-col justify-between group space-y-4 shadow-sm"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-100 group-hover:text-indigo-300 line-clamp-1 transition-colors">
                      {meeting.title}
                    </h3>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                        meeting.status === "completed"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : meeting.status === "processing"
                          ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      {meeting.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      {formatDuration(meeting.duration_seconds)}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      {meeting.segment_count} segments
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    {formatDate(meeting.created_at)}
                  </span>
                  {meeting.action_item_count > 0 && (
                    <span className="text-amber-400 font-medium flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                      <ListTodo className="w-3.5 h-3.5" />
                      {meeting.action_item_count} tasks
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
