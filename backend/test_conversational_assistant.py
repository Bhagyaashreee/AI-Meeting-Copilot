import sys
import io
import json
from pathlib import Path
from starlette.testclient import TestClient

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app
from app.db import init_db, list_meetings

client = TestClient(app)

def test_greeting_handling():
    print("\n--- 1. Testing Greetings Handling ('Hi, can you hear me?') ---")
    # Must receive a natural conversational answer, not "I could not find sufficient information..."
    resp = client.post("/api/chat", json={"query": "Hi, can you hear me?", "mode": "general"})
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    answer = data.get("answer", "")
    mode = data.get("mode", "")
    print(f"   Query: 'Hi, can you hear me?'")
    print(f"   Mode: {mode}")
    print(f"   Answer: \"{answer}\"")

    assert "could not find" not in answer.lower(), "Greeting should not return 'could not find sufficient information'!"
    assert len(answer) > 0
    assert mode == "general"
    assert data.get("references") == []
    print("   [PASS] 'Hi, can you hear me?' received a natural conversational response without meeting error.")

def test_dedicated_general_endpoint():
    print("\n--- 2. Testing Dedicated POST /api/chat/general ---")
    resp = client.post("/api/chat/general", json={"query": "What is the boiling point of water?"})
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    answer = data.get("answer", "")
    print(f"   Answer: \"{answer}\"")
    assert "100" in answer or "boil" in answer.lower() or "celsius" in answer.lower() or "fahrenheit" in answer.lower()
    assert data.get("mode") == "general"
    assert data.get("references") == []
    print("   [PASS] Dedicated general endpoint works without meeting transcripts.")

def test_conversation_history_continuity():
    print("\n--- 3. Testing Conversation History Continuity Across Turns ---")
    history = [
        {"role": "user", "content": "My favorite color is emerald green."},
        {"role": "assistant", "content": "Emerald green is a stunning, vibrant color! How can I assist you with it today?"}
    ]
    resp = client.post(
        "/api/chat",
        json={
            "query": "What is my favorite color?",
            "mode": "general",
            "history": history
        }
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    answer = data.get("answer", "")
    print(f"   Follow-up query: 'What is my favorite color?'")
    print(f"   Answer: \"{answer}\"")
    assert "green" in answer.lower(), f"Expected answer to remember favorite color from history, got: {answer}"
    print("   [PASS] Conversation history preserved and handled correctly in follow-up turn.")

def test_meeting_mode_grounded_rag():
    print("\n--- 4. Testing Meeting Assistant Mode Grounded RAG & Citations ---")
    resp = client.post(
        "/api/chat",
        json={
            "query": "What are the action items?",
            "mode": "meeting"
        }
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    print(f"   Meeting Mode Answer: \"{data.get('answer')[:120]}...\"")
    print(f"   References count: {len(data.get('references', []))}")
    assert data.get("mode") == "meeting"
    assert "references" in data
    print("   [PASS] Meeting Assistant mode preserved evidence-grounded behavior.")

def test_general_voice_chat():
    print("\n--- 5. Testing Voice Chat in General Conversation Mode ---")
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"
    assert sample_wav.exists()

    with open(sample_wav, "rb") as f:
        resp = client.post(
            "/api/chat/voice",
            files={"file": ("speech.wav", f, "audio/wav")},
            data={"mode": "general"}
        )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    print(f"   Transcribed Query: \"{data.get('query')}\"")
    print(f"   General Voice Answer: \"{data.get('answer')[:120]}...\"")
    print(f"   Mode: {data.get('mode')}")
    assert data.get("mode") == "general"
    assert len(data.get("query", "")) > 0
    assert len(data.get("answer", "")) > 0
    print("   [PASS] General voice chat transcribes and generates conversational response.")

def test_dedicated_general_voice_endpoint():
    print("\n--- 6. Testing Dedicated POST /api/chat/general/voice ---")
    sample_wav = Path(__file__).resolve().parent / "data" / "sample_meeting.wav"

    history_json = json.dumps([
        {"role": "user", "content": "Hello!"},
        {"role": "assistant", "content": "Hi there! What can I help you with today?"}
    ])

    with open(sample_wav, "rb") as f:
        resp = client.post(
            "/api/chat/general/voice",
            files={"file": ("speech.wav", f, "audio/wav")},
            data={"history": history_json}
        )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    print(f"   Answer: \"{data.get('answer')[:100]}...\"")
    assert data.get("mode") == "general"
    print("   [PASS] Dedicated /api/chat/general/voice succeeded.")

def test_meeting_greeting_handling():
    print("\n--- 7. Testing Greeting Sent in Meeting Mode ---")
    resp = client.post(
        "/api/chat",
        json={"query": "Hi, can you hear me?", "mode": "meeting"}
    )
    assert resp.status_code == 200
    data = resp.json()
    answer = data.get("answer", "")
    print(f"   Answer: \"{answer}\"")
    assert "could not find" not in answer.lower()
    assert "hear you" in answer.lower()
    print("   [PASS] Greeting in meeting mode gracefully handled without transcript failure.")

if __name__ == "__main__":
    print("==================================================")
    print("  CONVERSATIONAL VOICE ASSISTANT TEST SUITE       ")
    print("==================================================")
    init_db()
    test_greeting_handling()
    test_dedicated_general_endpoint()
    test_conversation_history_continuity()
    test_meeting_mode_grounded_rag()
    test_general_voice_chat()
    test_dedicated_general_voice_endpoint()
    test_meeting_greeting_handling()
    print("\n==================================================")
    print("  ALL CONVERSATIONAL ASSISTANT TESTS PASSED!      ")
    print("==================================================")
