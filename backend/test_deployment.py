import os
from starlette.testclient import TestClient
from unittest.mock import patch

from app.main import app
from app.db import check_db_health, init_db
from app.services.llm import LLMService
from app.services.transcriber import TranscriptionService

client = TestClient(app)

def test_health_check_production_schema():
    """Verify /api/health returns valid schema with DB health and LLM provider."""
    res = client.get("/api/health")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    data = res.json()
    assert data["status"] == "healthy", f"Expected 'healthy', got {data.get('status')}"
    assert data["version"] == "1.0.0", f"Expected version 1.0.0, got {data.get('version')}"
    assert data["database"] == "connected", f"Expected database 'connected', got {data.get('database')}"
    assert "llm_provider" in data
    assert "whisper_enabled" in data
    assert "engine" in data
    assert "stt" in data["engine"]
    assert "llm" in data["engine"]
    assert "database" in data["engine"]
    print("   [PASS] Health check returns full metadata and database connectivity.")

def test_cors_vercel_preview_regex():
    """Verify that CORS allows Vercel preview URLs via CORS_ORIGIN_REGEX."""
    preview_origin = "https://ai-meeting-copilot-preview-bhagyaashreee.vercel.app"
    res = client.options(
        "/api/meetings",
        headers={
            "Origin": preview_origin,
            "Access-Control-Request-Method": "GET"
        }
    )
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == preview_origin
    print("   [PASS] CORS regex dynamically allows Vercel preview URLs.")

def test_cors_localhost_allowed():
    """Verify standard localhost origins remain permitted."""
    res = client.options(
        "/api/meetings",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET"
        }
    )
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "http://localhost:3000"
    print("   [PASS] CORS localhost:3000 remains allowed.")

def test_db_health_check():
    """Verify database health checker confirms SQLite is accessible."""
    init_db()
    assert check_db_health() is True
    print("   [PASS] SQLite connectivity health check passed.")

def test_whisper_disabled_guard():
    """Verify graceful error when Whisper is disabled via WHISPER_ENABLED=False."""
    with patch("app.services.transcriber.WHISPER_ENABLED", False):
        service = TranscriptionService()
        threw = False
        try:
            service._get_model()
        except RuntimeError as e:
            threw = True
            assert "Speech transcription is disabled" in str(e)
        assert threw, "Expected RuntimeError when WHISPER_ENABLED=False"
    print("   [PASS] Whisper disabled guard handles low-memory environments gracefully.")

def test_llm_service_provider_selection():
    """Verify LLMService dynamically selects Ollama vs Groq vs OpenAI without hardcoding."""
    llm = LLMService()
    
    # Default without keys
    with patch("app.services.llm.GROQ_API_KEY", ""):
        with patch("app.services.llm.OPENAI_API_KEY", ""):
            assert llm.provider == "ollama"
            info = llm.get_info()
            assert info["provider"] == "ollama"
            assert info["mode"] == "local"

    # With GROQ_API_KEY
    with patch("app.services.llm.GROQ_API_KEY", "gsk_test_mock_key"):
        with patch("app.services.llm.OPENAI_API_KEY", ""):
            assert llm.provider == "groq"
            info = llm.get_info()
            assert info["provider"] == "groq"
            assert info["mode"] == "cloud"

    # With OPENAI_API_KEY
    with patch("app.services.llm.GROQ_API_KEY", ""):
        with patch("app.services.llm.OPENAI_API_KEY", "sk-test-key"):
            assert llm.provider == "openai"
            info = llm.get_info()
            assert info["provider"] == "openai"
            assert info["mode"] == "cloud"
    print("   [PASS] LLMService provider selection (Ollama, Groq, OpenAI) verified.")

if __name__ == "__main__":
    print("=== Running Deployment Verification Tests ===")
    test_health_check_production_schema()
    test_cors_vercel_preview_regex()
    test_cors_localhost_allowed()
    test_db_health_check()
    test_whisper_disabled_guard()
    test_llm_service_provider_selection()
    print("=== All Deployment Verification Tests Passed! ===")
