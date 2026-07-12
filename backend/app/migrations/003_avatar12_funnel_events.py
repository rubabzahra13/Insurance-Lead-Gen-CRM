from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
DO $$
BEGIN
    CREATE TYPE avatar12_funnel_event_type AS ENUM (
        'link_clicked',
        'form_started',
        'form_submitted',
        'meeting_booked'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS avatar12_funnel_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    avatar12_lead_id uuid NOT NULL REFERENCES avatar12_lead(id) ON DELETE CASCADE,
    event_type avatar12_funnel_event_type NOT NULL,
    payload text,
    created_at timestamptz NOT NULL DEFAULT now()
);
"""


DOWN_SQL = """
DROP TABLE IF EXISTS avatar12_funnel_event;
DROP TYPE IF EXISTS avatar12_funnel_event_type;
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
