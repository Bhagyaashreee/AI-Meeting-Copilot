import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import (
    OLLAMA_MODEL,
    WHISPER_MODEL,
    WHISPER_COMPUTE_TYPE,
    WHISPER_ENABLED,
    CORS_ORIGINS,
    CORS_ORIGIN_REGEX,
)
from app.db import init_db, check_db_health
from app.services.llm import llm_service
from app.routers.meetings import router as meetings_router
from app.routers.chat import router as chat_router
from app.routers.live import router as live_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure SQLite DB and tables exist
    logger.info("Initializing database...")
    try:
        init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.error(f"Error during database initialization: {e}", exc_info=True)
    yield
    # Shutdown
    logger.info("Shutting down AI Meeting Copilot API...")

app = FastAPI(
    title="AI Meeting Copilot API",
    description="Production backend API for speech transcription, Ollama/cloud meeting summarization, and transcript search.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for local and production Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX if CORS_ORIGIN_REGEX else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(meetings_router)
app.include_router(chat_router)
app.include_router(live_router)

@app.get("/api/health")
async def health_check():
    db_ok = check_db_health()
    llm_info = llm_service.get_info()

    if llm_info["provider"] == "ollama":
        llm_desc = f"Ollama ({OLLAMA_MODEL})"
    else:
        llm_desc = f"{llm_info['provider'].capitalize()} ({llm_info['model']}) [Ollama fallback supported]"

    stt_desc = f"faster-whisper ({WHISPER_MODEL}, {WHISPER_COMPUTE_TYPE})" if WHISPER_ENABLED else "faster-whisper (disabled)"

    return {
        "status": "healthy" if db_ok else "degraded",
        "app": "AI Meeting Copilot API",
        "version": "1.0.0",
        "database": "connected" if db_ok else "unavailable",
        "llm_provider": llm_info["provider"],
        "whisper_enabled": WHISPER_ENABLED,
        "engine": {
            "stt": stt_desc,
            "llm": llm_desc,
            "database": "SQLite + FTS5"
        }
    }
