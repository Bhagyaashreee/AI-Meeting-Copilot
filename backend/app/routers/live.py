import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from starlette.websockets import WebSocketState

from app.config import AUDIO_DIR
from app.db import (
    create_meeting,
    update_meeting_status,
    save_transcript_segments,
    delete_meeting,
    get_meeting_details
)
from app.services.transcriber import transcription_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/live", tags=["live"])

def finalize_meeting_sync(meeting_id: str, audio_path: Path) -> Dict[str, Any]:
    """
    Synchronously transcribe audio and persist results to SQLite and FTS5.
    Runs in an executor thread pool to guarantee completion even if the
    WebSocket coroutine is cancelled by client disconnection.
    """
    logger.info(f"Finalizing transcription and database persistence for meeting {meeting_id}...")
    try:
        final_result = transcription_service.transcribe_file(audio_path)
        segments = final_result.get("segments", [])
        duration = final_result.get("duration_seconds", 0.0)

        # Persist segments to SQLite and FTS5 index BEFORE any network notifications
        save_transcript_segments(meeting_id, segments)
        update_meeting_status(meeting_id, status="completed", duration_seconds=duration)
        logger.info(
            f"Live meeting {meeting_id} successfully finalized in database with "
            f"{len(segments)} segments ({duration}s)."
        )
        return final_result
    except Exception as e:
        logger.error(f"Failed to transcribe/finalize meeting {meeting_id}: {e}", exc_info=True)
        update_meeting_status(meeting_id, status="failed")
        raise

@router.websocket("/ws")
async def live_meeting_websocket(
    websocket: WebSocket,
    title: Optional[str] = Query(None)
):
    """
    WebSocket endpoint for live microphone recording and streaming transcription.
    Accepts binary audio chunks, generates real-time transcript segments with faster-whisper,
    and saves the completed meeting to SQLite.
    """
    await websocket.accept()

    meeting_id = str(uuid.uuid4())
    meeting_title = (title or "").strip()
    if not meeting_title:
        meeting_title = f"Live Meeting - {datetime.now().strftime('%b %d, %H:%M')}"

    audio_filename = f"{meeting_id}.webm"
    audio_path = AUDIO_DIR / audio_filename

    # Create meeting record in SQLite
    create_meeting(
        meeting_id=meeting_id,
        title=meeting_title,
        audio_filename=audio_filename
    )

    # Inform client of initialization
    await websocket.send_json({
        "type": "ready",
        "meeting_id": meeting_id,
        "title": meeting_title
    })

    bytes_received = 0
    chunks_count = 0
    last_transcribed_chunk = 0
    last_emitted_end_time = 0.0
    known_texts = set()
    is_paused = False
    is_finalized = False

    # Open file for streaming binary append
    audio_file = open(audio_path, "wb")

    try:
        while True:
            message = await websocket.receive()

            # Handle Binary Audio Chunks
            if "bytes" in message and message["bytes"]:
                chunk = message["bytes"]
                bytes_received += len(chunk)
                chunks_count += 1
                audio_file.write(chunk)
                audio_file.flush()

                # Every 2 chunks (~5-6s) and if not paused, run incremental transcription
                if not is_paused and (chunks_count - last_transcribed_chunk >= 2) and bytes_received > 8000:
                    last_transcribed_chunk = chunks_count
                    try:
                        # Run transcription in thread to keep asyncio event loop responsive
                        result = await asyncio.to_thread(
                            transcription_service.transcribe_file,
                            audio_path
                        )
                        for seg in result.get("segments", []):
                            # Avoid emitting duplicate segments
                            seg_text = seg["text"].strip()
                            if seg["end_time"] > last_emitted_end_time and seg_text not in known_texts:
                                last_emitted_end_time = seg["end_time"]
                                known_texts.add(seg_text)
                                if websocket.client_state == WebSocketState.CONNECTED:
                                    await websocket.send_json({
                                        "type": "segment",
                                        "start_time": seg["start_time"],
                                        "end_time": seg["end_time"],
                                        "text": seg_text
                                    })
                    except Exception as e:
                        # Incremental chunk may be incomplete WebM cluster; continue accumulating
                        logger.debug(f"Incremental transcribe notice: {e}")

            # Handle Control Text Messages (pause, resume, stop)
            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "pause":
                        is_paused = True
                        if websocket.client_state == WebSocketState.CONNECTED:
                            await websocket.send_json({"type": "status", "status": "paused"})

                    elif msg_type == "resume":
                        is_paused = False
                        if websocket.client_state == WebSocketState.CONNECTED:
                            await websocket.send_json({"type": "status", "status": "recording"})

                    elif msg_type == "stop":
                        is_finalized = True
                        break

                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON received on live websocket: {message['text']}")

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected for live meeting {meeting_id}")
    except Exception as e:
        if "disconnect" in str(e).lower():
            logger.info(f"WebSocket disconnected for live meeting {meeting_id}: {e}")
        else:
            logger.error(f"Error during live websocket session {meeting_id}: {e}", exc_info=True)
    finally:
        if not audio_file.closed:
            audio_file.close()

        # Handle Empty Recording
        if bytes_received < 100:
            logger.info(f"Recording for meeting {meeting_id} was empty ({bytes_received} bytes). Cleaning up.")
            if audio_path.exists():
                try:
                    audio_path.unlink()
                except Exception:
                    pass
            delete_meeting(meeting_id)
            try:
                if websocket.client_state == WebSocketState.CONNECTED:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Recording was empty. No audio was captured."
                    })
                    await websocket.close()
            except Exception:
                pass
            return

        # Inform client that audio was received and finalization has started
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.send_json({"type": "status", "status": "finalizing"})
            except Exception:
                pass

        # Submit finalization to executor so it runs to completion even if ASGI coroutine is cancelled
        loop = asyncio.get_running_loop()
        finalization_future = loop.run_in_executor(None, finalize_meeting_sync, meeting_id, audio_path)

        # Periodic keepalive ping during Whisper transcription to prevent client/proxy 1006 timeouts
        async def _send_finalizing_keepalives():
            try:
                while True:
                    await asyncio.sleep(2.5)
                    if websocket.client_state == WebSocketState.CONNECTED:
                        await websocket.send_json({
                            "type": "progress",
                            "status": "finalizing",
                            "message": "Transcribing audio and finalizing meeting..."
                        })
            except Exception:
                pass

        keepalive_task = asyncio.create_task(_send_finalizing_keepalives())

        try:
            # Shield future so client disconnect cancellation doesn't kill background worker
            final_result = await asyncio.shield(finalization_future)
        except (asyncio.CancelledError, BaseException):
            logger.info(f"Client disconnected/cancelled for meeting {meeting_id}; awaiting background completion...")
            final_result = await asyncio.wrap_future(finalization_future)
        finally:
            keepalive_task.cancel()

        # Database is completely finalized and persisted.
        # Now attempt to send completion message to client without failing the meeting if client disconnected.
        segments = final_result.get("segments", [])
        duration = final_result.get("duration_seconds", 0.0)
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_json({
                    "type": "completed",
                    "meeting_id": meeting_id,
                    "title": meeting_title,
                    "duration_seconds": duration,
                    "segments_count": len(segments),
                    "full_text": final_result.get("full_text", "")
                })
                await websocket.close()
        except (WebSocketDisconnect, RuntimeError, Exception) as ws_err:
            logger.info(
                f"Client disconnected before completed message could be sent for meeting {meeting_id}: {ws_err}. "
                f"Meeting data, audio, and FTS5 entries remain safely saved in database."
            )
