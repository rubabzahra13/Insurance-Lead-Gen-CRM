from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import httpx

from app.db import load_root_env


logger = logging.getLogger(__name__)

OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"


class LLMResponseError(RuntimeError):
    pass


def _api_key() -> str:
    load_root_env()
    key = (os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY") or "").strip()
    if not key:
        raise LLMResponseError("OPENAI_API_KEY is missing or empty.")
    return key


def _model() -> str:
    load_root_env()
    return (os.getenv("OPENAI_MODEL") or "").strip() or "gpt-4o-mini"


def _schema_hint(response_schema: dict[str, Any]) -> str:
    return json.dumps(response_schema, indent=2, sort_keys=True)


def _build_prompt(system_prompt: str, response_schema: dict[str, Any], strict: bool) -> str:
    base = [
        system_prompt.strip(),
        "",
        "Return only valid JSON that matches this schema shape:",
        _schema_hint(response_schema),
    ]
    if strict:
        base.append("Return only valid JSON, no prose, no markdown, no code fences.")
    return "\n".join(base)


def _strip_code_fences(raw_text: str) -> str:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    return text


def _parse_and_validate(raw_text: str, response_schema: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = json.loads(_strip_code_fences(raw_text))
    except json.JSONDecodeError as exc:
        raise LLMResponseError(f"OpenAI returned invalid JSON: {exc.msg}") from exc

    _validate_against_schema(parsed, response_schema)
    if not isinstance(parsed, dict):
        raise LLMResponseError("OpenAI response must be a JSON object.")
    return parsed


def _validate_against_schema(value: Any, schema: Any, path: str = "$") -> None:
    if isinstance(schema, str):
        expected = schema.lower()
        checks = {
            "string": lambda v: isinstance(v, str),
            "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
            "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
            "boolean": lambda v: isinstance(v, bool),
            "null": lambda v: v is None,
            "object": lambda v: isinstance(v, dict),
            "array": lambda v: isinstance(v, list),
            "any": lambda v: True,
        }
        checker = checks.get(expected)
        if checker is None:
            raise LLMResponseError(f"Unsupported schema type '{schema}' at {path}.")
        if not checker(value):
            raise LLMResponseError(f"Expected {expected} at {path}.")
        return

    if isinstance(schema, list):
        if not isinstance(value, list):
            last_error: LLMResponseError | None = None
            for option in schema:
                try:
                    _validate_against_schema(value, option, path)
                    return
                except LLMResponseError as exc:
                    last_error = exc
            raise last_error or LLMResponseError(f"Value at {path} did not match any allowed type.")

        item_schema = schema[0] if schema else "any"
        for index, item in enumerate(value):
            _validate_against_schema(item, item_schema, f"{path}[{index}]")
        return

    if isinstance(schema, dict):
        if not isinstance(value, dict):
            raise LLMResponseError(f"Expected object at {path}.")
        for key, sub_schema in schema.items():
            if key not in value:
                raise LLMResponseError(f"Missing required key '{key}' at {path}.")
            _validate_against_schema(value[key], sub_schema, f"{path}.{key}")
        return

    raise LLMResponseError(f"Unsupported schema shape at {path}.")


def _call_openai(system_prompt: str, user_prompt: str, timeout_seconds: float = 60.0) -> str:
    response = httpx.post(
        OPENAI_API_URL,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_api_key()}",
        },
        json={
            "model": _model(),
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        },
        timeout=timeout_seconds,
    )
    if response.status_code != 200:
        raise LLMResponseError(
            f"OpenAI API error ({response.status_code}): {response.text[:200]}"
        )
    payload = response.json()
    return str(
        payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    ).strip()


def generate_structured(
    system_prompt: str,
    user_prompt: str,
    response_schema: dict[str, Any],
) -> dict[str, Any]:
    start = time.perf_counter()
    attempts = 0
    last_error: Exception | None = None

    for strict in (False, True):
        attempts += 1
        try:
            raw_text = _call_openai(
                _build_prompt(system_prompt, response_schema, strict=strict),
                user_prompt,
            )
            parsed = _parse_and_validate(raw_text, response_schema)
            logger.info(
                "OpenAI structured call succeeded model=%s attempts=%s latency_ms=%.2f",
                _model(),
                attempts,
                (time.perf_counter() - start) * 1000,
            )
            return parsed
        except Exception as exc:
            last_error = exc
            logger.warning(
                "OpenAI structured call failed model=%s attempt=%s latency_ms=%.2f error=%s",
                _model(),
                attempts,
                (time.perf_counter() - start) * 1000,
                exc.__class__.__name__,
            )
            if strict:
                break

    raise LLMResponseError("OpenAI failed to return valid structured JSON.") from last_error
