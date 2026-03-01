import hashlib
import json
import math
import os
import re
from pathlib import Path
from typing import Any

import psycopg
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

RAG_VECTOR_DIM = int(os.getenv("RAG_VECTOR_DIM", "256"))
DATABASE_URL = os.getenv(
    "DATABASE_URL"
)
RAG_AUTO_SEED = os.getenv("RAG_AUTO_SEED", "true").lower() in {"1", "true", "yes"}

_TOKEN_RE = re.compile(r"[a-z0-9']+")


def _embed_text(text: str, dim: int = RAG_VECTOR_DIM) -> list[float]:
    vec = [0.0] * dim
    for token in _TOKEN_RE.findall(text.lower()):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:8], "big") % dim
        vec[idx] += 1.0

    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:
        return vec
    return [v / norm for v in vec]


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def _seed_path() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "wildfire_guidance_seed.json"


def load_seed_documents() -> list[dict[str, Any]]:
    with _seed_path().open("r", encoding="utf-8") as f:
        return json.load(f)


def ensure_rag_schema() -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cur.execute(
                f"""
                CREATE TABLE IF NOT EXISTS guidance_documents (
                    id BIGSERIAL PRIMARY KEY,
                    doc_id TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    source_org TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    audience TEXT[] NOT NULL DEFAULT '{{}}',
                    content TEXT NOT NULL,
                    metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    embedding vector({RAG_VECTOR_DIM}) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS guidance_documents_topic_idx
                ON guidance_documents (topic)
                """
            )
        conn.commit()


def seed_documents(documents: list[dict[str, Any]]) -> int:
    inserted = 0
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            for doc in documents:
                content = doc["content"].strip()
                embedding = _vector_literal(_embed_text(" ".join([
                    doc.get("title", ""),
                    doc.get("topic", ""),
                    content,
                ])))
                metadata = {
                    "source_org": doc["source_org"],
                    "topic": doc["topic"],
                    "audience": doc.get("audience", []),
                }
                cur.execute(
                    """
                    INSERT INTO guidance_documents (
                        doc_id, title, source_url, source_org, topic, audience, content, metadata, embedding
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::vector
                    )
                    ON CONFLICT (doc_id) DO UPDATE SET
                        title = EXCLUDED.title,
                        source_url = EXCLUDED.source_url,
                        source_org = EXCLUDED.source_org,
                        topic = EXCLUDED.topic,
                        audience = EXCLUDED.audience,
                        content = EXCLUDED.content,
                        metadata = EXCLUDED.metadata,
                        embedding = EXCLUDED.embedding,
                        updated_at = NOW()
                    """,
                    (
                        doc["doc_id"],
                        doc["title"],
                        doc["source_url"],
                        doc["source_org"],
                        doc["topic"],
                        doc.get("audience", []),
                        content,
                        json.dumps(metadata),
                        embedding,
                    ),
                )
                inserted += 1
        conn.commit()
    return inserted


def initialize_rag_store() -> None:
    ensure_rag_schema()
    if not RAG_AUTO_SEED:
        return

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM guidance_documents")
            existing = cur.fetchone()[0]
        conn.commit()

    if existing == 0:
        seed_documents(load_seed_documents())


def retrieve_guidance(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    embedding = _vector_literal(_embed_text(query))
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    doc_id,
                    title,
                    source_url,
                    source_org,
                    topic,
                    audience,
                    content,
                    1 - (embedding <=> %s::vector) AS score
                FROM guidance_documents
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (embedding, embedding, top_k),
            )
            rows = cur.fetchall()
        conn.commit()

    results = []
    for row in rows:
        results.append(
            {
                "doc_id": row[0],
                "title": row[1],
                "source_url": row[2],
                "source_org": row[3],
                "topic": row[4],
                "audience": row[5] or [],
                "content": row[6],
                "score": round(float(row[7]), 4),
            }
        )
    return results
