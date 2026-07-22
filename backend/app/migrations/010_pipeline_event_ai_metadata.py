from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
ALTER TABLE pipeline_event
  ADD COLUMN IF NOT EXISTS changed_by varchar(32),
  ADD COLUMN IF NOT EXISTS note_id uuid REFERENCES business_note(id) ON DELETE SET NULL;

UPDATE pipeline_event
SET changed_by = 'ai'
WHERE event_type = 'stage_change'
  AND changed_by IS NULL
  AND description ILIKE '%reclassification agent%';

UPDATE pipeline_event
SET changed_by = 'system'
WHERE event_type = 'stage_change'
  AND changed_by IS NULL
  AND from_stage IS NULL;

UPDATE pipeline_event
SET changed_by = 'user'
WHERE event_type = 'stage_change'
  AND changed_by IS NULL;
"""

DOWN_SQL = """
ALTER TABLE pipeline_event
  DROP COLUMN IF EXISTS note_id,
  DROP COLUMN IF EXISTS changed_by;
"""


def upgrade() -> None:
    url = supabase_connection_string().replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text(UP_SQL))


def downgrade() -> None:
    url = supabase_connection_string().replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text(DOWN_SQL))
