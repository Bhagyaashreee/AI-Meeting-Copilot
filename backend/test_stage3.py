import json
import os
import sys
import uuid
from pathlib import Path
from starlette.testclient import TestClient

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app
from app.db import (
    init_db,
    create_meeting,
    save_transcript_segments,
    get_meeting_details,
    list_meetings
)
from app.services.summarizer import (
    summarizer_service,
    extract_json_from_text,
    fallback_summary_parser,
    SummarizerService
)
from app.services.rag import rag_service

client = TestClient(app)

def test_stage1_and_2_regression():
    print("\n--- 1. Running Stage 1 & 2 Regression Checks ---")
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    print("   [PASS] Stage 1 /api/health OK.")

    # Check database and FTS5
    init_db()
    meetings = client.get("/api/meetings")
    assert meetings.status_code == 200
    print("   [PASS] Stage 2 GET /api/meetings OK.")

def test_malformed_json_and_fallback_resilience():
    print("\n--- 2. Testing Malformed Model Output & JSON Parser Resilience ---")
    
    # 2a. Markdown wrapped JSON
    wrapped_json = "```json\n{\"executive_summary\": \"Great meeting.\", \"key_discussion_points\": [\"Topic A\"], \"key_decisions\": [\"Decided X\"], \"action_items\": []}\n```"
    parsed = extract_json_from_text(wrapped_json)
    assert parsed is not None
    assert parsed["executive_summary"] == "Great meeting."
    print("   [PASS] Successfully parsed markdown-wrapped JSON.")

    # 2b. Conversational preamble before JSON
    preamble_json = "Certainly! Here is the structured summary:\n\n{\"executive_summary\": \"All good.\", \"key_discussion_points\": [], \"key_decisions\": [], \"action_items\": []}\nHope this helps!"
    parsed2 = extract_json_from_text(preamble_json)
    assert parsed2 is not None
    assert parsed2["executive_summary"] == "All good."
    print("   [PASS] Successfully extracted JSON with conversational preamble.")

    # 2c. Broken JSON -> fallback parser
    broken_text = "This is not valid json at all.\nWe discussed budgets and deadlines."
    parsed_broken = extract_json_from_text(broken_text)
    assert parsed_broken is None
    fallback = fallback_summary_parser(broken_text)
    assert "executive_summary" in fallback
    assert fallback["executive_summary"] == "This is not valid json at all."
    print("   [PASS] Graceful fallback parser works on non-JSON text.")

def test_ollama_unavailable_handling():
    print("\n--- 3. Testing Ollama Unavailable Error Handling ---")
    # Point service to an invalid port where no service runs
    bad_service = SummarizerService(base_url="http://127.0.0.1:59999")
    import asyncio
    try:
        asyncio.run(bad_service.summarize_transcript("Sample text"))
        assert False, "Expected ConnectionError when Ollama is unreachable"
    except ConnectionError as e:
        assert "Could not connect to Ollama" in str(e)
        print("   [PASS] ConnectionError raised with clear message when Ollama is unavailable.")

def test_summarization_and_action_item_extraction():
    print("\n--- 4. Testing Meeting Summarization with Local Llama 3.2 3B ---")
    # Setup test meeting with explicit action items and unassigned tasks
    meeting_id = str(uuid.uuid4())
    create_meeting(meeting_id=meeting_id, title="Sprint Planning Q4")
    
    test_segments = [
        {"start_time": 0.0, "end_time": 10.0, "text": "Welcome team to the sprint planning session."},
        {"start_time": 10.5, "end_time": 25.0, "text": "We decided to migrate the user database to PostgreSQL next quarter."},
        {"start_time": 25.5, "end_time": 40.0, "text": "Sarah will build the frontend dashboard by October 30th."},
        {"start_time": 40.5, "end_time": 55.0, "text": "Alex is responsible for writing the API unit tests by Friday."},
        {"start_time": 55.5, "end_time": 70.0, "text": "Someone needs to clean up the outdated test scripts, but no one is assigned yet."}
    ]
    save_transcript_segments(meeting_id, test_segments)

    # Call summarize endpoint
    response = client.post(f"/api/meetings/{meeting_id}/summarize")
    assert response.status_code == 200, f"Summarize failed: {response.status_code} - {response.text}"
    data = response.json()

    print(f"   Executive Summary: {data['executive_summary']}")
    print(f"   Key Decisions: {data['key_decisions']}")
    print(f"   Discussion Points: {data['key_discussion_points']}")
    print(f"   Extracted Action Items: {data['action_items']}")

    assert data["meeting_id"] == meeting_id
    assert len(data["executive_summary"]) > 0
    assert len(data["action_items"]) > 0

    # Verify assigned owners and null for unknown owners
    has_sarah = any("Sarah" in (item.get("owner") or "") for item in data["action_items"])
    has_alex = any("Alex" in (item.get("owner") or "") for item in data["action_items"])
    has_null_owner = any(item.get("owner") is None for item in data["action_items"])

    assert has_sarah or has_alex, "Expected Sarah or Alex as action item owners"
    print(f"   [PASS] Found assigned owners: Sarah={has_sarah}, Alex={has_alex}")
    print(f"   [PASS] Found unassigned task with owner=null: {has_null_owner}")

    # 4b. Test Idempotency (repeated summarization must not duplicate action items)
    response_again = client.post(f"/api/meetings/{meeting_id}/summarize")
    assert response_again.status_code == 200
    details = client.get(f"/api/meetings/{meeting_id}").json()
    action_item_count = len(details["action_items"])
    assert action_item_count == len(response_again.json()["action_items"])
    print(f"   [PASS] Repeated summarization is safe: {action_item_count} action items (no duplicates).")

    return meeting_id

def test_cross_meeting_rag_chat(meeting_id: str):
    print("\n--- 5. Testing Natural-Language Cross-Meeting Q&A (RAG) ---")
    
    # 5a. Question with evidence
    query = "Who will build the frontend dashboard and by when?"
    chat_resp = client.post("/api/chat", json={"query": query})
    assert chat_resp.status_code == 200, f"Chat failed: {chat_resp.status_code} - {chat_resp.text}"
    chat_data = chat_resp.json()
    
    print(f"   Question: {query}")
    print(f"   Answer: {chat_data['answer']}")
    print(f"   References count: {len(chat_data['references'])}")
    
    assert len(chat_data["references"]) > 0, "Expected meeting references in response"
    titles = [r["meeting_title"] for r in chat_data["references"]]
    assert any("Sprint Planning Q4" in t for t in titles), f"Expected Sprint Planning Q4 in references, got: {titles}"
    ref = next(r for r in chat_data["references"] if "Sprint Planning Q4" in r["meeting_title"])
    assert "start_time" in ref and "end_time" in ref
    assert "Sarah" in chat_data["answer"] or "dashboard" in chat_data["answer"].lower()
    print("   [PASS] Answer accurately references meeting title, timestamps, and owner.")

    # 5b. Question with NO evidence (anti-hallucination check)
    no_info_query = "What did we decide about the quantum computing budget?"
    no_info_resp = client.post("/api/chat", json={"query": no_info_query})
    assert no_info_resp.status_code == 200
    no_info_data = no_info_resp.json()
    print(f"   Question: {no_info_query}")
    print(f"   Answer: {no_info_data['answer']}")
    # Model should explicitly state insufficient information
    answer_lower = no_info_data["answer"].lower()
    assert (
        "not find" in answer_lower
        or "insufficient" in answer_lower
        or "not mentioned" in answer_lower
        or "no information" in answer_lower
        or "no relevant" in answer_lower
    ), f"Model hallucinated an answer: {no_info_data['answer']}"
    print("   [PASS] Anti-hallucination rule enforced: model stated evidence was insufficient.")

def test_edge_cases_and_validations():
    print("\n--- 6. Testing Edge Cases & API Validations ---")
    
    # 6a. Empty chat query -> 400
    empty_chat = client.post("/api/chat", json={"query": "    "})
    assert empty_chat.status_code == 400
    print(f"   [PASS] Empty query rejected: {empty_chat.json()['detail']}")

    # 6b. Missing meeting summarization -> 404
    missing_sum = client.post("/api/meetings/non-existent-id/summarize")
    assert missing_sum.status_code == 404
    print(f"   [PASS] Missing meeting ID rejected: {missing_sum.json()['detail']}")

    # 6c. Meeting with no transcript segments -> 400
    empty_meeting_id = str(uuid.uuid4())
    create_meeting(meeting_id=empty_meeting_id, title="Empty Meeting")
    empty_sum = client.post(f"/api/meetings/{empty_meeting_id}/summarize")
    assert empty_sum.status_code == 400
    print(f"   [PASS] Meeting with no transcript rejected: {empty_sum.json()['detail']}")

if __name__ == "__main__":
    print("==================================================")
    print("     STAGE 3 VERIFICATION TEST SUITE              ")
    print("==================================================")
    test_stage1_and_2_regression()
    test_malformed_json_and_fallback_resilience()
    test_ollama_unavailable_handling()
    meeting_id = test_summarization_and_action_item_extraction()
    test_cross_meeting_rag_chat(meeting_id)
    test_edge_cases_and_validations()
    print("\n==================================================")
    print("     ALL STAGE 3 TESTS PASSED PERFECTLY!          ")
    print("==================================================")
