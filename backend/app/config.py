import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
AUDIO_DIR = DATA_DIR / "audio"
DB_PATH = DATA_DIR / "meetings.db"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Deployment & Environment
IS_RENDER = os.getenv("RENDER", "").lower() in ("true", "1", "yes")
ENVIRONMENT = os.getenv("ENVIRONMENT", "production" if IS_RENDER else "development")

# CORS Configuration
CORS_ORIGINS = [orig.strip() for orig in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if orig.strip()]
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", r"^https://.*\.vercel\.app$")

# Whisper Configuration (Optimized for local CPU, configurable for low-memory Render)
WHISPER_ENABLED = os.getenv("WHISPER_ENABLED", "true").lower() in ("true", "1", "yes")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_CPU_THREADS = int(os.getenv("WHISPER_THREADS", "4" if not IS_RENDER else "2"))

# Ollama LLM Configuration (Local & Free default)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "60.0"))

# Optional Cloud LLM Provider (Free Groq or OpenAI-compatible endpoint for cloud deployment)
# If GROQ_API_KEY is set, cloud LLM inference is used instead of local Ollama
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Upload Constraints
MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB limit
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".webm", ".ogg"}
ALLOWED_MIME_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/x-pn-wav",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "audio/webm",
    "video/webm",
    "audio/ogg",
    "application/octet-stream",
}
