from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
ALTER TABLE lead_draft ADD COLUMN IF NOT EXISTS sent_at timestamptz;
"""

DOWN_SQL = """
ALTER TABLE lead_draft DROP COLUMN IF EXISTS sent_at;
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


if __name__ == "__main__":
    upgrade()
