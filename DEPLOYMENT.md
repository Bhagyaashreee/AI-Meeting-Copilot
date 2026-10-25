# Deployment Guide: AI Meeting Copilot on Render & Vercel

This guide explains how to deploy **AI Meeting Copilot** with a publicly accessible **FastAPI backend on Render** and a **Next.js frontend on Vercel**, while preserving local development defaults.

---

## Architecture Overview

```
┌─────────────────────────────────┐           ┌───────────────────────────────────┐
│         Vercel (Frontend)       │           │          Render (Backend)         │
│  Next.js 16 / React 19 / TS     │  HTTPS    │  FastAPI + Uvicorn                │
│  https://your-app.vercel.app    ├──────────►│  https://your-api.onrender.com    │
│                                 │  WSS (WS) │                                   │
└─────────────────────────────────┘           └─────────────────┬─────────────────┘
                                                                │
                                              ┌─────────────────┴─────────────────┐
                                              │    Ephemeral Local Storage        │
                                              │  • SQLite: backend/data/meetings  │
                                              │  • Audio:  backend/data/audio     │
                                              └─────────────────┬─────────────────┘
                                                                │
                                        ┌───────────────────────┴───────────────────────┐
                                        │                                               │
                                        ▼                                               ▼
                         Local Development:                              Production on Render Free Tier:
                         • Ollama on localhost:11434                     • Cloud LLM: Groq (Llama-3.1-8b, Free)
                         • faster-whisper (base model)                   • faster-whisper (tiny model / disabled)
```

---

## Hosting Realities & Constraints (Render Free Tier)

| Component | Local Development | Render Free Tier (512 MB RAM) | Recommended Production Strategy |
| :--- | :--- | :--- | :--- |
| **RAM** | System RAM (8–32 GB) | **512 MB hard cap** | Use `WHISPER_MODEL=tiny` or cloud inference |
| **LLM Inference** | Ollama (`llama3.2:3b`) on `localhost:11434` | **Ollama cannot run** (needs >2.5 GB RAM; Render cannot reach laptop `localhost`) | Set `GROQ_API_KEY` for free cloud Llama 3 inference, or point `OLLAMA_BASE_URL` to an external host |
| **Whisper STT** | `faster-whisper` (`base` model, int8) | `base` model (~500 MB) risks OOM crashes (Exit 137) | Set `WHISPER_MODEL=tiny` (~200 MB) or `WHISPER_ENABLED=false` |
| **Storage / DB** | Persistent on disk (`meetings.db`) | **Ephemeral filesystem** (resets on restart/spin-down) | For long-term persistence, connect managed PostgreSQL (Supabase/Neon) or persistent disk |
| **Cold Starts** | None (instant) | Free instances spin down after 15 min of inactivity (takes 30–60s to wake up) | Frontend displays friendly connection warning if backend is spinning up |

---

## Part 1: Deploy Backend on Render

### Step 1: Create a Web Service on Render
1. Log in to [dashboard.render.com](https://dashboard.render.com).
2. Click **New +** → **Web Service**.
3. Connect your GitHub repository: `https://github.com/Bhagyaashreee/AI-Meeting-Copilot`.
4. Select the branch: `feature/portfolio-upgrade` (or `main` after merging).

### Step 2: Configure Service Settings
Fill in the configuration fields:
- **Name**: `ai-meeting-copilot-api` (or your preferred name)
- **Region**: Oregon (US West) or Ohio (US East)
- **Branch**: `feature/portfolio-upgrade`
- **Root Directory**: `backend`
- **Runtime**: `Python 3`
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Plan Type**: `Free`

*(Alternatively, click **New +** → **Blueprint** and select `render.yaml` in the root of this repository).*

### Step 3: Configure Environment Variables
Under the **Environment Variables** tab, add:

| Key | Recommended Value | Description |
| :--- | :--- | :--- |
| `PYTHON_VERSION` | `3.11.9` | Ensures compatible Python runtime with faster-whisper wheels. |
| `ENVIRONMENT` | `production` | Enables production mode. |
| `CORS_ORIGINS` | `http://localhost:3000` | Local origin. You can also append your Vercel URL once deployed. |
| `CORS_ORIGIN_REGEX` | `^https://.*\.vercel\.app$` | Dynamically permits all Vercel production and preview URLs. |
| `WHISPER_MODEL` | `tiny` | Uses the lightweight model to stay within 512 MB RAM. |
| `WHISPER_ENABLED` | `true` | Set to `false` if running purely as an API and transcript search server. |
| `WHISPER_THREADS` | `2` | CPU thread allocation for free instance. |
| `GROQ_API_KEY` | *(Optional, Recommended)* `gsk_...` | Free cloud LLM key from [console.groq.com](https://console.groq.com). Delivers blazing fast Llama 3 summaries and chat with 0 RAM usage on Render. |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | High-quality free cloud model. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Fallback URL (used if Groq is not set and an external Ollama is provided). |

### Step 4: Verify Backend Health
Once Render completes building, copy your service URL (e.g. `https://ai-meeting-copilot-api.onrender.com`).
Test it in your browser or terminal:
```bash
curl https://ai-meeting-copilot-api.onrender.com/api/health
```
Expected response:
```json
{
  "status": "healthy",
  "app": "AI Meeting Copilot API",
  "version": "1.0.0",
  "database": "connected",
  "llm_provider": "groq",
  "whisper_enabled": true,
  "engine": {
    "stt": "faster-whisper (tiny, int8)",
    "llm": "Groq (llama-3.1-8b-instant) [Ollama fallback supported]",
    "database": "SQLite + FTS5"
  }
}
```

---

## Part 2: Deploy Frontend on Vercel

### Step 1: Import Project to Vercel
1. Log in to [vercel.com](https://vercel.com).
2. Click **Add New...** → **Project**.
3. Import `Bhagyaashreee/AI-Meeting-Copilot`.
4. Select branch: `feature/portfolio-upgrade` (or `main`).

### Step 2: Configure Project Settings
- **Framework Preset**: `Next.js`
- **Root Directory**: Click **Edit** and choose `frontend`.
- **Build Command**: `npm run build` (default)
- **Output Directory**: `.next` (default)
- **Install Command**: `npm install` (default)

### Step 3: Add Environment Variables
Under **Environment Variables**, add:

| Key | Value | Notes |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | `https://ai-meeting-copilot-api.onrender.com` | Use your exact Render URL (no trailing slash). |

### Step 4: Deploy & Verify
1. Click **Deploy**.
2. Once deployed, open your Vercel URL (e.g. `https://ai-meeting-copilot-frontend.vercel.app`).
3. The dashboard will automatically connect to your Render backend via HTTPS.
4. Live meetings will connect securely via WebSockets using `wss://`.

---

## Part 3: Local Development (Unchanged)

Local development continues to work seamlessly with local Ollama and Whisper:

### Backend:
```bash
cd backend
.venv\Scripts\activate   # Windows
# or source .venv/bin/activate on Linux/Mac
uvicorn app.main:app --reload --port 8000
```
- Uses local `http://localhost:11434` for Ollama (`llama3.2:3b`).
- Uses local `base` model for `faster-whisper`.
- Stores data in `backend/data/meetings.db`.

### Frontend:
```bash
cd frontend
npm run dev
```
- Connects to `http://localhost:8000` via `.env.local`.
