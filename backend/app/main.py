import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db import init_db
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
    init_db()
    logger.info("Database initialized successfully.")
    yield
    # Shutdown
    logger.info("Shutting down AI Meeting Copilot API...")

app = FastAPI(
    title="AI Meeting Copilot API",
    description="Local backend API for speech transcription, Ollama meeting summarization, and transcript search.",
    version="0.3.0",
    lifespan=lifespan
)

import os
from app.config import OLLAMA_MODEL

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

# Enable CORS for local and production Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in cors_origins if origin.strip()],
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
    return {
        "status": "healthy",
        "app": "AI Meeting Copilot API",
        "version": "1.0.0",
        "engine": {
            "stt": "faster-whisper (base, int8)",
            "llm": f"Ollama ({OLLAMA_MODEL})",
            "database": "SQLite + FTS5"
        }
    }
