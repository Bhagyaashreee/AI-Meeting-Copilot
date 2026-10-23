from pydantic import BaseModel
from typing import List, Optional

class TranscriptSegmentResponse(BaseModel):
    id: Optional[int] = None
    start_time: float
    end_time: float
    text: str
    speaker: Optional[str] = None

class ActionItemResponse(BaseModel):
    id: Optional[int] = None
    task: str
    owner: Optional[str] = None
    due_date: Optional[str] = None
    completed: bool = False

class MeetingSummaryResponse(BaseModel):
    id: str
    title: str
    audio_filename: Optional[str] = None
    duration_seconds: float
    status: str
    summary: Optional[str] = None
    created_at: str
    updated_at: str
    segment_count: int = 0
    action_item_count: int = 0

class MeetingDetailResponse(BaseModel):
    id: str
    title: str
    audio_filename: Optional[str] = None
    duration_seconds: float
    status: str
    summary: Optional[str] = None
    created_at: str
    updated_at: str
    segments: List[TranscriptSegmentResponse] = []
    action_items: List[ActionItemResponse] = []

class UploadResponse(BaseModel):
    meeting_id: str
    title: str
    status: str
    duration_seconds: float
    language: str
    full_text: str
    segments: List[TranscriptSegmentResponse]

class SummarizeResponse(BaseModel):
    meeting_id: str
    executive_summary: str
    key_discussion_points: List[str]
    key_decisions: List[str]
    action_items: List[ActionItemResponse]

class MessageItem(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    query: str
    mode: Optional[str] = None
    meeting_id: Optional[str] = None
    history: Optional[List[MessageItem]] = []

class ReferenceItem(BaseModel):
    meeting_id: str
    meeting_title: str
    start_time: float
    end_time: float
    text: str

class ChatResponse(BaseModel):
    answer: str
    references: List[ReferenceItem] = []
    mode: str = "general"

class VoiceChatResponse(BaseModel):
    query: str
    answer: str
    references: List[ReferenceItem] = []
    mode: str = "general"

class TranscribeResponse(BaseModel):
    text: str
    duration_seconds: float
    language: str

