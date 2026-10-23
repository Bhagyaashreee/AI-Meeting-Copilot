import sys
import httpx
from starlette.testclient import TestClient
from app.main import app

def test_backend_health():
    print("1. Testing FastAPI test client...")
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["status"] == "healthy", f"Unexpected response: {data}"
    print(f"   FastAPI Health Endpoint OK: {data}")

def test_ollama_connection():
    print("2. Testing Ollama connection via httpx...")
    try:
        response = httpx.get("http://localhost:11434/api/tags", timeout=5.0)
        assert response.status_code == 200
        models = [m["name"] for m in response.json().get("models", [])]
        print(f"   Ollama service OK. Available models: {models}")
    except Exception as e:
        print(f"   Warning: Could not connect to Ollama: {e}")

def test_whisper_import():
    print("3. Testing faster-whisper and ctranslate2 libraries...")
    import faster_whisper
    import ctranslate2
    supported_types = ctranslate2.get_supported_compute_types("cpu")
    print(f"   faster-whisper v{faster_whisper.__version__} OK.")
    print(f"   CTranslate2 supported CPU compute types: {supported_types}")

if __name__ == "__main__":
    print("=== Running Backend Stage 1 Verification ===")
    test_backend_health()
    test_ollama_connection()
    test_whisper_import()
    print("=== All Backend Stage 1 Checks Passed! ===")
