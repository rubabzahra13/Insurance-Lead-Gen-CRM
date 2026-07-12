from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import supabase_connection_string


engine = create_engine(
    supabase_connection_string().replace("postgresql://", "postgresql+psycopg://", 1),
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

