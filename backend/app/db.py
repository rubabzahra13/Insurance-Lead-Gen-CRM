from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


def load_root_env() -> None:
    root_env = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(root_env, override=True)


def supabase_connection_string() -> str:
    load_root_env()
    value = (os.getenv("SUPABASE_CONNECTION_STRING") or "").strip()
    if not value:
        raise RuntimeError(
            "SUPABASE_CONNECTION_STRING is missing from the repository root .env file."
        )
    return value

