"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  Sliders, 
  ShieldCheck, 
  Cpu, 
  Server, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw,
  Activity
} from "lucide-react";
import { API_BASE } from "@/lib/api";

interface HealthData {
  status: string;
  app: string;
  version: string;
  engine?: {
    stt: string;
    llm: string;
    database: string;
  };
  error?: string;
  latencyMs?: number;
}

export default function SettingsPage() {
  const [backendHealth, setBackendHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
      const elapsed = Math.round(performance.now() - start);
      if (res.ok) {
        const data = await res.json();
        setBackendHealth({ ...data, latencyMs: elapsed });
      } else {
        setBackendHealth({
          status: "error",
          app: "AI Meeting Copilot",
          version: "unknown",
          error: `HTTP ${res.status}`,
          latencyMs: elapsed,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to reach backend";
      setBackendHealth({
        status: "offline",
        app: "AI Meeting Copilot",
        version: "offline",
        error: msg,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function init() {
      const start = performance.now();
      try {
        const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
        const elapsed = Math.round(performance.now() - start);
        if (!ignore) {
          if (res.ok) {
            const data = await res.json();
            setBackendHealth({ ...data, latencyMs: elapsed });
          } else {
            setBackendHealth({
              status: "error",
              app: "AI Meeting Copilot",
              version: "unknown",
              error: `HTTP ${res.status}`,
              latencyMs: elapsed,
            });
          }
        }
      } catch (e: unknown) {
        if (!ignore) {
          const msg = e instanceof Error ? e.message : "Failed to reach backend";
          setBackendHealth({
            status: "offline",
            app: "AI Meeting Copilot",
            version: "offline",
            error: msg,
          });
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

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Sliders className="w-6 h-6 text-indigo-400" />
            System Architecture & Settings
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Local engine health, model runtime diagnostics, and privacy verification.
          </p>
        </div>
        <button
          onClick={checkHealth}
          disabled={loading}
          aria-label="Test Connection"
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} />
          Test Connection
        </button>
      </div>

      {/* Backend API Service Card */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-400" />
            Backend API Service
          </h2>
          {backendHealth?.latencyMs !== undefined && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              {backendHealth.latencyMs}ms latency
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 space-y-1">
            <p className="text-slate-400">Endpoint URL</p>
            <p className="font-mono text-slate-200 text-sm">{API_BASE}</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 space-y-1">
            <p className="text-slate-400">Service Status</p>
            {backendHealth?.status === "healthy" ? (
              <p className="text-emerald-400 font-semibold flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="w-4 h-4" /> Healthy ({backendHealth.version})
              </p>
            ) : (
              <p className="text-rose-400 font-semibold flex items-center gap-1.5 text-sm">
                <AlertCircle className="w-4 h-4" /> Disconnected ({backendHealth?.error || "Offline"})
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Local AI Model Stack */}
      <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 shadow-sm">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
          <Cpu className="w-4 h-4 text-indigo-400" />
          Local AI Model Stack (Zero Cloud Dependencies)
        </h2>

        <div className="space-y-3 text-xs">
          {/* Speech-to-text */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-200">faster-whisper (Base Model)</p>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  CTranslate2 int8
                </span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Local CPU inference engine with Voice Activity Detection (VAD) silence filtering for speech transcription.
              </p>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800 shrink-0">
              Active / Local
            </span>
          </div>

          {/* Reasoning & Summaries */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-200">Ollama (Llama 3.2 3B)</p>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Native JSON Mode
                </span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Powers conversational voice dialogue, executive summaries, decision extraction, action item ownership, and grounded RAG Q&A.
              </p>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800 shrink-0">
              Active / Local
            </span>
          </div>

          {/* Database */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-200">SQLite + FTS5 Full-Text Search</p>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Embedded ACID
                </span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Local persistent storage for meetings, speech segments, action items, and virtual full-text search index at <code className="bg-slate-900 px-1 py-0.5 rounded font-mono text-slate-300">backend/data/meetings.db</code>.
              </p>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800 shrink-0">
              Active / Local
            </span>
          </div>
        </div>
      </div>

      {/* Strict Privacy Guarantee */}
      <div className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-800/30 text-xs text-emerald-300 space-y-2 shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-sm text-emerald-400">
          <ShieldCheck className="w-5 h-5 shrink-0" />
          Strict 100% Offline Privacy Guarantee
        </div>
        <p className="leading-relaxed text-emerald-200/80">
          No meeting audio, transcripts, summaries, or queries are ever sent to OpenAI, Deepgram, or any external third-party servers.
          All speech transcription, natural language reasoning, and vector search execute entirely on your device.
        </p>
      </div>
    </div>
  );
}
