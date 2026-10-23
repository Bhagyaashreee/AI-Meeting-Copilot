import io
import os
import sys
from pathlib import Path
from starlette.testclient import TestClient

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app
from app.db import init_db, get_connection, search_transcripts
from app.services.transcriber import transcription_service

client = TestClient(app)

def test_stage1_regression():
    print("\n--- 1. Testing Stage 1 Regression ---")
    response = client.get("/api/health")
    assert response.status_code == 200, f"Health check failed: {response.text}"
    data = response.json()
    assert data["status"] == "healthy"
    print("   [PASS] FastAPI /api/health OK.")

def test_database_and_fts5():
    print("\n--- 2. Testing SQLite & FTS5 Indexing ---")
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row["name"] for row in cursor.fetchall()]
        assert "meetings" in tables, "meetings table missing"
        assert "transcript_segments" in tables, "transcript_segments table missing"
        assert "action_items" in tables, "action_items table missing"
        assert "transcript_fts" in tables, "transcript_fts FTS5 table missing"
    print("   [PASS] Database tables and FTS5 index verified.")

def test_transcription_service():
    print("\n--- 3. Testing faster-whisper Model & Transcription ---")
    sample_path = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    assert sample_path.exists(), f"Sample audio not found at {sample_path}"

    result = transcription_service.transcribe_file(sample_path)
    assert "segments" in result
    assert "duration_seconds" in result
    assert result["duration_seconds"] > 0
    print(f"   Detected language: {result.get('language')}")
    print(f"   Audio duration: {result.get('duration_seconds')}s")
    print(f"   Transcribed text: \"{result.get('full_text')}\"")
    print(f"   Segments extracted: {len(result.get('segments', []))}")
    assert len(result["segments"]) > 0, "Expected at least 1 segment"
    print("   [PASS] Speech transcription succeeded!")
    return result

def test_upload_and_retrieval_flow():
    print("\n--- 4. Testing End-to-End Upload, Retrieval & Search ---")
    sample_path = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    
    with open(sample_path, "rb") as f:
        audio_bytes = f.read()

    # 4a. Upload valid audio
    response = client.post(
        "/api/meetings/upload",
        files={"file": ("project_kickoff.wav", io.BytesIO(audio_bytes), "audio/wav")},
        data={"title": "Q4 Project Kickoff"}
    )
    assert response.status_code == 201, f"Upload failed: {response.status_code} - {response.text}"
    upload_data = response.json()
    meeting_id = upload_data["meeting_id"]
    assert upload_data["status"] == "completed"
    assert upload_data["title"] == "Q4 Project Kickoff"
    assert len(upload_data["segments"]) > 0
    print(f"   [PASS] Uploaded and transcribed meeting ID: {meeting_id}")

    # 4b. List meetings
    list_resp = client.get("/api/meetings")
    assert list_resp.status_code == 200
    meetings = list_resp.json()
    assert any(m["id"] == meeting_id for m in meetings), "Uploaded meeting not in meetings list"
    print(f"   [PASS] GET /api/meetings returned {len(meetings)} meeting(s).")

    # 4c. Get meeting details
    detail_resp = client.get(f"/api/meetings/{meeting_id}")
    assert detail_resp.status_code == 200
    details = detail_resp.json()
    assert details["id"] == meeting_id
    assert len(details["segments"]) > 0
    print(f"   [PASS] GET /api/meetings/{meeting_id} retrieved with {len(details['segments'])} segments.")

    # 4d. Full-text search
    search_resp = client.get("/api/meetings/search?q=roadmap")
    assert search_resp.status_code == 200
    search_results = search_resp.json()
    print(f"   [PASS] FTS5 Search for 'roadmap' returned {len(search_results)} match(es).")

def test_error_handling():
    print("\n--- 5. Testing Error Handling & Validation ---")
    # 5a. Invalid file extension (.exe)
    bad_ext_resp = client.post(
        "/api/meetings/upload",
        files={"file": ("malicious.exe", io.BytesIO(b"fake binary"), "application/octet-stream")},
        data={"title": "Malicious Test"}
    )
    assert bad_ext_resp.status_code == 400, f"Expected 400 for bad extension, got {bad_ext_resp.status_code}"
    print(f"   [PASS] Rejected invalid file extension: {bad_ext_resp.json().get('detail')}")

    # 5b. Empty audio file (0 bytes)
    empty_resp = client.post(
        "/api/meetings/upload",
        files={"file": ("empty.wav", io.BytesIO(b""), "audio/wav")},
        data={"title": "Empty Test"}
    )
    assert empty_resp.status_code == 400, f"Expected 400 for empty file, got {empty_resp.status_code}"
    print(f"   [PASS] Rejected empty file (0 bytes): {empty_resp.json().get('detail')}")

    # 5c. Non-existent meeting
    not_found_resp = client.get("/api/meetings/non-existent-id-12345")
    assert not_found_resp.status_code == 404
    print(f"   [PASS] Returned 404 for non-existent meeting: {not_found_resp.json().get('detail')}")

if __name__ == "__main__":
    print("==================================================")
    print("     STAGE 2 VERIFICATION TEST SUITE              ")
    print("==================================================")
    test_stage1_regression()
    test_database_and_fts5()
    test_transcription_service()
    test_upload_and_retrieval_flow()
    test_error_handling()
    print("\n==================================================")
    print("     ALL STAGE 2 TESTS PASSED PERFECTLY!          ")
    print("==================================================")
