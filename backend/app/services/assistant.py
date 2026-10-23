import logging
from typing import Dict, Any, List, Optional
import httpx

from app.config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

GENERAL_ASSISTANT_SYSTEM_PROMPT = """You are a helpful, warm, and natural AI personal voice assistant.
Your responses will be spoken aloud to the user, so follow these guidelines:
1. Keep your answers concise, natural, conversational, and direct (typically 1 to 3 sentences unless the user explicitly asks for detailed explanations).
2. Avoid markdown formatting such as bold asterisks (**), hashtags (#), or bullet points (* or -), because these sound unnatural when spoken aloud by text-to-speech engines. Use plain conversational English.
3. Respond warmly and naturally to greetings, pleasantries, and microphone checks (e.g. if the user says "Hi", "Hello", or "Can you hear me?", confirm warmly that you can hear them loud and clear).
4. Maintain context from earlier turns in the conversation so you can handle follow-up questions smoothly.
5. You do NOT have direct access to recorded meeting transcripts in this mode. If the user asks about specific recorded meetings, transcript quotes, or decisions made in a past meeting, politely remind them: "I'm in General Conversation mode right now. If you'd like me to look up specific meeting transcripts and details, please switch over to Meeting Assistant mode!"
"""

GREETING_TRIGGERS = {
    "hi", "hello", "hey", "hey there", "can you hear me", "can you hear me?",
    "hi can you hear me", "hi, can you hear me?", "hi can you hear me?",
    "is this working", "is this working?", "are you there", "are you there?",
    "good morning", "good afternoon", "good evening", "how are you", "how are you?"
}

class AssistantService:
    def __init__(self, base_url: str = OLLAMA_BASE_URL, model: str = OLLAMA_MODEL):
        self.base_url = base_url.rstrip("/")
        self.model = model

    def is_casual_greeting(self, text: str) -> bool:
        """
        Detects if user query is a simple greeting or microphone check.
        """
        cleaned = text.strip().lower().rstrip(".!?")
        if cleaned in GREETING_TRIGGERS:
            return True
        if "can you hear me" in cleaned:
            return True
        return False

    async def chat(
        self,
        query: str,
        history: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """
        Generate a conversational answer using the local Ollama LLM with multi-turn memory.
        No meeting search or transcript retrieval is performed.
        """
        cleaned_query = (query or "").strip()
        if not cleaned_query:
            return {
                "answer": "I'm listening! What would you like to talk about?",
                "mode": "general",
                "references": []
            }

        # Build message history for Ollama /api/chat
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": GENERAL_ASSISTANT_SYSTEM_PROMPT}
        ]

        if history:
            # Keep up to the 10 most recent conversation turns for context
            recent_turns = history[-10:]
            for turn in recent_turns:
                role = turn.get("role")
                content = (turn.get("content") or "").strip()
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": content})

        # Append current user question
        messages.append({"role": "user", "content": cleaned_query})

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.7,
                "num_predict": 256
            }
        }

        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{self.base_url}/api/chat",
                    json=payload
                )

                if response.status_code != 200:
                    logger.error(f"Ollama returned HTTP {response.status_code}: {response.text}")
                    raise RuntimeError(f"Ollama service error (HTTP {response.status_code})")

                response_data = response.json()
                msg = response_data.get("message", {})
                answer = (msg.get("content") or "").strip()

        except httpx.ConnectError as e:
            logger.error(f"Cannot connect to Ollama at {self.base_url}: {e}")
            raise ConnectionError(
                f"Could not connect to Ollama at {self.base_url}. Ensure the Ollama service is active."
            )
        except httpx.TimeoutException as e:
            logger.error(f"Ollama timed out during chat after {OLLAMA_TIMEOUT_SECONDS}s: {e}")
            raise TimeoutError("Local AI service timed out while generating response.")
        except Exception as e:
            logger.error(f"Error querying Ollama in assistant service: {e}", exc_info=True)
            raise RuntimeError(f"Failed to query local AI service: {str(e)}")

        return {
            "answer": answer or "I'm here! How can I help you today?",
            "mode": "general",
            "references": []
        }

# Singleton instance
assistant_service = AssistantService()
