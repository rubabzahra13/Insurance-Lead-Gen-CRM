from __future__ import annotations

from sqlalchemy import create_engine, text

from app.db import supabase_connection_string


UP_SQL = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    CREATE TYPE pipeline_stage AS ENUM (
        'new',
        'qualified',
        'warm',
        'follow_up_later',
        'sealed_won',
        'lost',
        'not_interested'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE interaction_channel AS ENUM ('email', 'phone', 'whatsapp', 'in_person', 'other');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE interaction_direction AS ENUM ('inbound', 'outbound');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE pipeline_event_type AS ENUM ('stage_change', 'note_added', 'follow_up_generated');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS business_lead (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name varchar(255) NOT NULL,
    address text,
    website text,
    google_place_id varchar(255),
    rating varchar(32),
    open_status varchar(64),
    phone varchar(64),
    owner_name varchar(255),
    manager_name varchar(255),
    contact_email varchar(255),
    contact_linkedin text,
    pipeline_stage pipeline_stage NOT NULL DEFAULT 'new',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_note (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_lead_id uuid NOT NULL REFERENCES business_lead(id) ON DELETE CASCADE,
    content text NOT NULL,
    author varchar(255),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_interaction (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_lead_id uuid NOT NULL REFERENCES business_lead(id) ON DELETE CASCADE,
    channel interaction_channel NOT NULL,
    direction interaction_direction NOT NULL,
    summary text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follow_up_plan (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_lead_id uuid NOT NULL REFERENCES business_lead(id) ON DELETE CASCADE,
    note_id uuid NULL REFERENCES business_note(id) ON DELETE SET NULL,
    recommended_action text NOT NULL,
    suggested_channel varchar(64),
    reasoning text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_lead_id uuid NOT NULL REFERENCES business_lead(id) ON DELETE CASCADE,
    event_type pipeline_event_type NOT NULL,
    from_stage pipeline_stage NULL,
    to_stage pipeline_stage NULL,
    description text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_lead_google_place_id_unique
ON business_lead (google_place_id)
WHERE google_place_id IS NOT NULL;
"""


DOWN_SQL = """
DROP TABLE IF EXISTS pipeline_event;
DROP TABLE IF EXISTS follow_up_plan;
DROP TABLE IF EXISTS business_interaction;
DROP TABLE IF EXISTS business_note;
DROP TABLE IF EXISTS business_lead;
DROP TYPE IF EXISTS pipeline_event_type;
DROP TYPE IF EXISTS interaction_direction;
DROP TYPE IF EXISTS interaction_channel;
DROP TYPE IF EXISTS pipeline_stage;
DROP INDEX IF EXISTS business_lead_google_place_id_unique;
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
