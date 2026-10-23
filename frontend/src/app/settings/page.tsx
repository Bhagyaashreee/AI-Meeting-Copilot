"use client";

import { useState, useEffect } from "react";
import { 
  Sliders, 
  ShieldCheck, 
  Cpu, 
  Database, 
  Server, 
  HardDrive, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw 
} from "lucide-react";
import { API_BASE } from "@/lib/api";

export default function SettingsPage() {
  const [backendHealth, setBackendHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const checkHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        setBackendHealth(await res.json());
      } else {
        setBackendHealth({ status: "error", error: `HTTP ${res.status}` });
      }
    } catch (e: any) {
      setBackendHealth({ status: "offline", error: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto w-full space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Sliders className="w-6 h-6 text-indigo-400" />
            System & Engine Settings
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Local architecture overview, models, and connection diagnostics.
          </p>
        </div>
        <button
          onClick={checkHealth}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Test Connection
        </button>
      </div>

      {/* Backend Status Card */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
          <Server className="w-4 h-4 text-indigo-400" />
          Backend API Service
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 space-y-1">
            <p className="text-slate-400">Endpoint URL</p>
            <p className="font-mono text-slate-200 text-sm">{API_BASE}</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 space-y-1">
            <p className="text-slate-400">API Status</p>
            {backendHealth?.status === "healthy" ? (
              <p className="text-emerald-400 font-semibold flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="w-4 h-4" /> Healthy ({backendHealth.version})
              </p>
            ) : (
              <p className="text-rose-400 font-semibold flex items-center gap-1.5 text-sm">
                <AlertCircle className="w-4 h-4" /> Disconnected
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Local Engines & Hardware Architecture */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
          <Cpu className="w-4 h-4 text-indigo-400" />
          Local AI Model Stack (₹0 Budget / Offline)
        </h2>

        <div className="space-y-3 text-xs">
          {/* Speech-to-text */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-200">faster-whisper (Base Model)</p>
              <p className="text-slate-400">
                CTranslate2 CPU inference with <span className="font-mono text-indigo-400">int8</span> quantization and VAD silence filtering.
              </p>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              Active / Local
            </span>
          </div>

          {/* Reasoning & Summaries */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-200">Ollama (Llama 3.2 3B)</p>
              <p className="text-slate-400">
                Handles executive summarization, key decision extraction, action item ownership, and grounded RAG Q&A.
              </p>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
              Active / Local
            </span>
          </div>

          {/* Database */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-200">SQLite + FTS5 Full-Text Search</p>
              <p className="text-slate-400">
                Local embedded database storing meetings, speech segments, and virtual search tables at <code className="bg-slate-900 px-1 py-0.5 rounded">backend/data/meetings.db</code>.
              </p>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
              Active / Local
            </span>
          </div>
        </div>
      </div>

      {/* Privacy & Zero-Cost Guarantee */}
      <div className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-800/30 text-xs text-emerald-300 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-sm text-emerald-400">
          <ShieldCheck className="w-5 h-5" />
          Strict Privacy Guarantee
        </div>
        <p className="leading-relaxed text-emerald-200/80">
          No meeting audio, transcripts, or queries are sent to OpenAI, Deepgram, or any external third-party server.
          All speech transcription and AI reasoning execute entirely inside your laptop hardware.
        </p>
      </div>
    </div>
  );
}
