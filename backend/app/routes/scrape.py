from __future__ import annotations

import asyncio
import contextlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/scrape", tags=["scrape"])

_root_dir = Path(__file__).resolve().parents[2]
_runner_script = _root_dir / "src" / "scrape-runner.js"

_jobs: dict[str, dict[str, Any]] = {}
_running_tasks: set[asyncio.Task[Any]] = set()


def _track_task(task: asyncio.Task[Any]) -> asyncio.Task[Any]:
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)
    return task


class LocationPayload(BaseModel):
    placeId: str | None = None
    label: str | None = None
    mainText: str | None = None
    secondaryText: str | None = None
    city: str | None = None
    region: str | None = None
    country: str | None = None
    countryCode: str | None = None
    scope: str | None = None
    types: list[str] | None = None
    formattedAddress: str | None = None


class ScrapeRequest(BaseModel):
    query: str | None = None  # legacy single-box; prefer role + location
    role: str | None = None
    location: LocationPayload | None = None
    maxResults: int | None = None
    avatarType: str | None = None
    provider: str | None = None  # "serpapi" for the fast experimental engine


async def _broadcast(job: dict[str, Any], event: dict[str, Any] | None) -> None:
    subscribers = list(job["subscribers"])
    for queue in subscribers:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def _run_job(
    job_id: str,
    query: str,
    max_results: int,
    avatar_type: str | None = None,
    provider: str | None = None,
    role: str | None = None,
    location: dict[str, Any] | None = None,
) -> None:
    job = _jobs[job_id]
    job["startedAt"] = job.get("startedAt") or datetime.now(timezone.utc).isoformat()

    env = os.environ.copy()
    if avatar_type in {"avatar1", "avatar2"}:
        env["AVATAR_TYPE"] = avatar_type
    if provider:
        env["SEARCH_PROVIDER"] = provider
    if role:
        env["SEARCH_ROLE"] = role
    if location:
        env["SEARCH_LOCATION"] = json.dumps(location)

    process = await asyncio.create_subprocess_exec(
        "node",
        str(_runner_script),
        query,
        str(max_results),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(_root_dir),
        env=env,
    )
    job["process"] = process

    async def read_stdout() -> None:
        assert process.stdout is not None
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            raw = line.decode("utf-8", errors="replace").strip()
            if not raw:
                continue
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue

            job["events"].append(event)
            await _broadcast(job, event)

            if event.get("type") == "done":
                job["status"] = "done"
                job["result"] = event.get("result")
                job["finishedAt"] = datetime.now(timezone.utc).isoformat()
            elif event.get("type") == "error":
                job["status"] = "error"
                job["error"] = event.get("message")
                job["finishedAt"] = datetime.now(timezone.utc).isoformat()

    stdout_task = _track_task(asyncio.create_task(read_stdout()))
    try:
        await process.wait()
        await stdout_task
    except asyncio.CancelledError:
        if process.returncode is None:
            process.kill()
            await process.wait()
        stdout_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await stdout_task
        raise

    if process.returncode != 0 and job["status"] == "running":
        stderr = b""
        if process.stderr is not None:
            stderr = await process.stderr.read()
        error_message = stderr.decode("utf-8", errors="replace").strip() or (
            f"Scrape runner exited with code {process.returncode}"
        )
        job["status"] = "error"
        job["error"] = error_message
        job["finishedAt"] = datetime.now(timezone.utc).isoformat()
        await _broadcast(job, {"type": "error", "message": error_message})

    await _broadcast(job, None)
    job["subscribers"].clear()


@router.post("")
async def create_scrape_job(payload: ScrapeRequest):
    role = (payload.role or "").strip()
    query = (payload.query or "").strip()
    location = payload.location.model_dump(exclude_none=True) if payload.location else None
    if location and not location.get("placeId"):
        # Free-typed location text is rejected — only Places dropdown selections.
        location = None
    location_label = (location or {}).get("label") or (location or {}).get("mainText") or ""

    if not role and not query:
        raise HTTPException(status_code=400, detail="role is required")

    # Prefer structured role; keep a combined query for logs / legacy.
    if role:
        display_query = f"{role} in {location_label}".strip() if location_label else role
        effective_role = role
    else:
        display_query = query
        effective_role = query

    job_id = str(uuid4())
    max_results = int(payload.maxResults or os.getenv("MAX_RESULTS", "25"))
    job = {
        "id": job_id,
        "status": "running",
        "query": display_query,
        "role": effective_role,
        "location": location,
        "maxResults": max_results,
        "events": [
            {
                "type": "log",
                "message": (
                    f'Sourcing pipeline initialized for role: "{effective_role}"'
                    + (f', location: "{location_label}"' if location_label else " (no location)")
                ),
            }
        ],
        "result": None,
        "error": None,
        "subscribers": set(),
        "startedAt": None,
        "finishedAt": None,
        "process": None,
    }
    _jobs[job_id] = job

    _track_task(
        asyncio.create_task(
            _run_job(
                job_id,
                display_query,
                max_results,
                payload.avatarType,
                payload.provider,
                effective_role,
                location,
            )
        )
    )
    return {
        "runId": job_id,
        "query": display_query,
        "role": effective_role,
        "location": location,
        "maxResults": max_results,
    }


async def shutdown_scrape_jobs() -> None:
    for job in _jobs.values():
        process = job.get("process")
        if process is not None and process.returncode is None:
            process.kill()
        await _broadcast(job, None)

    for task in list(_running_tasks):
        task.cancel()

    if _running_tasks:
        await asyncio.gather(*_running_tasks, return_exceptions=True)


@router.get("/{job_id}")
async def get_scrape_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Run not found")

    return {
        "id": job["id"],
        "status": job["status"],
        "query": job["query"],
        "maxResults": job["maxResults"],
        "startedAt": job["startedAt"],
        "finishedAt": job["finishedAt"],
        "error": job["error"],
        "events": job["events"],
        "result": job["result"],
    }


@router.get("/{job_id}/stream")
async def stream_scrape_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Run not found")

    async def event_generator():
        for event in job["events"]:
            yield f"data: {json.dumps(event)}\n\n"

        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        job["subscribers"].add(queue)
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("type") in {"done", "error"}:
                    break
        finally:
            job["subscribers"].discard(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
