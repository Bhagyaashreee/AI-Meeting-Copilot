"""
Portfolio Upgrade Test Suite
Verifies:
1. Action item completion toggle (PATCH /api/meetings/{id}/action-items/{item_id})
2. Follow-up email drafting (POST /api/meetings/{id}/email-draft)
3. Configurable CORS & Health metadata (/api/health)
"""
import uuid
import json
from fastapi.testclient import TestClient

from app.main import app
from app.db import (
    init_db,
    create_meeting,
    save_meeting_summary_and_action_items,
    get_meeting_details,
    delete_meeting
)

client = TestClient(app)

def setup_database():
    init_db()

def test_health_check_endpoint():
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert data["version"] == "1.0.0"
    assert "engine" in data
    assert "faster-whisper" in data["engine"]["stt"]
    assert "Ollama" in data["engine"]["llm"]

def test_cors_headers():
    res = client.options(
        "/api/meetings",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET"
        }
    )
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "http://localhost:3000"

def test_action_item_completion_toggle():
    meeting_id = str(uuid.uuid4())
    create_meeting(meeting_id, title="Sprint Planning Test")

    # Add summary and action items
    summary_data = {
        "executive_summary": "Discussed roadmap and assigned key deliverables.",
        "key_discussion_points": ["Timeline", "Architecture"],
        "key_decisions": ["Deploy locally with Ollama"],
        "action_items": [
            {"task": "Build frontend dashboard", "owner": "Sarah", "due_date": "Oct 30"},
            {"task": "Run faster-whisper tests", "owner": "Dev", "due_date": None}
        ]
    }
    save_meeting_summary_and_action_items(
        meeting_id=meeting_id,
        summary_str=json.dumps(summary_data),
        action_items=summary_data["action_items"]
    )

    details = get_meeting_details(meeting_id)
    assert details is not None
    assert len(details["action_items"]) == 2
    item1 = details["action_items"][0]
    assert item1["completed"] is False or item1["completed"] == 0

    # 1. Update completed to True
    patch_res = client.patch(
        f"/api/meetings/{meeting_id}/action-items/{item1['id']}",
        json={"completed": True}
    )
    assert patch_res.status_code == 200
    patched_data = patch_res.json()
    assert patched_data["completed"] is True

    # Verify persisted in SQLite
    updated_details = get_meeting_details(meeting_id)
    assert updated_details["action_items"][0]["completed"] == 1 or updated_details["action_items"][0]["completed"] is True

    # 2. Toggle status without body
    toggle_res = client.patch(f"/api/meetings/{meeting_id}/action-items/{item1['id']}")
    assert toggle_res.status_code == 200
    toggled_data = toggle_res.json()
    assert toggled_data["completed"] is False

    # 3. Test non-existent action item
    err_res = client.patch(f"/api/meetings/{meeting_id}/action-items/999999")
    assert err_res.status_code == 404

    # Cleanup
    delete_meeting(meeting_id)

def test_email_draft_generation():
    meeting_id = str(uuid.uuid4())
    create_meeting(meeting_id, title="Q4 Product Review")

    # If no summary/tasks exist, should return 400
    err_res = client.post(f"/api/meetings/{meeting_id}/email-draft")
    assert err_res.status_code == 400

    # Add summary and action items
    summary_data = {
        "executive_summary": "Reviewed quarterly OKRs and agreed on the local privacy architecture.",
        "key_discussion_points": ["Privacy guarantees", "Whisper performance"],
        "key_decisions": ["Keep all speech transcription 100% on-device"],
        "action_items": [
            {"task": "Prepare portfolio release documentation", "owner": "Bhagyashree", "due_date": "Next Monday"}
        ]
    }
    save_meeting_summary_and_action_items(
        meeting_id=meeting_id,
        summary_str=json.dumps(summary_data),
        action_items=summary_data["action_items"]
    )

    # Generate follow-up email draft
    email_res = client.post(f"/api/meetings/{meeting_id}/email-draft")
    assert email_res.status_code == 200
    email_data = email_res.json()
    assert "email_draft" in email_data
    assert len(email_data["email_draft"]) > 50
    assert "Subject:" in email_data["email_draft"] or "subject:" in email_data["email_draft"].lower()

    # Cleanup
    delete_meeting(meeting_id)

if __name__ == "__main__":
    print("Running Portfolio Upgrade tests...")
    test_health_check_endpoint()
    print("[PASS] Health check endpoint")
    test_cors_headers()
    print("[PASS] CORS headers")
    test_action_item_completion_toggle()
    print("[PASS] Action item completion toggle in SQLite")
    test_email_draft_generation()
    print("[PASS] Follow-up email draft generation with Ollama")
    print("ALL PORTFOLIO UPGRADE TESTS PASSED!")
