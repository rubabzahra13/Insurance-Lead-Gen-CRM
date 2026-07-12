from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
DO $$
BEGIN
    CREATE TYPE avatar12_type AS ENUM ('avatar1', 'avatar2');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS avatar12_lead (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    avatar_type avatar12_type NOT NULL,
    name varchar(255) NOT NULL,
    headline text,
    role text,
    past_experience text,
    location text,
    company text,
    linkedin_url text,
    search_prompt text,
    source_snapshot text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_draft (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    avatar12_lead_id uuid NOT NULL REFERENCES avatar12_lead(id) ON DELETE CASCADE,
    status varchar(32) NOT NULL DEFAULT 'draft',
    message text NOT NULL,
    reasoning text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
"""


DOWN_SQL = """
DROP TABLE IF EXISTS lead_draft;
DROP TABLE IF EXISTS avatar12_lead;
DROP TYPE IF EXISTS avatar12_type;
"""


def upgrade() -> None:
    engine = create_engine(supabase_connection_string().replace("postgresql://", "postgresql+psycopg://", 1))
    with engine.begin() as connection:
        connection.execute(text(UP_SQL))


def downgrade() -> None:
    engine = create_engine(supabase_connection_string().replace("postgresql://", "postgresql+psycopg://", 1))
    with engine.begin() as connection:
        connection.execute(text(DOWN_SQL))


if __name__ == "__main__":
    upgrade()
