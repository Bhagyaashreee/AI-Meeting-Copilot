import logging
import threading
from pathlib import Path
from typing import Dict, Any, List
from faster_whisper import WhisperModel
from app.config import (
    WHISPER_MODEL,
    WHISPER_DEVICE,
    WHISPER_COMPUTE_TYPE,
    WHISPER_CPU_THREADS
)

logger = logging.getLogger(__name__)

class TranscriptionService:
    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self._model: WhisperModel | None = None

    @classmethod
    def get_instance(cls) -> "TranscriptionService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _get_model(self) -> WhisperModel:
        if self._model is None:
            with self._lock:
                if self._model is None:
                    logger.info(
                        f"Loading faster-whisper model '{WHISPER_MODEL}' "
                        f"(device={WHISPER_DEVICE}, compute_type={WHISPER_COMPUTE_TYPE}, threads={WHISPER_CPU_THREADS})..."
                    )
                    self._model = WhisperModel(
                        model_size_or_path=WHISPER_MODEL,
                        device=WHISPER_DEVICE,
                        compute_type=WHISPER_COMPUTE_TYPE,
                        cpu_threads=WHISPER_CPU_THREADS,
                        num_workers=1
                    )
                    logger.info("faster-whisper model loaded successfully.")
        return self._model

    def transcribe_file(self, audio_path: Path) -> Dict[str, Any]:
        """
        Transcribe an audio file using faster-whisper.
        Returns a dict containing duration, language, full_text, and list of segments.
        """
        if not audio_path.exists():
            raise FileNotFoundError("Audio file not found on server.")

        model = self._get_model()

        try:
            segments_gen, info = model.transcribe(
                str(audio_path),
                beam_size=1,  # Greedy for speed & low memory on CPU
                vad_filter=True,  # Voice activity detection to trim silence
                vad_parameters=dict(min_silence_duration_ms=500),
            )

            segments: List[Dict[str, Any]] = []
            full_text_parts: List[str] = []

            for seg in segments_gen:
                text_clean = seg.text.strip()
                if text_clean:
                    segments.append({
                        "start_time": round(seg.start, 2),
                        "end_time": round(seg.end, 2),
                        "text": text_clean
                    })
                    full_text_parts.append(text_clean)

            duration = round(info.duration, 2) if hasattr(info, "duration") and info.duration else 0.0
            language = info.language if hasattr(info, "language") else "en"

            return {
                "duration_seconds": duration,
                "language": language,
                "segments": segments,
                "full_text": " ".join(full_text_parts)
            }
        except Exception as e:
            logger.error(f"Error during audio transcription: {e}", exc_info=True)
            raise RuntimeError(f"Transcription failed: {str(e)}")

# Singleton helper
transcription_service = TranscriptionService.get_instance()
