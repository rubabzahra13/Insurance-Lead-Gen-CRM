from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.db import supabase_connection_string


def _create_engine():
    url = supabase_connection_string().replace(
        "postgresql://", "postgresql+psycopg://", 1
    ).replace("postgres://", "postgresql+psycopg://", 1)

    connect_args = {
        # Safe with Supabase transaction pooler (port 6543).
        "prepare_threshold": None,
        "connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
    }

    kwargs: dict = {"connect_args": connect_args}

    if os.getenv("VERCEL"):
        # Release the DB connection after each request on serverless.
        kwargs["poolclass"] = NullPool
    else:
        kwargs["pool_pre_ping"] = True

    return create_engine(url, **kwargs)


engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
