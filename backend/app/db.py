import sqlite3
import json
import re
from contextlib import contextmanager
from typing import List, Dict, Any, Optional
from datetime import datetime
from app.config import DB_PATH

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initialize SQLite database tables and FTS5 search index."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Meetings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                audio_filename TEXT,
                duration_seconds REAL DEFAULT 0.0,
                status TEXT NOT NULL DEFAULT 'processing',
                summary TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)
        
        # Transcript segments table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transcript_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                text TEXT NOT NULL,
                speaker TEXT DEFAULT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            );
        """)
        
        # Action items table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS action_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT NOT NULL,
                task TEXT NOT NULL,
                owner TEXT,
                due_date TEXT,
                completed INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            );
        """)
        
        # SQLite FTS5 Virtual Table for full-text search
        cursor.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
                meeting_id UNINDEXED,
                segment_id UNINDEXED,
                text
            );
        """)

def create_meeting(meeting_id: str, title: str, audio_filename: Optional[str] = None) -> Dict[str, Any]:
    now = datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO meetings (id, title, audio_filename, duration_seconds, status, created_at, updated_at)
            VALUES (?, ?, ?, 0.0, 'processing', ?, ?)
        """, (meeting_id, title, audio_filename, now, now))
    return {
        "id": meeting_id,
        "title": title,
        "audio_filename": audio_filename,
        "status": "processing",
        "created_at": now
    }

def update_meeting_status(
    meeting_id: str,
    status: str,
    duration_seconds: Optional[float] = None,
    summary: Optional[str] = None
):
    now = datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        if duration_seconds is not None and summary is not None:
            cursor.execute("""
                UPDATE meetings
                SET status = ?, duration_seconds = ?, summary = ?, updated_at = ?
                WHERE id = ?
            """, (status, duration_seconds, summary, now, meeting_id))
        elif duration_seconds is not None:
            cursor.execute("""
                UPDATE meetings
                SET status = ?, duration_seconds = ?, updated_at = ?
                WHERE id = ?
            """, (status, duration_seconds, now, meeting_id))
        elif summary is not None:
            cursor.execute("""
                UPDATE meetings
                SET status = ?, summary = ?, updated_at = ?
                WHERE id = ?
            """, (status, summary, now, meeting_id))
        else:
            cursor.execute("""
                UPDATE meetings
                SET status = ?, updated_at = ?
                WHERE id = ?
            """, (status, now, meeting_id))

def delete_meeting(meeting_id: str):
    """Delete a meeting and all associated records from SQLite."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
        cursor.execute("DELETE FROM transcript_segments WHERE meeting_id = ?", (meeting_id,))
        cursor.execute("DELETE FROM transcript_fts WHERE meeting_id = ?", (meeting_id,))
        cursor.execute("DELETE FROM action_items WHERE meeting_id = ?", (meeting_id,))

def save_meeting_summary_and_action_items(
    meeting_id: str,
    summary_str: str,
    action_items: List[Dict[str, Any]]
):
    """
    Safely update meeting summary and replace action items.
    Prevents duplicates on repeated summarizations.
    """
    now = datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Update meeting summary
        cursor.execute("""
            UPDATE meetings
            SET summary = ?, updated_at = ?
            WHERE id = ?
        """, (summary_str, now, meeting_id))
        
        # 2. Clear existing action items for idempotency
        cursor.execute("DELETE FROM action_items WHERE meeting_id = ?", (meeting_id,))
        
        # 3. Insert newly extracted action items
        for item in action_items:
            task = (item.get("task") or "").strip()
            if not task:
                continue
            owner = item.get("owner")
            if owner is not None:
                owner = str(owner).strip() or None
            due_date = item.get("due_date")
            if due_date is not None:
                due_date = str(due_date).strip() or None

            cursor.execute("""
                INSERT INTO action_items (meeting_id, task, owner, due_date, completed)
                VALUES (?, ?, ?, ?, ?)
            """, (meeting_id, task, owner, due_date, 0))

def save_transcript_segments(meeting_id: str, segments: List[Dict[str, Any]]):
    """Insert transcript segments and populate FTS5 search index."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM transcript_segments WHERE meeting_id = ?", (meeting_id,))
        cursor.execute("DELETE FROM transcript_fts WHERE meeting_id = ?", (meeting_id,))
        for seg in segments:
            cursor.execute("""
                INSERT INTO transcript_segments (meeting_id, start_time, end_time, text, speaker)
                VALUES (?, ?, ?, ?, ?)
            """, (meeting_id, seg["start_time"], seg["end_time"], seg["text"], seg.get("speaker")))
            segment_id = cursor.lastrowid
            
            # Sync to FTS5 index
            cursor.execute("""
                INSERT INTO transcript_fts (meeting_id, segment_id, text)
                VALUES (?, ?, ?)
            """, (meeting_id, segment_id, seg["text"]))

def list_meetings() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                m.id,
                m.title,
                m.audio_filename,
                m.duration_seconds,
                m.status,
                m.summary,
                m.created_at,
                m.updated_at,
                COUNT(DISTINCT ts.id) AS segment_count,
                COUNT(DISTINCT ai.id) AS action_item_count
            FROM meetings m
            LEFT JOIN transcript_segments ts ON m.id = ts.meeting_id
            LEFT JOIN action_items ai ON m.id = ai.meeting_id
            GROUP BY m.id
            ORDER BY m.created_at DESC
        """)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def get_meeting_details(meeting_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,))
        meeting_row = cursor.fetchone()
        if not meeting_row:
            return None
        
        meeting = dict(meeting_row)
        
        # Fetch segments
        cursor.execute("""
            SELECT id, start_time, end_time, text, speaker
            FROM transcript_segments
            WHERE meeting_id = ?
            ORDER BY start_time ASC
        """, (meeting_id,))
        meeting["segments"] = [dict(row) for row in cursor.fetchall()]
        
        # Fetch action items
        cursor.execute("""
            SELECT id, task, owner, due_date, completed
            FROM action_items
            WHERE meeting_id = ?
            ORDER BY id ASC
        """, (meeting_id,))
        meeting["action_items"] = [dict(row) for row in cursor.fetchall()]
        
        return meeting

def get_meeting_segments(meeting_id: str) -> List[Dict[str, Any]]:
    """Return all segments for a specific meeting."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, meeting_id, start_time, end_time, text, speaker
            FROM transcript_segments
            WHERE meeting_id = ?
            ORDER BY start_time ASC
        """, (meeting_id,))
        return [dict(row) for row in cursor.fetchall()]

def search_transcripts(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Search transcripts using SQLite FTS5 with fallback to LIKE."""
    cleaned_query = query.strip()
    if not cleaned_query:
        return []
        
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            # FTS5 search
            safe_query = '"' + cleaned_query.replace('"', '""') + '"'
            cursor.execute("""
                SELECT 
                    fts.meeting_id,
                    fts.segment_id,
                    fts.text,
                    m.title AS meeting_title,
                    ts.start_time,
                    ts.end_time
                FROM transcript_fts fts
                JOIN meetings m ON fts.meeting_id = m.id
                JOIN transcript_segments ts ON fts.segment_id = ts.id
                WHERE transcript_fts MATCH ?
                ORDER BY ts.id DESC
                LIMIT ?
            """, (safe_query, limit))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        except sqlite3.OperationalError:
            # Fallback to standard LIKE
            cursor.execute("""
                SELECT 
                    ts.meeting_id,
                    ts.id AS segment_id,
                    ts.text,
                    m.title AS meeting_title,
                    ts.start_time,
                    ts.end_time
                FROM transcript_segments ts
                JOIN meetings m ON ts.meeting_id = m.id
                WHERE ts.text LIKE ?
                ORDER BY ts.id DESC
                LIMIT ?
            """, (f"%{cleaned_query}%", limit))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

def retrieve_rag_context(query: str, meeting_id: Optional[str] = None, limit: int = 8) -> List[Dict[str, Any]]:
    """
    Retrieve relevant transcript segments across meetings or within a single meeting for RAG.
    Extracts keywords and performs FTS5 search; falls back to recent segments if no direct matches.
    """
    cleaned_query = query.strip()
    words = [w for w in re.findall(r"\w+", cleaned_query) if len(w) > 2]
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Try FTS5 with OR-joined keywords if available
        if words:
            fts_query = " OR ".join([f'"{w}"' for w in words[:6]])
            try:
                if meeting_id:
                    cursor.execute("""
                        SELECT 
                            ts.id AS segment_id,
                            ts.meeting_id,
                            ts.start_time,
                            ts.end_time,
                            ts.text,
                            m.title AS meeting_title
                        FROM transcript_fts fts
                        JOIN transcript_segments ts ON fts.segment_id = ts.id
                        JOIN meetings m ON ts.meeting_id = m.id
                        WHERE transcript_fts MATCH ? AND ts.meeting_id = ?
                        ORDER BY ts.start_time ASC
                        LIMIT ?
                    """, (fts_query, meeting_id, limit))
                else:
                    cursor.execute("""
                        SELECT 
                            ts.id AS segment_id,
                            ts.meeting_id,
                            ts.start_time,
                            ts.end_time,
                            ts.text,
                            m.title AS meeting_title
                        FROM transcript_fts fts
                        JOIN transcript_segments ts ON fts.segment_id = ts.id
                        JOIN meetings m ON ts.meeting_id = m.id
                        WHERE transcript_fts MATCH ?
                        ORDER BY ts.meeting_id, ts.start_time ASC
                        LIMIT ?
                    """, (fts_query, limit))
                results = [dict(row) for row in cursor.fetchall()]
                if results:
                    return results
            except sqlite3.OperationalError:
                pass
        
        # 2. Fallback to LIKE matching
        if words:
            like_clause = " OR ".join(["ts.text LIKE ?" for _ in words[:4]])
            params: List[Any] = [f"%{w}%" for w in words[:4]]
            
            query_sql = f"""
                SELECT 
                    ts.id AS segment_id,
                    ts.meeting_id,
                    ts.start_time,
                    ts.end_time,
                    ts.text,
                    m.title AS meeting_title
                FROM transcript_segments ts
                JOIN meetings m ON ts.meeting_id = m.id
                WHERE ({like_clause})
            """
            if meeting_id:
                query_sql += " AND ts.meeting_id = ?"
                params.append(meeting_id)
            query_sql += " ORDER BY ts.start_time ASC LIMIT ?"
            params.append(limit)
            
            cursor.execute(query_sql, tuple(params))
            results = [dict(row) for row in cursor.fetchall()]
            if results:
                return results

        # 3. If still empty, return general segments (for summary/context if meeting_id provided)
        if meeting_id:
            cursor.execute("""
                SELECT 
                    ts.id AS segment_id,
                    ts.meeting_id,
                    ts.start_time,
                    ts.end_time,
                    ts.text,
                    m.title AS meeting_title
                FROM transcript_segments ts
                JOIN meetings m ON ts.meeting_id = m.id
                WHERE ts.meeting_id = ?
                ORDER BY ts.start_time ASC
                LIMIT ?
            """, (meeting_id, limit))
            return [dict(row) for row in cursor.fetchall()]

        return []
