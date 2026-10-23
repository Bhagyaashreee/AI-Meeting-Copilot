import sys
import json
import time
from pathlib import Path
from starlette.testclient import TestClient

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app
from app.db import init_db, get_meeting_details, list_meetings, search_transcripts

client = TestClient(app)

def test_empty_live_recording():
    print("\n--- 1. Testing Empty Live Recording Cleanup ---")
    with client.websocket_connect("/api/live/ws?title=Empty+Live+Session") as ws:
        ready_msg = ws.receive_json()
        assert ready_msg["type"] == "ready"
        meeting_id = ready_msg["meeting_id"]
        print(f"   [PASS] WebSocket opened and initialized meeting {meeting_id}")

        # Send stop immediately without sending any audio bytes
        ws.send_json({"type": "stop"})
        response = ws.receive_json()
        assert response["type"] == "error"
        assert "empty" in response["message"].lower()
        print("   [PASS] Empty recording correctly rejected.")

    # Confirm meeting was cleaned up from database
    meeting = get_meeting_details(meeting_id)
    assert meeting is None, "Empty meeting should have been deleted from DB"
    print("   [PASS] Empty meeting successfully purged from SQLite.")

def test_live_streaming_transcription():
    print("\n--- 2. Testing Live Streaming Audio Transcription ---")
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    assert sample_wav.exists(), f"Sample audio missing at {sample_wav}"

    with open(sample_wav, "rb") as f:
        audio_data = f.read()

    meeting_title = "Live Sprint Standup"
    with client.websocket_connect(f"/api/live/ws?title={meeting_title}") as ws:
        ready_msg = ws.receive_json()
        assert ready_msg["type"] == "ready"
        meeting_id = ready_msg["meeting_id"]
        print(f"   [PASS] Connected to live WebSocket, meeting ID: {meeting_id}")

        # Stream audio in chunks to simulate microphone capture
        chunk_size = 32768  # 32 KB
        for i in range(0, len(audio_data), chunk_size):
            chunk = audio_data[i : i + chunk_size]
            ws.send_bytes(chunk)

        # Send stop command to finalize
        ws.send_json({"type": "stop"})

        # Read streaming segments and wait for completed response
        streamed_segments = []
        completed_msg = None
        for _ in range(20):
            try:
                msg = ws.receive_json()
                if msg["type"] == "segment":
                    streamed_segments.append(msg)
                    print(f"   [STREAM] Received live segment: \"{msg['text']}\" ({msg['start_time']}s - {msg['end_time']}s)")
                elif msg["type"] == "completed":
                    completed_msg = msg
                    break
                elif msg["type"] == "error":
                    assert False, f"Server returned error: {msg}"
            except Exception:
                break

        assert completed_msg is not None, "Did not receive completed message"
        assert completed_msg["type"] == "completed"
        assert completed_msg["meeting_id"] == meeting_id
        assert completed_msg["duration_seconds"] > 0
        assert completed_msg["segments_count"] > 0
        print(f"   [PASS] Finalized live transcription: {completed_msg['segments_count']} segment(s), duration: {completed_msg['duration_seconds']}s")
        print(f"   [PASS] Live transcribed text: \"{completed_msg.get('full_text')}\"")

    # Verify meeting persisted in database
    meeting = get_meeting_details(meeting_id)
    assert meeting is not None
    assert meeting["status"] == "completed"
    assert len(meeting["segments"]) > 0
    print(f"   [PASS] Meeting details verified in SQLite with {len(meeting['segments'])} segments.")

    # Verify meeting appears in meeting history list
    all_meetings = list_meetings()
    assert any(m["id"] == meeting_id for m in all_meetings)
    print("   [PASS] Meeting appears in Meeting History list.")

    # Verify searchability via FTS5
    search_results = search_transcripts("roadmap")
    assert any(r["meeting_id"] == meeting_id for r in search_results)
    print("   [PASS] Live meeting transcript is immediately searchable via SQLite FTS5.")

if __name__ == "__main__":
    print("==================================================")
    print("     STAGE 5 VERIFICATION TEST SUITE              ")
    print("==================================================")
    init_db()
    test_empty_live_recording()
    test_live_streaming_transcription()
    print("\n==================================================")
    print("     ALL STAGE 5 BACKEND TESTS PASSED!            ")
    print("==================================================")
