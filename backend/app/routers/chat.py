import json
import uuid
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status
from app.config import AUDIO_DIR, MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS
from app.models import (
    ChatRequest,
    ChatResponse,
    ReferenceItem,
    VoiceChatResponse,
    TranscribeResponse
)
from app.services.rag import rag_service
from app.services.assistant import assistant_service
from app.services.transcriber import transcription_service
from app.db import get_meeting_details

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

def _parse_history_payload(raw_history: Optional[str]) -> List[Dict[str, str]]:
    """Safely parse incoming JSON string history into list of role/content dicts."""
    if not raw_history:
        return []
    try:
        data = json.loads(raw_history)
        if isinstance(data, list):
            cleaned = []
            for item in data:
                if isinstance(item, dict) and "role" in item and "content" in item:
                    cleaned.append({
                        "role": str(item["role"]),
                        "content": str(item["content"])
                    })
            return cleaned
    except Exception as e:
        logger.warning(f"Could not parse history JSON: {e}")
    return []

async def _process_audio_upload(file: UploadFile) -> tuple[str, dict]:
    """
    Validates uploaded audio, saves to temporary path in AUDIO_DIR,
    transcribes with faster-whisper, and guarantees temporary file cleanup.
    Returns (transcribed_text, transcription_result_dict).
    """
    raw_filename = file.filename or "recording.webm"
    file_ext = Path(raw_filename).suffix.lower()

    # Reject unsupported explicit extensions
    if file_ext and file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported audio format '{file_ext}'. Allowed formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # If no extension provided, infer from MIME type or default to .webm
    if not file_ext:
        content_type = (file.content_type or "").lower()
        if "wav" in content_type:
            file_ext = ".wav"
        elif "mp4" in content_type or "m4a" in content_type:
            file_ext = ".m4a"
        elif "mp3" in content_type or "mpeg" in content_type:
            file_ext = ".mp3"
        elif "ogg" in content_type:
            file_ext = ".ogg"
        else:
            file_ext = ".webm"

    temp_filename = f"voice_query_{uuid.uuid4()}{file_ext}"
    temp_path = AUDIO_DIR / temp_filename
    total_bytes = 0

    try:
        with open(temp_path, "wb") as buffer:
            while chunk := await file.read(1024 * 64):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE_BYTES:
                    buffer.close()
                    if temp_path.exists():
                        temp_path.unlink()
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Audio recording exceeds maximum allowed size of 100 MB."
                    )
                buffer.write(chunk)

        if total_bytes < 100:
            if temp_path.exists():
                temp_path.unlink()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Recorded audio is empty (0 bytes or no audio captured). Please speak into your microphone and try again."
            )

        try:
            transcription_result = transcription_service.transcribe_file(temp_path)
        except Exception as e:
            logger.error(f"Error during audio transcription: {e}", exc_info=True)
            err_str = str(e).lower()
            if "invalid data" in err_str or "unsupported" in err_str or "could not find codec" in err_str:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid or unreadable audio format. Please check your recording device."
                )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Speech transcription failed during audio processing."
            )

        transcribed_text = (transcription_result.get("full_text") or "").strip()
        if not transcribed_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No speech could be detected in the audio recording. Please speak clearly into your microphone."
            )

        return transcribed_text, transcription_result
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception as e:
                logger.warning(f"Failed to remove temp audio file {temp_path}: {e}")

@router.post("", response_model=ChatResponse)
async def chat_handler(request: ChatRequest):
    """
    Main chat endpoint supporting two modes:
    1. 'general': Answers greetings, casual questions, and ordinary discussion using Ollama llama3.2:3b.
    2. 'meeting': Answers grounded questions about past meetings using SQLite FTS5 retrieval and citations.
    If mode is omitted, casual greetings route to general conversation while meeting queries route to meeting RAG.
    """
    query = (request.query or "").strip()
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Query cannot be empty."
        )

    # Resolve mode
    if request.mode:
        mode = request.mode.strip().lower()
    elif request.meeting_id:
        mode = "meeting"
    elif assistant_service.is_casual_greeting(query):
        mode = "general"
    else:
        # Default unclassified text queries to meeting RAG for backward compatibility
        mode = "meeting"

    # --- Mode: Meeting Assistant ---
    if mode == "meeting":
        if request.meeting_id:
            meeting = get_meeting_details(request.meeting_id)
            if not meeting:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Meeting with ID '{request.meeting_id}' not found."
                )

        # Handle greetings naturally even in meeting mode
        if assistant_service.is_casual_greeting(query):
            return ChatResponse(
                answer="Hello! Yes, I can hear you clearly. We are currently in Meeting Assistant mode—ask me any question about your recorded meetings, or switch to General Conversation mode to chat casually.",
                references=[],
                mode="meeting"
            )

        try:
            result = await rag_service.answer_question(
                query=query,
                meeting_id=request.meeting_id
            )
        except ConnectionError as e:
            logger.error(f"Ollama connection error: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Local AI service (Ollama) is unavailable. Please verify it is running."
            )
        except TimeoutError as e:
            logger.error(f"Ollama timeout error: {e}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Local AI service timed out while processing question."
            )
        except Exception as e:
            logger.error(f"Error answering question with RAG: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="An error occurred while answering your question."
            )

        return ChatResponse(
            answer=result["answer"],
            references=[ReferenceItem(**ref) for ref in result["references"]],
            mode="meeting"
        )

    # --- Mode: General Conversation ---
    history_payload = [m.model_dump() for m in (request.history or [])]
    try:
        result = await assistant_service.chat(
            query=query,
            history=history_payload
        )
    except ConnectionError as e:
        logger.error(f"Ollama connection error in general chat: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local AI service (Ollama) is unavailable. Please verify it is running."
        )
    except TimeoutError as e:
        logger.error(f"Ollama timeout error in general chat: {e}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Local AI service timed out while generating conversational response."
        )
    except Exception as e:
        logger.error(f"Error in general chat: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while processing your conversation."
        )

    return ChatResponse(
        answer=result["answer"],
        references=[],
        mode="general"
    )

@router.post("/general", response_model=ChatResponse)
async def general_chat_endpoint(request: ChatRequest):
    """
    Dedicated endpoint for General Conversation mode.
    Answers greetings, casual chat, and general questions using Ollama without meeting search.
    """
    request.mode = "general"
    return await chat_handler(request)

@router.post("/voice", response_model=VoiceChatResponse)
async def voice_chat_handler(
    file: UploadFile = File(...),
    mode: Optional[str] = Form(None),
    meeting_id: Optional[str] = Form(None),
    history: Optional[str] = Form(None)
):
    """
    Dual-mode Voice Chat endpoint:
    1. Transcribes audio question using faster-whisper.
    2. Routes to either General Conversation (Ollama personal assistant) or Meeting Assistant (grounded RAG).
    3. Speaks response back and preserves conversation history.
    """
    transcribed_query, _ = await _process_audio_upload(file)

    if mode:
        selected_mode = mode.strip().lower()
    elif meeting_id:
        selected_mode = "meeting"
    elif assistant_service.is_casual_greeting(transcribed_query):
        selected_mode = "general"
    else:
        # Default voice query to general assistant if not specified
        selected_mode = "general"

    # --- Mode: Meeting Assistant ---
    if selected_mode == "meeting":
        if meeting_id:
            meeting = get_meeting_details(meeting_id)
            if not meeting:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Meeting with ID '{meeting_id}' not found."
                )

        if assistant_service.is_casual_greeting(transcribed_query):
            return VoiceChatResponse(
                query=transcribed_query,
                answer="Hello! Yes, I can hear you clearly. We are currently in Meeting Assistant mode—ask me any question about your recorded meetings, or switch to General Conversation mode to chat casually.",
                references=[],
                mode="meeting"
            )

        try:
            result = await rag_service.answer_question(
                query=transcribed_query,
                meeting_id=meeting_id
            )
        except ConnectionError as e:
            logger.error(f"Ollama connection error in voice chat: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Local AI service (Ollama) is unavailable. Please verify it is running."
            )
        except TimeoutError as e:
            logger.error(f"Ollama timeout error in voice chat: {e}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Local AI service timed out while processing question."
            )
        except Exception as e:
            logger.error(f"Error answering voice question with RAG: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="An error occurred while answering your question."
            )

        return VoiceChatResponse(
            query=transcribed_query,
            answer=result["answer"],
            references=[ReferenceItem(**ref) for ref in result["references"]],
            mode="meeting"
        )

    # --- Mode: General Conversation (Default) ---
    parsed_history = _parse_history_payload(history)
    try:
        result = await assistant_service.chat(
            query=transcribed_query,
            history=parsed_history
        )
    except ConnectionError as e:
        logger.error(f"Ollama connection error in general voice chat: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local AI service (Ollama) is unavailable. Please verify it is running."
        )
    except TimeoutError as e:
        logger.error(f"Ollama timeout error in general voice chat: {e}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Local AI service timed out while generating conversational response."
        )
    except Exception as e:
        logger.error(f"Error in general voice chat: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while processing your conversation."
        )

    return VoiceChatResponse(
        query=transcribed_query,
        answer=result["answer"],
        references=[],
        mode="general"
    )

@router.post("/general/voice", response_model=VoiceChatResponse)
async def general_voice_endpoint(
    file: UploadFile = File(...),
    history: Optional[str] = Form(None)
):
    """
    Dedicated endpoint for General Voice Conversation.
    """
    return await voice_chat_handler(
        file=file,
        mode="general",
        meeting_id=None,
        history=history
    )

@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_voice_query(
    file: UploadFile = File(...)
):
    """
    Transcribe speech audio without generating an LLM response.
    """
    transcribed_text, transcription_result = await _process_audio_upload(file)
    return TranscribeResponse(
        text=transcribed_text,
        duration_seconds=transcription_result.get("duration_seconds", 0.0),
        language=transcription_result.get("language", "en")
    )


