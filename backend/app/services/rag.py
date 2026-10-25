import logging
from typing import Dict, Any, List, Optional
import httpx

from app.config import OLLAMA_BASE_URL, OLLAMA_MODEL
from app.db import retrieve_rag_context
from app.services.llm import llm_service

logger = logging.getLogger(__name__)

RAG_SYSTEM_PROMPT = """You are an AI Meeting Copilot.
Your job is to answer user questions about past meetings using ONLY the provided meeting excerpts below.

Strict Grounding Instructions:
1. Answer strictly based on the provided meeting excerpts.
2. If the provided excerpts do not contain enough evidence to answer the question, say clearly: "I could not find sufficient information in the recorded meetings to answer this question."
3. When stating information, mention the meeting title and timestamp (e.g., in "Project Kickoff" at 00:45).
4. Do not invent, speculate, or extrapolate facts that are not explicitly stated.
"""

def format_timestamp(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"

class RAGService:
    def __init__(self, base_url: str = OLLAMA_BASE_URL, model: str = OLLAMA_MODEL):
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def answer_question(self, query: str, meeting_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieve relevant meeting segments from SQLite FTS5 and answer using local Ollama model.
        """
        cleaned_query = (query or "").strip()
        if not cleaned_query:
            return {
                "answer": "Please provide a question about your meetings.",
                "references": []
            }

        # 1. Retrieve evidence from SQLite FTS5 index
        segments = retrieve_rag_context(query=cleaned_query, meeting_id=meeting_id, limit=8)

        if not segments:
            return {
                "answer": "I could not find any relevant meeting discussions in the recorded meetings to answer your question.",
                "references": []
            }

        # 2. Build grounded context block with timestamps and meeting titles
        context_blocks: List[str] = []
        references: List[Dict[str, Any]] = []

        for seg in segments:
            start_str = format_timestamp(seg["start_time"])
            end_str = format_timestamp(seg["end_time"])
            title = seg.get("meeting_title", "Meeting")
            context_blocks.append(
                f"[{title} | Time: {start_str} - {end_str}]\n{seg['text']}"
            )
            references.append({
                "meeting_id": seg["meeting_id"],
                "meeting_title": title,
                "start_time": seg["start_time"],
                "end_time": seg["end_time"],
                "text": seg["text"]
            })

        formatted_context = "\n\n".join(context_blocks)
        user_prompt = (
            f"Meeting Excerpts:\n\"\"\"\n{formatted_context}\n\"\"\"\n\n"
            f"Question: {cleaned_query}\n\nAnswer:"
        )

        answer = await llm_service.generate(
            prompt=user_prompt,
            system=RAG_SYSTEM_PROMPT,
            temperature=0.2,
            max_tokens=512,
            base_url=self.base_url if self.base_url != OLLAMA_BASE_URL.rstrip("/") else None,
            model=self.model if self.model != OLLAMA_MODEL else None,
        )

        return {
            "answer": answer or "I could not find sufficient information in the recorded meetings to answer this question.",
            "references": references
        }

# Singleton instance
rag_service = RAGService()
