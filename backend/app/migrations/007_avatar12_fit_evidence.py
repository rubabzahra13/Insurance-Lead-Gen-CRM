"""Add avatar-fit evidence columns to avatar12_lead.

fit_evidence: the exact search-result text proving the lead matches its avatar
(e.g. an "open to work" post quote, or the employer's "11-50 employees" line).
fit_source: where that evidence was seen — profile | own_post | company_page | other.
"""

from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
ALTER TABLE avatar12_lead ADD COLUMN IF NOT EXISTS fit_evidence text;
ALTER TABLE avatar12_lead ADD COLUMN IF NOT EXISTS fit_source varchar(32);
"""

DOWN_SQL = """
ALTER TABLE avatar12_lead DROP COLUMN IF EXISTS fit_evidence;
ALTER TABLE avatar12_lead DROP COLUMN IF EXISTS fit_source;
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
