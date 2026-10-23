"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { 
  FolderKanban, 
  Search, 
  Clock, 
  ListTodo, 
  ArrowRight, 
  Loader2, 
  FileText, 
  Calendar 
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

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMeetings = async () => {
    try {
      setError(null);
      const data = await getMeetings();
      setMeetings(data);
    } catch (err: any) {
      setError(err.message || "Failed to load meetings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeetings();
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
    } catch (err: any) {
      setError(err.message || "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <FolderKanban className="w-6 h-6 text-indigo-400" />
            Meetings & Transcripts
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse all meetings or search through full transcripts with SQLite FTS5.
          </p>
        </div>

        {/* Search Bar Form */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-md w-full">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search words across all transcripts..."
              className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shrink-0"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors shrink-0"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Search Results Section */}
      {searchQuery && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Search Results ({searchResults.length})
            </h2>
            <span className="text-xs text-slate-400">Query: &ldquo;{searchQuery}&rdquo;</span>
          </div>

          {searching ? (
            <div className="py-12 flex justify-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400 text-sm">
              No matching transcripts found for &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {searchResults.map((res, idx) => (
                <Link
                  key={`${res.meeting_id}-${res.segment_id}-${idx}`}
                  href={`/meetings/${res.meeting_id}`}
                  className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 transition-colors group block space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-400 group-hover:underline">
                      {res.meeting_title}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {formatTimestamp(res.start_time)} - {formatTimestamp(res.end_time)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 line-clamp-2">
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          All Recorded Meetings ({meetings.length})
        </h2>

        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            <p className="text-xs">Loading meetings...</p>
          </div>
        ) : meetings.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-slate-800 rounded-2xl space-y-3 bg-slate-950/40">
            <FileText className="w-12 h-12 text-slate-400 mx-auto" />
            <p className="text-base font-semibold text-slate-200">No meetings recorded yet</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Return to the dashboard to upload your first audio file.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {meetings.map((meeting) => (
              <Link
                key={meeting.id}
                href={`/meetings/${meeting.id}`}
                className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-900 transition-all flex flex-col justify-between group space-y-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-100 group-hover:text-indigo-300 line-clamp-1">
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
                      <Clock className="w-3.5 h-3.5" />
                      {formatDuration(meeting.duration_seconds)}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" />
                      {meeting.segment_count} segments
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatDate(meeting.created_at)}
                  </span>
                  {meeting.action_item_count > 0 && (
                    <span className="text-amber-400 font-medium flex items-center gap-1">
                      <ListTodo className="w-3.5 h-3.5" />
                      {meeting.action_item_count}
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
