"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { 
  Upload, 
  FileAudio, 
  CheckCircle2, 
  Clock, 
  Sparkles, 
  ListTodo, 
  ArrowRight, 
  AlertCircle, 
  Loader2, 
  RefreshCw 
} from "lucide-react";
import { 
  getMeetings, 
  uploadAudio, 
  MeetingSummary, 
  formatDuration, 
  formatDate 
} from "@/lib/api";

export default function DashboardPage() {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    try {
      setError(null);
      const data = await getMeetings();
      setMeetings(data);
    } catch (err: any) {
      setError(err.message || "Failed to connect to backend server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Compute stats
  const totalMeetings = meetings.length;
  const completedMeetings = meetings.filter((m) => m.status === "completed").length;
  const totalDuration = meetings.reduce((acc, m) => acc + (m.duration_seconds || 0), 0);
  const totalActionItems = meetings.reduce((acc, m) => acc + (m.action_item_count || 0), 0);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    setUploadError(null);
    const allowed = [".mp3", ".wav", ".m4a", ".webm"];
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!allowed.includes(ext)) {
      setUploadError(`Unsupported format "${ext}". Allowed formats: MP3, WAV, M4A, WebM.`);
      return;
    }
    setSelectedFile(file);
    if (!customTitle) {
      setCustomTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress("Uploading recording & running faster-whisper speech transcription...");

    try {
      await uploadAudio(selectedFile, customTitle.trim() || undefined);
      setSelectedFile(null);
      setCustomTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadProgress(null);
      await loadData();
    } catch (err: any) {
      setUploadError(err.message || "Audio upload & transcription failed.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            Meeting Intelligence Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Transcribe, summarize, and query all your discussions privately on your laptop.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-850 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Backend connection alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Backend Connection Issue</p>
            <p className="text-xs text-rose-300/80 mt-0.5">{error}</p>
            <p className="text-xs text-rose-300/60 mt-1">
              Make sure your FastAPI server is running at <code className="bg-rose-900/40 px-1 py-0.5 rounded">http://localhost:8000</code>.
            </p>
          </div>
        </div>
      )}

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Meetings */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Total Meetings</p>
            <p className="text-2xl font-bold text-white mt-1">{loading ? "..." : totalMeetings}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <FileAudio className="w-5 h-5" />
          </div>
        </div>

        {/* Completed Transcriptions */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Transcribed</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{loading ? "..." : completedMeetings}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        {/* Audio Processed */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Audio Time</p>
            <p className="text-2xl font-bold text-white mt-1">{loading ? "..." : formatDuration(totalDuration)}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* Action Items Identified */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Action Items</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{loading ? "..." : totalActionItems}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <ListTodo className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main Grid: Upload Area & Recent Meetings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 1-col: Audio Upload Card */}
        <div className="lg:col-span-1 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-indigo-400" />
              <h2 className="text-base font-semibold text-white">Upload Meeting Recording</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Upload MP3, WAV, M4A, or WebM. Transcription runs locally using <span className="text-indigo-400 font-mono">faster-whisper</span>.
            </p>

            {/* Drag & Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                isDragOver
                  ? "border-indigo-500 bg-indigo-500/5"
                  : selectedFile
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-slate-800 hover:border-slate-700 bg-slate-950/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.m4a,.webm,audio/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              {selectedFile ? (
                <div className="space-y-1">
                  <FileAudio className="w-8 h-8 text-emerald-400 mx-auto" />
                  <p className="text-sm font-medium text-slate-200 truncate max-w-[220px] mx-auto">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-full bg-slate-800/80 flex items-center justify-center mx-auto text-slate-400">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-xs text-slate-300 font-medium">
                    Click to browse or drop audio here
                  </p>
                  <p className="text-[11px] text-slate-400">Up to 100 MB</p>
                </div>
              )}
            </div>

            {/* Custom Title Input */}
            {selectedFile && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Meeting Title</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. Q4 Strategy Review"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {/* Error message */}
            {uploadError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/40 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Progress status */}
            {uploadProgress && (
              <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-800/40 text-xs text-indigo-300 flex items-center gap-2">
                <Loader2 className="w-4 h-4 shrink-0 animate-spin text-indigo-400" />
                <span>{uploadProgress}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-md ${
                !selectedFile || uploading
                  ? "bg-slate-800 text-slate-400 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20"
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Transcribing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Start Transcription
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right 2-col: Recent Meetings */}
        <div className="lg:col-span-2 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Recent Meetings</h2>
              <Link
                href="/meetings"
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
              >
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                <p className="text-xs">Loading meetings...</p>
              </div>
            ) : meetings.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                <FileAudio className="w-10 h-10 text-slate-400 mx-auto" />
                <p className="text-sm font-medium text-slate-300">No meetings recorded yet</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Upload an audio file on the left to transcribe and extract summaries & action items.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {meetings.slice(0, 5).map((meeting) => (
                  <Link
                    key={meeting.id}
                    href={`/meetings/${meeting.id}`}
                    className="block py-3.5 px-3 -mx-3 rounded-xl hover:bg-slate-850/60 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-200 group-hover:text-indigo-300 truncate">
                            {meeting.title}
                          </p>
                          <span
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
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
                          <span>{formatDate(meeting.created_at)}</span>
                          <span>•</span>
                          <span>{formatDuration(meeting.duration_seconds)}</span>
                          {meeting.action_item_count > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-amber-400 flex items-center gap-1">
                                <ListTodo className="w-3.5 h-3.5" />
                                {meeting.action_item_count} tasks
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
