# AI Meeting Copilot & Conversational Voice Assistant

An intelligent, private, and fully local voice assistant and meeting copilot. Built with **Next.js**, **FastAPI**, **faster-whisper**, and **Ollama (`llama3.2:3b`)**, it delivers natural hands-free voice dialogue alongside grounded meeting intelligence with zero cloud dependencies or paid APIs.

---

## Architecture Overview

```
               ┌────────────────────────────────────────────────────────┐
               │                  Next.js 16 (React 19)                 │
               │  - Continuous Voice Session Engine & VAD               │
               │  - Browser SpeechSynthesis (TTS) + Echo Prevention     │
               │  - General Assistant & Meeting Assistant Dual Modes    │
               │  - Live Audio Streamer (WebSocket) & Transcript UI     │
               └───────────────────────────┬────────────────────────────┘
                                           │ HTTP / WebSocket (:8000)
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │                    FastAPI Backend                     │
               │  - Dual-Mode Router (/api/chat, /api/chat/voice)       │
               │  - Live Streaming WebSocket (/api/live/ws)             │
               │  - Meeting Management & Summary Pipelines              │
               └───────────────┬─────────────────────────┬──────────────┘
                               │                         │
             ┌─────────────────┴────────┐       ┌────────┴────────────────┐
             │                          │       │                         │
             ▼                          ▼       ▼                         ▼
┌─────────────────────────┐  ┌──────────────────┐  ┌────────────────────────┐
│      faster-whisper     │  │   SQLite + FTS5  │  │      Local Ollama      │
│  - Real-time VAD filter │  │  - Transcripts   │  │  - Model: llama3.2:3b  │
│  - int8 CPU compute     │  │  - Action Items  │  │  - Multi-turn Memory   │
│  - Zero cloud latency   │  │  - Full-Text BM25│  │  - Grounded RAG + Chat │
└─────────────────────────┘  └──────────────────┘  └────────────────────────┘
```

### Key Components

- **Frontend**: Next.js 16 (App Router), TypeScript, Tailwind CSS, Lucide icons, Web Audio API (AnalyserNode VAD), and browser `speechSynthesis`.
- **Backend**: FastAPI, Uvicorn, Python 3.10+ (tested on Python 3.12).
- **Speech Recognition**: `faster-whisper` (CTranslate2 `base` model with `int8` CPU quantization and Silero VAD filtering).
- **Local Language Model**: Ollama running `llama3.2:3b` locally (no API keys, no subscriptions, 100% private).
- **Database & Search**: SQLite with FTS5 (Full-Text Search) for BM25 ranking, transcript citation matching, and action item tracking.

---

## Features

### 1. Dual Conversation Modes
- **General Conversation (Default)**:
  - Personal AI voice assistant for natural greetings (*"Hi, can you hear me?"*), casual discussion, general questions, and multi-turn follow-ups.
  - Conversational system prompt produces concise, natural spoken English free of markdown symbols or headers.
  - Multi-turn memory retains conversation context across questions.
  - If asked about specific meeting details while in this mode, it politely advises switching to Meeting Assistant mode.
- **Meeting Assistant**:
  - Evidence-grounded meeting intelligence backed by SQLite FTS5 transcript search.
  - Strict anti-hallucination prompts requiring exact meeting title and timestamp citations (e.g. *Sprint Planning at 02:15*).
  - Meeting scope filtering across all past meetings or a specific recording.

### 2. Continuous Hands-Free Voice Conversation
- **Start Voice Conversation**:
  - Initiates an automated conversational loop with real-time state feedback:
    - **Listening**: Microphone active with live audio volume meter. Automatic silence detection (VAD) detects natural speech completion (~1.3s pause) and submits turns automatically.
    - **Thinking**: Real-time indication while faster-whisper transcribes audio and Ollama generates responses.
    - **Speaking**: Automatic playback via browser `speechSynthesis`.
    - **Paused**: User-controlled session pause.
- **Echo-Prevention Guarantee**:
  - Microphone capture and MediaRecorder are completely closed/stopped during speech playback. Only after audio playback finishes (plus an acoustic silence buffer) does listening automatically resume.
- **Controls & Fallbacks**:
  - In-session controls: **Pause**, **Resume**, **Done Speaking**, **Stop Speaking**, and **End Voice Session**.
  - Push-to-talk mic button at the input bar for one-off voice queries.

### 3. Meeting Intelligence & Productivity
- **Live Meeting Recording**: WebSocket-streamed live microphone transcription with real-time partial segment updates and resilient background finalization.
- **Audio Uploads**: Drag-and-drop support for `.mp3`, `.wav`, `.m4a`, `.webm`, and `.ogg` files up to 100 MB.
- **AI Meeting Summaries**: Executive summary, key discussion points, major decisions, and extracted action items with owner and due date tagging.
- **FTS5 Transcript Search**: Sub-millisecond full-text search across all recorded transcripts.

---

## Windows Prerequisites & Setup

### 1. Prerequisites
- **Operating System**: Windows 10 or 11 (64-bit).
- **Python**: Version 3.10, 3.11, or 3.12 (ensure *"Add Python to PATH"* is checked during installation).
- **Node.js**: Version 18.x or 20.x LTS.
- **Ollama**: Download and install from [ollama.com](https://ollama.com).

### 2. Ollama Model Setup
Start Ollama and pull the required 3-billion-parameter local model:

```powershell
ollama pull llama3.2:3b
```

Verify that Ollama is responding:
```powershell
curl http://localhost:11434/api/tags
```

---

## Installation & Running Locally

### Step 1: Clone Repository
```powershell
git clone <repository-url>
cd AI-Meeting-Copilot
```

### Step 2: Backend Setup
Open a PowerShell terminal:

```powershell
cd backend

# Create Python virtual environment
python -m venv .venv

# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Install required dependencies
pip install -r requirements.txt

# Copy environment configuration
Copy-Item .env.example .env

# Initialize local SQLite database
python -c "from app.db import init_db; init_db()"

# Start FastAPI backend server
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The backend API will be available at `http://localhost:8000` with interactive docs at `http://localhost:8000/docs`.

### Step 3: Frontend Setup
Open a second PowerShell terminal:

```powershell
cd frontend

# Copy environment configuration
Copy-Item .env.example .env.local

# Install Node dependencies
npm install

# Start Next.js development server
npm run dev
```

Open your browser and navigate to **`http://localhost:3000`** (or **`http://localhost:3000/copilot`** for the voice assistant).

---

## Running the Automated Test Suites

All backend tests run against the local Ollama and faster-whisper instances:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1

# 1. Test Conversational Assistant (Greetings, general chat, memory, RAG, voice endpoints)
python test_conversational_assistant.py

# 2. Test Voice Chat & Edge Cases (Audio transcription, scope filtering, error handling)
python test_voice_chat.py

# 3. Test Stage 1: Basic Health & Dependency Checks
python test_stage1.py

# 4. Test Stage 2: Audio Upload, Transcription & SQLite FTS5 Indexing
python test_stage2.py

# 5. Test Stage 3: Summaries, Decisions, Action Items & Grounded Cross-Meeting Q&A
python test_stage3.py

# 6. Test Stage 5: Live Streaming WebSocket & Audio Persistence
python test_stage5.py

# 7. Test Stage 5 Finalization: Abrupt Disconnects & Resilience
python test_stage5_finalization.py
```

### Frontend Production Build Test
Verify that the Next.js frontend builds cleanly without TypeScript or packaging errors:

```powershell
cd frontend
npm run build
```

---

## Browser Voice Permissions & Settings

1. **Microphone Access**:
   - When launching **Start Voice Conversation** or clicking **Mic**, click **Allow** when the browser prompts for microphone permissions.
   - In Chrome or Edge, click the tune/lock icon in the address bar to verify that Microphone permissions are set to *"Allow"*.
2. **Audio Output / Text-to-Speech**:
   - Ensure system audio is unmuted.
   - Click the **Test Voice** button in the header at any time to verify that browser speech synthesis is playing correctly.
   - Toggle **Voice Out: On / Off** to enable or mute automatic response reading.

---

## Production Deployment Architecture

> [!IMPORTANT]
> **This application cannot be hosted purely as a static website or on serverless frontend platforms (such as Vercel) alone.**
>
> The backend relies on:
> 1. A persistent Python runtime running `faster-whisper` (CTranslate2) with local CPU/GPU access.
> 2. The local **Ollama** service running `llama3.2:3b`.
> 3. An SQLite database with full-text search (`meetings.db`).
> 4. Persistent filesystem storage for audio recordings (`backend/data/audio/`).
> 5. WebSocket connections for real-time live recording (`/api/live/ws`).

### Recommended Deployment Options

#### Option A: Dedicated Linux VPS / Cloud VM (Docker or Systemd)
- **Minimum Requirements**: 4 vCPUs, 16 GB RAM (for concurrent Whisper and Ollama CPU inference), 50 GB SSD.
- **Backend Setup**:
  1. Install Ollama on the server and run `ollama serve`.
  2. Run the FastAPI backend using `uvicorn app.main:app --workers 2 --host 0.0.0.0 --port 8000`.
  3. Reverse-proxy port 8000 through Nginx or Caddy with WebSocket upgrade headers enabled (`Upgrade $http_upgrade`, `Connection "upgrade"`).
- **Frontend Setup**:
  1. Set `NEXT_PUBLIC_API_URL=https://api.yourdomain.com` in `frontend/.env.production`.
  2. Run `npm run build` and `npm run start` (or host via Node / PM2 / Docker).

#### Option B: Local Network / Homelab Deployment
- Run both servers on a local workstation or home server.
- Bind FastAPI to `0.0.0.0` to allow devices on your local network to connect.

---

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| **`ConnectionError: Could not connect to Ollama`** | Ollama is not running on port 11434. | Open terminal and run `ollama serve`. Verify with `curl http://localhost:11434/api/tags`. |
| **`Model 'llama3.2:3b' not found`** | The required model has not been downloaded. | Run `ollama pull llama3.2:3b` in your terminal. |
| **Microphone error: PermissionDeniedError** | Browser blocked microphone access. | Click the permissions icon in the browser address bar and set Microphone to "Allow". |
| **Speech synthesis not speaking** | Browser audio muted or voices still loading. | Click **Test Voice** in the header. Ensure system audio output is selected. |
| **`faster-whisper` download failure** | First-time model download interrupted. | Faster-whisper downloads the `base` model from Hugging Face on first run. Ensure active internet connection during initial transcription. |
| **WebSocket disconnects immediately on Live Recording** | Title contains unencoded special characters or port 8000 blocked. | Ensure backend is running and `NEXT_PUBLIC_API_URL` correctly points to `http://localhost:8000`. |

---

## Security & Privacy Notice

- **100% On-Device Processing**: Transcripts, meeting audio, and conversational prompts are processed locally by faster-whisper and Ollama. No user audio or text is sent to third-party AI APIs.
- **Git Hygiene**: Pre-configured `.gitignore` files exclude all `.venv`, `node_modules`, SQLite databases (`*.db`, `*.sqlite`), and user audio recordings (`data/audio/*`).
