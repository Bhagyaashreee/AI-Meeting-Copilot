import os
import json
import uuid
import logging
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status
from fastapi.responses import FileResponse

from app.config import (
    AUDIO_DIR,
    MAX_UPLOAD_SIZE_BYTES,
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES
)
from app.db import (
    create_meeting,
    update_meeting_status,
    save_transcript_segments,
    list_meetings,
    get_meeting_details,
    search_transcripts,
    save_meeting_summary_and_action_items,
    get_meeting_segments,
    toggle_action_item_completed
)
from app.services.transcriber import transcription_service
from app.services.summarizer import summarizer_service
from app.models import (
    UploadResponse,
    MeetingSummaryResponse,
    MeetingDetailResponse,
    TranscriptSegmentResponse,
    SummarizeResponse,
    ActionItemResponse,
    ActionItemUpdateRequest,
    EmailDraftResponse
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/meetings", tags=["meetings"])

@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_and_transcribe_audio(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None)
):
    """
    Upload an audio recording, validate it, transcribe it with faster-whisper,
    and persist metadata and timestamped segments in SQLite.
    """
    raw_filename = file.filename or "recording.wav"
    file_ext = Path(raw_filename).suffix.lower()

    # 1. Validate file extension
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{file_ext}'. Allowed formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # 2. Validate MIME type (if provided by client)
    content_type = file.content_type or ""
    if content_type and content_type.lower() not in ALLOWED_MIME_TYPES and content_type != "application/octet-stream":
        logger.warning(f"Uncommon MIME type received: {content_type} for file {raw_filename}")

    # 3. Generate safe unique ID and sanitized storage filename
    meeting_id = str(uuid.uuid4())
    safe_audio_filename = f"{meeting_id}{file_ext}"
    dest_path = AUDIO_DIR / safe_audio_filename

    # Derive meeting title
    meeting_title = (title or "").strip()
    if not meeting_title:
        original_stem = Path(raw_filename).stem.strip()
        meeting_title = original_stem[:100] if original_stem else "Untitled Meeting"

    # 4. Stream and save to disk with size limits
    total_bytes = 0
    try:
        with open(dest_path, "wb") as buffer:
            while chunk := await file.read(1024 * 64):  # 64 KB chunks
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE_BYTES:
                    buffer.close()
                    if dest_path.exists():
                        dest_path.unlink()
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="File exceeds maximum allowed upload size of 100 MB."
                    )
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to write uploaded file to disk: {e}", exc_info=True)
        if dest_path.exists():
            dest_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded audio file."
        )

    # Validate file is not empty
    if total_bytes == 0:
        if dest_path.exists():
            dest_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty (0 bytes)."
        )

    # 5. Record initial meeting state in SQLite
    create_meeting(
        meeting_id=meeting_id,
        title=meeting_title,
        audio_filename=safe_audio_filename
    )

    # 6. Execute speech transcription
    try:
        transcription_result = transcription_service.transcribe_file(dest_path)
    except Exception as e:
        logger.error(f"Speech transcription failed for meeting {meeting_id}: {e}", exc_info=True)
        update_meeting_status(meeting_id, status="failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Speech transcription failed during audio processing."
        )

    # 7. Persist segments into SQLite and update meeting status
    try:
        segments = transcription_result["segments"]
        duration = transcription_result["duration_seconds"]

        save_transcript_segments(meeting_id, segments)
        update_meeting_status(meeting_id, status="completed", duration_seconds=duration)
    except Exception as e:
        logger.error(f"Failed to save transcription segments to database for meeting {meeting_id}: {e}", exc_info=True)
        update_meeting_status(meeting_id, status="failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save meeting transcripts to database."
        )

    return UploadResponse(
        meeting_id=meeting_id,
        title=meeting_title,
        status="completed",
        duration_seconds=transcription_result["duration_seconds"],
        language=transcription_result["language"],
        full_text=transcription_result["full_text"],
        segments=[TranscriptSegmentResponse(**seg) for seg in segments]
    )

@router.get("", response_model=List[MeetingSummaryResponse])
async def get_all_meetings():
    """List all meetings ordered by creation date."""
    try:
        meetings = list_meetings()
        return [MeetingSummaryResponse(**m) for m in meetings]
    except Exception as e:
        logger.error(f"Database error listing meetings: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve meetings from database."
        )

@router.get("/search")
async def search_meeting_transcripts(q: str):
    """Search transcripts across all meetings using SQLite FTS5."""
    if not q or not q.strip():
        return []
    try:
        results = search_transcripts(q.strip())
        return results
    except Exception as e:
        logger.error(f"Error searching transcripts: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to execute transcript search."
        )

@router.get("/{meeting_id}", response_model=MeetingDetailResponse)
async def get_meeting(meeting_id: str):
    """Retrieve full meeting details, including timestamped transcript segments."""
    try:
        meeting = get_meeting_details(meeting_id)
        if not meeting:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Meeting with ID '{meeting_id}' not found."
            )
        return MeetingDetailResponse(**meeting)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Database error retrieving meeting {meeting_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve meeting details."
        )

@router.get("/{meeting_id}/audio")
async def get_meeting_audio(meeting_id: str):
    """Stream or download the meeting audio file."""
    meeting = get_meeting_details(meeting_id)
    if not meeting or not meeting.get("audio_filename"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting audio not found."
        )
    audio_path = AUDIO_DIR / meeting["audio_filename"]
    if not audio_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file not found on disk."
        )
    return FileResponse(path=str(audio_path), media_type="audio/mpeg", filename=meeting["audio_filename"])

@router.post("/{meeting_id}/summarize", response_model=SummarizeResponse)
async def summarize_meeting(meeting_id: str):
    """
    Summarize a meeting transcript and extract decisions and action items with Ollama Llama 3.2 3B.
    Safely saves summary and action items in SQLite, replacing old action items to avoid duplicates.
    """
    meeting = get_meeting_details(meeting_id)
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting with ID '{meeting_id}' not found."
        )

    segments = meeting.get("segments", [])
    if not segments:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting has no transcript segments to summarize."
        )

    full_transcript = " ".join([s["text"] for s in segments if s.get("text")])

    try:
        summary_result = await summarizer_service.summarize_transcript(full_transcript)
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
            detail="Local AI service timed out while generating summary."
        )
    except Exception as e:
        logger.error(f"Failed to generate meeting summary: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while generating the meeting summary."
        )

    # Persist summary and action items safely
    try:
        summary_json_str = json.dumps({
            "executive_summary": summary_result["executive_summary"],
            "key_discussion_points": summary_result["key_discussion_points"],
            "key_decisions": summary_result["key_decisions"]
        })
        save_meeting_summary_and_action_items(
            meeting_id=meeting_id,
            summary_str=summary_json_str,
            action_items=summary_result["action_items"]
        )
    except Exception as e:
        logger.error(f"Failed to save summary to database: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save meeting summary to database."
        )

    return SummarizeResponse(
        meeting_id=meeting_id,
        executive_summary=summary_result["executive_summary"],
        key_discussion_points=summary_result["key_discussion_points"],
        key_decisions=summary_result["key_decisions"],
        action_items=[ActionItemResponse(**item) for item in summary_result["action_items"]]
    )

@router.patch("/{meeting_id}/action-items/{item_id}", response_model=ActionItemResponse)
async def update_action_item_completion(
    meeting_id: str,
    item_id: int,
    payload: Optional[ActionItemUpdateRequest] = None
):
    """
    Toggle or update the completion status of an action item in SQLite.
    Allows users to check off tasks directly from the meeting details view.
    """
    completed_val = payload.completed if payload is not None else None
    updated = toggle_action_item_completed(
        meeting_id=meeting_id,
        item_id=item_id,
        completed=completed_val
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Action item #{item_id} for meeting '{meeting_id}' not found."
        )
    return ActionItemResponse(**updated)

@router.post("/{meeting_id}/email-draft", response_model=EmailDraftResponse)
async def generate_meeting_email_draft(meeting_id: str):
    """
    Generate an executive follow-up email draft grounded in meeting decisions and action items.
    Uses local Ollama llama3.2:3b to draft a clean stakeholder email.
    """
    meeting = get_meeting_details(meeting_id)
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting with ID '{meeting_id}' not found."
        )

    summary_raw = meeting.get("summary")
    action_items = meeting.get("action_items", [])

    # Parse summary content
    summary_data = {}
    if summary_raw:
        try:
            summary_data = json.loads(summary_raw)
        except Exception:
            summary_data = {"executive_summary": summary_raw}
    summary_data["action_items"] = action_items

    # If no summary exists yet, provide friendly fallback
    if not summary_data.get("executive_summary") and not action_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot generate follow-up email before meeting summary or action items have been extracted."
        )

    try:
        draft = await summarizer_service.generate_followup_email(
            meeting_title=meeting.get("title", "Meeting"),
            created_at=meeting.get("created_at", ""),
            summary_data=summary_data
        )
        return EmailDraftResponse(meeting_id=meeting_id, email_draft=draft)
    except Exception as e:
        logger.error(f"Failed to generate follow-up email for meeting {meeting_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate email draft."
        )
