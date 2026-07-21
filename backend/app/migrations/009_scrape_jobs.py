from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
CREATE TABLE IF NOT EXISTS scrape_job (
    id uuid PRIMARY KEY,
    status text NOT NULL DEFAULT 'queued',
    query text NOT NULL,
    role text,
    location jsonb,
    max_results int NOT NULL DEFAULT 25,
    avatar_type text,
    provider text,
    events jsonb NOT NULL DEFAULT '[]'::jsonb,
    result jsonb,
    error text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scrape_job_created_at_idx ON scrape_job (created_at DESC);
"""


DOWN_SQL = """
DROP TABLE IF EXISTS scrape_job;
"""


def upgrade() -> None:
    engine = create_engine(
        supabase_connection_string().replace("postgresql://", "postgresql+psycopg://", 1)
    )
    with engine.begin() as connection:
        connection.execute(text(UP_SQL))


def downgrade() -> None:
    engine = create_engine(
        supabase_connection_string().replace("postgresql://", "postgresql+psycopg://", 1)
    )
    with engine.begin() as connection:
        connection.execute(text(DOWN_SQL))


if __name__ == "__main__":
    upgrade()
