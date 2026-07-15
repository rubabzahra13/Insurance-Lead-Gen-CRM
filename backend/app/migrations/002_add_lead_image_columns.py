from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
ALTER TABLE business_lead 
ADD COLUMN IF NOT EXISTS image_data text,
ADD COLUMN IF NOT EXISTS image_content_type varchar(255);
"""


DOWN_SQL = """
ALTER TABLE business_lead 
DROP COLUMN IF EXISTS image_data,
DROP COLUMN IF EXISTS image_content_type;
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
