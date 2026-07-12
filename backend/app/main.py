from __future__ import annotations

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI

from app.config import load_settings
from app.routes.avatar3_tools import router as avatar3_tools_router
from app.routes.classify_search import router as classify_search_router
from app.routes.dashboard import router as dashboard_router
from app.routes.funnel_events import router as funnel_events_router
from app.routes.avatar12_leads import router as avatar12_router
from app.routes.avatar3_leads import router as avatar3_router


import os

public_app_url = os.getenv("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
if public_app_url not in origins:
    origins.append(public_app_url)

app = FastAPI(title="LeadGen API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(avatar12_router)
app.include_router(avatar3_router)
app.include_router(avatar3_tools_router)
app.include_router(classify_search_router)
app.include_router(dashboard_router)
app.include_router(funnel_events_router)


@app.get("/api/health")
def health():
    settings = load_settings()
    return {"ok": True, "claude_model": settings.claude_model}


def main() -> None:
    settings = load_settings()
    print(f"Claude backend ready with model: {settings.claude_model}")


if __name__ == "__main__":
    main()
