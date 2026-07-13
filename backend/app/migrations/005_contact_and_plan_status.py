from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
ALTER TABLE avatar12_lead ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE avatar12_lead ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE follow_up_plan ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
"""

DOWN_SQL = """
ALTER TABLE follow_up_plan DROP COLUMN IF EXISTS status;
ALTER TABLE avatar12_lead DROP COLUMN IF EXISTS contact_phone;
ALTER TABLE avatar12_lead DROP COLUMN IF EXISTS contact_email;
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
