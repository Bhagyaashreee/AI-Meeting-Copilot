import json
import logging
import re
from typing import Dict, Any, List, Optional
import httpx
from app.config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_SECONDS
from app.services.llm import llm_service

logger = logging.getLogger(__name__)

SUMMARY_SYSTEM_PROMPT = """You are an expert AI Meeting Assistant.
Your task is to analyze the provided meeting transcript and return a structured JSON response.

Strict Rules:
1. Return ONLY a valid JSON object. Do not include introductory text, conversational remarks, or markdown explanations.
2. The JSON object must have exactly these keys:
   - "executive_summary": A concise overview (2-4 sentences) summarizing the main purpose and outcome of the meeting.
   - "key_discussion_points": A list of strings, each summarizing an important topic discussed.
   - "key_decisions": A list of strings, each representing a concrete decision agreed upon during the meeting.
   - "action_items": A list of objects, each containing:
     - "task": A clear description of the action to be done.
     - "owner": The full name of the person assigned, OR null if no owner is explicitly assigned or named.
     - "due_date": The deadline or date mentioned, OR null if no deadline is specified.

CRITICAL INTEGRITY INSTRUCTION:
- Never invent or hallucinate owners, tasks, or deadlines.
- If an action item does not state who is doing it, set "owner": null.
- If an action item does not state a due date, set "due_date": null.
"""

def extract_json_from_text(raw_text: str) -> Optional[Dict[str, Any]]:
    """
    Safely extract and parse JSON from LLM output, handling markdown fences
    and extra leading/trailing commentary.
    """
    if not raw_text or not raw_text.strip():
        return None

    cleaned = raw_text.strip()

    # 1. Strip markdown fences if present (```json ... ```)
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"```\s*$", "", cleaned, flags=re.MULTILINE).strip()

    # 2. Try direct json.loads
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    # 3. Locate the outermost curly braces { ... }
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        json_candidate = cleaned[first_brace : last_brace + 1]
        try:
            data = json.loads(json_candidate)
            if isinstance(data, dict):
                return data
        except Exception:
            pass

    return None

def fallback_summary_parser(raw_text: str) -> Dict[str, Any]:
    """
    Graceful fallback if LLM produces text rather than valid JSON.
    Extracts summary lines without crashing.
    """
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    executive_summary = lines[0] if lines else "Meeting summary generated."
    return {
        "executive_summary": executive_summary,
        "key_discussion_points": lines[1:4] if len(lines) > 1 else [],
        "key_decisions": [],
        "action_items": []
    }

class SummarizerService:
    def __init__(self, base_url: str = OLLAMA_BASE_URL, model: str = OLLAMA_MODEL):
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def summarize_transcript(self, transcript_text: str) -> Dict[str, Any]:
        """
        Send meeting transcript to local Ollama llama3.2:3b and return validated structured summary.
        """
        if not transcript_text or not transcript_text.strip():
            return {
                "executive_summary": "No transcript content available for summarization.",
                "key_discussion_points": [],
                "key_decisions": [],
                "action_items": []
            }

        prompt = f"Meeting Transcript:\n\"\"\"\n{transcript_text.strip()}\n\"\"\"\n\nProvide the structured JSON summary:"

        raw_llm_output = await llm_service.generate(
            prompt=prompt,
            system=SUMMARY_SYSTEM_PROMPT,
            format_json=True,
            temperature=0.1,
            max_tokens=1024,
            base_url=self.base_url if self.base_url != OLLAMA_BASE_URL.rstrip("/") else None,
            model=self.model if self.model != OLLAMA_MODEL else None,
        )

        # Parse and sanitize output
        parsed_data = extract_json_from_text(raw_llm_output)
        if not parsed_data:
            logger.warning(f"Could not parse valid JSON from Ollama. Using fallback parser. Raw output: {raw_llm_output[:200]}")
            parsed_data = fallback_summary_parser(raw_llm_output)

        # Sanitize and validate fields
        sanitized_summary = {
            "executive_summary": str(parsed_data.get("executive_summary") or "").strip(),
            "key_discussion_points": [str(p).strip() for p in parsed_data.get("key_discussion_points", []) if p],
            "key_decisions": [str(d).strip() for d in parsed_data.get("key_decisions", []) if d],
            "action_items": []
        }

        # Sanitize action items ensuring null for unknown owner/deadline
        for item in parsed_data.get("action_items", []):
            if not isinstance(item, dict):
                continue
            task = str(item.get("task") or "").strip()
            if not task:
                continue

            owner = item.get("owner")
            if owner is None or str(owner).strip().lower() in {"null", "none", "unknown", "unassigned", ""}:
                owner = None
            else:
                owner = str(owner).strip()

            due_date = item.get("due_date")
            if due_date is None or str(due_date).strip().lower() in {"null", "none", "unknown", "unspecified", "tbd", ""}:
                due_date = None
            else:
                due_date = str(due_date).strip()

            sanitized_summary["action_items"].append({
                "task": task,
                "owner": owner,
                "due_date": due_date
            })

        return sanitized_summary

    async def generate_followup_email(
        self,
        meeting_title: str,
        created_at: str,
        summary_data: Dict[str, Any]
    ) -> str:
        """
        Generate a professional stakeholder follow-up email draft based on
        meeting executive summary, key decisions, and action item assignments.
        """
        exec_summary = summary_data.get("executive_summary", "")
        decisions = summary_data.get("key_decisions", [])
        action_items = summary_data.get("action_items", [])

        decisions_txt = (
            "\n".join([f"- {d}" for d in decisions])
            if decisions
            else "None formally recorded."
        )
        actions_txt = (
            "\n".join([
                f"- {item.get('task')} (Owner: {item.get('owner') or 'Unassigned'}, Due: {item.get('due_date') or 'TBD'})"
                for item in action_items
            ])
            if action_items
            else "None assigned."
        )

        prompt = f"""You are an executive assistant drafting a crisp, professional post-meeting email.
Meeting: "{meeting_title}"
Date: {created_at}

Executive Summary:
{exec_summary}

Decisions Made:
{decisions_txt}

Action Items & Owners:
{actions_txt}

Guidelines:
1. Include a clear Subject line (e.g., "Subject: Recap & Next Steps - {meeting_title}").
2. Begin with a concise, polite opening acknowledging the team's discussion.
3. Structure the body with clear Markdown headings or bullet points: Summary, Key Decisions, and Action Items.
4. Conclude with an open, professional invitation for corrections or questions.
5. STRICT INTEGRITY: Do not invent names, dates, or details not present in the summary above.
"""
        try:
            return await llm_service.generate(
                prompt=prompt,
                temperature=0.2,
                max_tokens=750,
                base_url=self.base_url if self.base_url != OLLAMA_BASE_URL.rstrip("/") else None,
                model=self.model if self.model != OLLAMA_MODEL else None,
            )
        except Exception as e:
            logger.error(f"Error generating follow-up email draft: {e}", exc_info=True)
            # Fallback draft if Ollama is unreachable
            return f"""Subject: Recap & Action Items: {meeting_title}

Hi team,

Thank you for your time during our meeting on {created_at}. Below is a summary of what was discussed, decided, and assigned:

Summary:
{exec_summary}

Key Decisions:
{decisions_txt}

Action Items:
{actions_txt}

Please let me know if anything needs adjustment.

Best regards,
Meeting Copilot"""

# Singleton instance
summarizer_service = SummarizerService()
