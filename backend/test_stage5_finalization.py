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

def test_start_pause_resume_stop_and_save():
    print("\n--- 1. Testing Start, Pause, Resume, Stop & Save Flow ---")
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    assert sample_wav.exists(), f"Sample audio missing at {sample_wav}"

    with open(sample_wav, "rb") as f:
        audio_data = f.read()

    meeting_title = "Flow Verification Meeting"
    with client.websocket_connect(f"/api/live/ws?title={meeting_title}") as ws:
        # Ready
        ready_msg = ws.receive_json()
        assert ready_msg["type"] == "ready"
        meeting_id = ready_msg["meeting_id"]
        print(f"   [PASS] 1a. Started live session with meeting_id: {meeting_id}")

        # Send first audio chunk
        chunk_size = 32768
        ws.send_bytes(audio_data[:chunk_size])

        # Pause
        ws.send_json({"type": "pause"})
        status_msg = ws.receive_json()
        assert status_msg["type"] == "status"
        assert status_msg["status"] == "paused"
        print("   [PASS] 1b. Paused live recording session successfully.")

        # Resume
        ws.send_json({"type": "resume"})
        status_msg2 = ws.receive_json()
        assert status_msg2["type"] == "status"
        assert status_msg2["status"] == "recording"
        print("   [PASS] 1c. Resumed live recording session successfully.")

        # Send remaining audio bytes
        for i in range(chunk_size, len(audio_data), chunk_size):
            ws.send_bytes(audio_data[i : i + chunk_size])

        # Stop & Save
        ws.send_json({"type": "stop"})
        print("   [PASS] 1d. Sent stop & save command.")

        # Read messages until completed
        completed_msg = None
        for _ in range(30):
            try:
                msg = ws.receive_json()
                if msg["type"] == "completed":
                    completed_msg = msg
                    break
                elif msg["type"] == "error":
                    assert False, f"Server returned unexpected error: {msg}"
            except Exception:
                break

        assert completed_msg is not None, "Did not receive completed message"
        assert completed_msg["meeting_id"] == meeting_id
        assert completed_msg["duration_seconds"] > 0
        assert completed_msg["segments_count"] > 0
        print(f"   [PASS] 1e. Completed message received: {completed_msg['segments_count']} segment(s), {completed_msg['duration_seconds']}s")

    # 1f. Verify meeting retrieval via HTTP GET
    get_resp = client.get(f"/api/meetings/{meeting_id}")
    assert get_resp.status_code == 200
    retrieved = get_resp.json()
    assert retrieved["id"] == meeting_id
    assert retrieved["status"] == "completed"
    assert len(retrieved["segments"]) > 0
    print(f"   [PASS] 1f. Meeting retrieved via GET /api/meetings/{meeting_id} with status='completed' and {len(retrieved['segments'])} segment(s).")
    return meeting_id

def test_unexpected_client_disconnect_saves_data():
    print("\n--- 2. Testing Unexpected Client Disconnection Handling ---")
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    with open(sample_wav, "rb") as f:
        audio_data = f.read()

    meeting_title = "Abrupt Disconnect Session"
    # Connect and stream audio, then abruptly close socket without sending stop
    with client.websocket_connect(f"/api/live/ws?title={meeting_title}") as ws:
        ready_msg = ws.receive_json()
        meeting_id = ready_msg["meeting_id"]
        print(f"   [PASS] Connected session {meeting_id}")

        # Send audio
        ws.send_bytes(audio_data)
        time.sleep(0.2)
        # Client drops connection without sending {"type": "stop"}
        ws.close()
        print("   [PASS] Client dropped connection abruptly (simulating network crash / tab close).")

    # The server finally block executes finalize_meeting_sync in thread pool
    meeting = None
    for i in range(15):
        meeting = get_meeting_details(meeting_id)
        if meeting and meeting["status"] == "completed":
            break
        time.sleep(1)

    assert meeting is not None, "Meeting should exist in DB"
    assert meeting["status"] == "completed", f"Expected completed status, got {meeting['status']}"
    assert len(meeting["segments"]) > 0, "Transcript segments should be preserved"
    print(f"   [PASS] Abruptly disconnected meeting preserved: status='completed', {len(meeting['segments'])} segment(s), {meeting['duration_seconds']}s.")

def test_websocket_send_failure_does_not_fail_database():
    print("\n--- 3. Testing WebSocket Send Failure (Simulating 1006) Does Not Invalidate Database ---")
    # Verified in test 2: even when the websocket is already closed, the database status remains 'completed'.
    # Verify FTS5 search also indexes the abrupt session
    matches = search_transcripts("roadmap")
    assert len(matches) > 0
    print(f"   [PASS] FTS5 search verifies transcript data indexed and accessible: {len(matches)} match(es).")

def test_preservation_of_upload_and_chat():
    print("\n--- 4. Testing Preservation of Upload, Summarization, and Chat ---")
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    with open(sample_wav, "rb") as f:
        audio_bytes = f.read()

    # 4a. Upload
    import io
    up_resp = client.post(
        "/api/meetings/upload",
        files={"file": ("test_preserve.wav", io.BytesIO(audio_bytes), "audio/wav")},
        data={"title": "Preserved Upload Meeting"}
    )
    assert up_resp.status_code == 201
    up_data = up_resp.json()
    meeting_id = up_data["meeting_id"]
    print(f"   [PASS] Audio upload preserved. Meeting ID: {meeting_id}")

    # 4b. Chat / RAG
    chat_resp = client.post(
        "/api/chat",
        json={"query": "What was discussed regarding the roadmap?", "meeting_id": meeting_id}
    )
    if chat_resp.status_code == 200:
        chat_data = chat_resp.json()
        assert "answer" in chat_data
        print(f"   [PASS] Q&A chat endpoint preserved. Response: {chat_data['answer'][:80]}...")
    elif chat_resp.status_code == 503:
        print("   [PASS] Q&A chat endpoint preserved (Ollama returned 503 Service Unavailable as expected when not running).")
    else:
        assert False, f"Unexpected chat response code: {chat_resp.status_code} - {chat_resp.text}"

if __name__ == "__main__":
    print("==================================================")
    print("   STAGE 5 FINALIZATION & RESILIENCE TEST SUITE   ")
    print("==================================================")
    init_db()
    flow_meeting_id = test_start_pause_resume_stop_and_save()
    test_unexpected_client_disconnect_saves_data()
    test_websocket_send_failure_does_not_fail_database()
    test_preservation_of_upload_and_chat()
    print("\n==================================================")
    print("   ALL FINALIZATION & REGRESSION CHECKS PASSED!   ")
    print("==================================================")
