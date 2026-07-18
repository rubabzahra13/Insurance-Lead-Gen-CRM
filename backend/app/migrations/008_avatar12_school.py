"""Add avatar12_lead.school.

Job seekers are usually students, so an employer often does not exist for them
while a school almost always does. Storing a school in `company` would be a lie,
and an intern legitimately has both, so the school gets its own column.
"""

from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
ALTER TABLE avatar12_lead ADD COLUMN IF NOT EXISTS school text;
"""

DOWN_SQL = """
ALTER TABLE avatar12_lead DROP COLUMN IF EXISTS school;
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
