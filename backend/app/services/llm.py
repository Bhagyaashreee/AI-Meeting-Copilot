import logging
from typing import Dict, Any, List, Optional
import httpx
from app.config import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT_SECONDS,
    GROQ_API_KEY,
    GROQ_MODEL,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
    IS_RENDER,
)

logger = logging.getLogger(__name__)

class LLMService:
    @property
    def provider(self) -> str:
        if GROQ_API_KEY:
            return "groq"
        if OPENAI_API_KEY:
            return "openai"
        return "ollama"

    @property
    def model_name(self) -> str:
        if GROQ_API_KEY:
            return GROQ_MODEL
        if OPENAI_API_KEY:
            return OPENAI_MODEL
        return OLLAMA_MODEL

    def get_info(self) -> Dict[str, str]:
        p = self.provider
        if p == "groq":
            return {"provider": "groq", "model": GROQ_MODEL, "mode": "cloud"}
        if p == "openai":
            return {"provider": "openai", "model": OPENAI_MODEL, "mode": "cloud"}
        return {"provider": "ollama", "model": OLLAMA_MODEL, "mode": "local"}

    async def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        format_json: bool = False,
        temperature: float = 0.2,
        max_tokens: int = 1024,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        is_custom_ollama = bool(base_url and base_url.rstrip("/") != OLLAMA_BASE_URL.rstrip("/"))
        p = "ollama" if is_custom_ollama else self.provider
        if p in ("groq", "openai"):
            messages: List[Dict[str, str]] = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})

            return await self._call_cloud_chat(
                messages=messages,
                format_json=format_json,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        return await self._call_ollama_generate(
            prompt=prompt,
            system=system,
            format_json=format_json,
            temperature=temperature,
            max_tokens=max_tokens,
            base_url=base_url or OLLAMA_BASE_URL,
            model=model or OLLAMA_MODEL,
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 256,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        is_custom_ollama = bool(base_url and base_url.rstrip("/") != OLLAMA_BASE_URL.rstrip("/"))
        p = "ollama" if is_custom_ollama else self.provider
        if p in ("groq", "openai"):
            return await self._call_cloud_chat(
                messages=messages,
                format_json=False,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        return await self._call_ollama_chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            base_url=base_url or OLLAMA_BASE_URL,
            model=model or OLLAMA_MODEL,
        )

    async def _call_cloud_chat(
        self,
        messages: List[Dict[str, str]],
        format_json: bool,
        temperature: float,
        max_tokens: int,
    ) -> str:
        if self.provider == "groq":
            url = "https://api.groq.com/openai/v1/chat/completions"
            key = GROQ_API_KEY
            model = GROQ_MODEL
        else:
            url = f"{OPENAI_BASE_URL}/chat/completions"
            key = OPENAI_API_KEY
            model = OPENAI_MODEL

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if format_json:
            payload["response_format"] = {"type": "json_object"}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(url, headers=headers, json=payload)
                if res.status_code != 200:
                    logger.error(f"Cloud LLM ({self.provider}) returned HTTP {res.status_code}: {res.text}")
                    raise RuntimeError(f"Cloud AI service error ({self.provider} HTTP {res.status_code}): {res.text}")
                data = res.json()
                return data["choices"][0]["message"]["content"].strip()
        except httpx.TimeoutException:
            raise TimeoutError(f"Cloud AI service ({self.provider}) timed out.")
        except Exception as e:
            if not isinstance(e, (RuntimeError, TimeoutError)):
                logger.error(f"Error calling {self.provider}: {e}", exc_info=True)
                raise RuntimeError(f"Failed to communicate with cloud AI provider: {str(e)}")
            raise

    async def _call_ollama_generate(
        self,
        prompt: str,
        system: Optional[str],
        format_json: bool,
        temperature: float,
        max_tokens: int,
        base_url: str = OLLAMA_BASE_URL,
        model: str = OLLAMA_MODEL,
    ) -> str:
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        if system:
            payload["system"] = system
        if format_json:
            payload["format"] = "json"

        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
                res = await client.post(f"{base_url.rstrip('/')}/api/generate", json=payload)
                if res.status_code != 200:
                    logger.error(f"Ollama returned HTTP {res.status_code}: {res.text}")
                    raise RuntimeError(f"Ollama service error (HTTP {res.status_code})")
                return res.json().get("response", "").strip()
        except httpx.ConnectError as e:
            msg = self._build_connection_error_message(e, base_url=base_url)
            logger.error(msg)
            raise ConnectionError(msg)
        except httpx.TimeoutException as e:
            logger.error(f"Ollama timed out after {OLLAMA_TIMEOUT_SECONDS}s: {e}")
            raise TimeoutError("Local AI service timed out while processing request.")
        except Exception as e:
            if not isinstance(e, (RuntimeError, TimeoutError, ConnectionError)):
                logger.error(f"Unexpected error communicating with Ollama: {e}", exc_info=True)
                raise RuntimeError(f"Failed to communicate with local AI service: {str(e)}")
            raise

    async def _call_ollama_chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float,
        max_tokens: int,
        base_url: str = OLLAMA_BASE_URL,
        model: str = OLLAMA_MODEL,
    ) -> str:
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
                res = await client.post(f"{base_url.rstrip('/')}/api/chat", json=payload)
                if res.status_code != 200:
                    logger.error(f"Ollama returned HTTP {res.status_code}: {res.text}")
                    raise RuntimeError(f"Ollama service error (HTTP {res.status_code})")
                return res.json().get("message", {}).get("content", "").strip()
        except httpx.ConnectError as e:
            msg = self._build_connection_error_message(e, base_url=base_url)
            logger.error(msg)
            raise ConnectionError(msg)
        except httpx.TimeoutException as e:
            logger.error(f"Ollama timed out after {OLLAMA_TIMEOUT_SECONDS}s: {e}")
            raise TimeoutError("Local AI service timed out while generating response.")
        except Exception as e:
            if not isinstance(e, (RuntimeError, TimeoutError, ConnectionError)):
                logger.error(f"Unexpected error communicating with Ollama: {e}", exc_info=True)
                raise RuntimeError(f"Failed to communicate with local AI service: {str(e)}")
            raise

    def _build_connection_error_message(self, err: Exception, base_url: str = OLLAMA_BASE_URL) -> str:
        if "localhost" in base_url or "127.0.0.1" in base_url:
            if IS_RENDER:
                return (
                    f"Could not connect to Ollama at {base_url} from Render cloud hosting. "
                    "On Render, 'localhost' points to the container itself where Ollama is not installed. "
                    "To enable AI features on Render, set GROQ_API_KEY (free at console.groq.com) "
                    "or set OLLAMA_BASE_URL to an externally reachable Ollama instance URL."
                )
            return (
                f"Could not connect to Ollama at {base_url}. "
                "Ensure the Ollama service is active."
            )
        return f"Could not connect to Ollama at {base_url}. ({err})"

llm_service = LLMService()

