from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    openai_api_key: str
    openai_model: str


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_settings() -> Settings:
    load_dotenv(_project_root() / ".env")

    api_key = (os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY") or "").strip()
    model = (os.getenv("OPENAI_MODEL") or "").strip() or "gpt-4o-mini"

    if not api_key:
        raise ConfigError("OPENAI_API_KEY is missing or empty.")

    return Settings(openai_api_key=api_key, openai_model=model)
