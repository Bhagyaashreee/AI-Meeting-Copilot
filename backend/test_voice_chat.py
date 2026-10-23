import sys
import io
from pathlib import Path
from starlette.testclient import TestClient

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app
from app.db import init_db, list_meetings

client = TestClient(app)

def test_transcribe_endpoint():
    print("\n--- 1. Testing POST /api/chat/transcribe ---")
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    assert sample_wav.exists(), f"Sample audio missing at {sample_wav}"

    with open(sample_wav, "rb") as f:
        response = client.post(
            "/api/chat/transcribe",
            files={"file": ("recording.wav", f, "audio/wav")}
        )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()
    print(f"   Transcribed text: \"{data.get('text')}\"")
    print(f"   Duration: {data.get('duration_seconds')}s, Language: {data.get('language')}")
    assert len(data.get("text", "")) > 0, "Expected non-empty transcribed text"
    assert data.get("duration_seconds", 0) > 0
    print("   [PASS] /api/chat/transcribe successfully transcribed audio.")

def test_voice_chat_endpoint():
    print("\n--- 2. Testing End-to-End POST /api/chat/voice ---")
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"

    with open(sample_wav, "rb") as f:
        response = client.post(
            "/api/chat/voice",
            files={"file": ("sample.wav", f, "audio/wav")}
        )
    assert response.status_code == 200, f"Voice chat failed: {response.status_code}: {response.text}"
    data = response.json()
    print(f"   Transcribed Question: \"{data.get('query')}\"")
    print(f"   AI Copilot Answer: \"{data.get('answer')}\"")
    print(f"   Referenced sources count: {len(data.get('references', []))}")

    assert len(data.get("query", "")) > 0, "Expected non-empty transcribed query"
    assert len(data.get("answer", "")) > 0, "Expected non-empty AI answer"
    assert isinstance(data.get("references"), list)
    print("   [PASS] /api/chat/voice end-to-end voice query and RAG answer succeeded.")

def test_scoped_voice_chat():
    print("\n--- 3. Testing Meeting Scoped POST /api/chat/voice ---")
    meetings = list_meetings()
    if not meetings:
        print("   [SKIP] No meetings found in DB to scope to.")
        return

    meeting_id = meetings[0]["id"]
    meeting_title = meetings[0]["title"]
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"

    with open(sample_wav, "rb") as f:
        response = client.post(
            "/api/chat/voice",
            files={"file": ("sample.wav", f, "audio/wav")},
            data={"meeting_id": meeting_id}
        )
    assert response.status_code == 200, f"Scoped voice chat failed: {response.status_code}: {response.text}"
    data = response.json()
    print(f"   Scoped to Meeting: '{meeting_title}' ({meeting_id})")
    print(f"   Answer: \"{data.get('answer')[:100]}...\"")
    print("   [PASS] Scoped voice chat succeeded.")

def test_voice_chat_edge_cases():
    print("\n--- 4. Testing Edge Cases & Error Handling ---")

    # 4a. Empty audio file (0 bytes) -> 400
    empty_file = io.BytesIO(b"")
    resp_empty = client.post(
        "/api/chat/voice",
        files={"file": ("empty.webm", empty_file, "audio/webm")}
    )
    assert resp_empty.status_code == 400, f"Expected 400, got {resp_empty.status_code}"
    print(f"   [PASS] Empty audio rejected: {resp_empty.json()['detail']}")

    # 4b. Tiny audio (< 100 bytes dummy bytes) -> 400
    tiny_file = io.BytesIO(b"too small")
    resp_tiny = client.post(
        "/api/chat/voice",
        files={"file": ("tiny.webm", tiny_file, "audio/webm")}
    )
    assert resp_tiny.status_code == 400
    print(f"   [PASS] Insufficient audio bytes rejected: {resp_tiny.json()['detail']}")

    # 4c. Non-existent meeting ID -> 404
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    with open(sample_wav, "rb") as f:
        resp_404 = client.post(
            "/api/chat/voice",
            files={"file": ("sample.wav", f, "audio/wav")},
            data={"meeting_id": "non-existent-meeting-uuid"}
        )
    assert resp_404.status_code == 404
    print(f"   [PASS] Non-existent meeting ID rejected: {resp_404.json()['detail']}")

    # 4d. Unsupported file extension -> 400
    fake_exe = io.BytesIO(b"MZ" + b"\x00" * 200)
    resp_bad_ext = client.post(
        "/api/chat/voice",
        files={"file": ("virus.exe", fake_exe, "application/octet-stream")}
    )
    assert resp_bad_ext.status_code == 400
    print(f"   [PASS] Unsupported extension rejected: {resp_bad_ext.json()['detail']}")

def test_existing_text_chat_regression():
    print("\n--- 5. Testing Existing Text Chat Regression ---")
    resp = client.post("/api/chat", json={"query": "What are the action items?"})
    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert "references" in data
    print("   [PASS] Existing POST /api/chat text Q&A works without regression.")

if __name__ == "__main__":
    print("==================================================")
    print("      VOICE CHAT & SPEECH API TEST SUITE         ")
    print("==================================================")
    init_db()
    test_transcribe_endpoint()
    test_voice_chat_endpoint()
    test_scoped_voice_chat()
    test_voice_chat_edge_cases()
    test_existing_text_chat_regression()
    print("\n==================================================")
    print("      ALL VOICE CHAT BACKEND TESTS PASSED!        ")
    print("==================================================")
