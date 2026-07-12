from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    claude_api_key: str
    claude_model: str


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_settings() -> Settings:
    load_dotenv(_project_root() / ".env")

    api_key = (os.getenv("CLAUDE_API_KEY") or "").strip()
    model = (os.getenv("CLAUDE_MODEL") or "").strip()

    if not api_key:
        raise ConfigError(
            "CLAUDE_API_KEY is missing or empty in the root .env file."
        )
    if not model:
        raise ConfigError(
            "CLAUDE_MODEL is missing or empty in the root .env file."
        )

    if not api_key.startswith("sk-ant-"):
        raise ConfigError("CLAUDE_API_KEY does not look like a valid Anthropic key.")

    return Settings(claude_api_key=api_key, claude_model=model)

