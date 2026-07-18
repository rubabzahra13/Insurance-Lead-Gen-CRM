from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI

from app.config import load_settings
from app.db import load_root_env
from app.routes.avatar3_tools import router as avatar3_tools_router
from app.routes.classify_search import router as classify_search_router
from app.routes.dashboard import router as dashboard_router
from app.routes.funnel_events import router as funnel_events_router
from app.routes.scrape import router as scrape_router
from app.routes.avatar12_leads import router as avatar12_router
from app.routes.avatar3_leads import router as avatar3_router
from app.routes.places import router as places_router


import os

load_root_env()

def _get_env_any(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()

    lowered = {key.lower(): value for key, value in os.environ.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value and value.strip():
            return value.strip()

    return default


frontend_url = _get_env_any(
    "PUBLIC_APP_URL",
    "FRONTEND_BASE_URL",
    "NEXT_PUBLIC_FRONTEND_URL",
    "VERCEL_URL",
    default="http://localhost:3000",
).rstrip("/")
if frontend_url and not frontend_url.startswith(("http://", "https://")):
    frontend_url = f"https://{frontend_url}"

# Ensure frontend_url includes a scheme; if VERCEL_URL was provided it may lack one.
if frontend_url and not frontend_url.startswith("http"):
    # prefer https for deployed hosts
    frontend_url = f"https://{frontend_url}"

# Normalize origins into a deterministic list (FastAPI expects a list/sequence)
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
if frontend_url and frontend_url not in origins:
    origins.append(frontend_url)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import asyncio

    async def _seed_funnel_test_lead() -> None:
        try:
            from app.session import SessionLocal
            from app.services.avatar12_drafts import ensure_funnel_test_lead

            def _run():
                db = SessionLocal()
                try:
                    return ensure_funnel_test_lead(db=db)
                finally:
                    db.close()

            seeded = await asyncio.to_thread(_run)
            print(
                f"Funnel test lead ready: {seeded['name']} "
                f"<{seeded['contact_email']}> id={seeded['id']}"
            )
        except Exception as exc:
            print(f"Funnel test lead seed skipped: {exc}")

    # Do not block API readiness on DB seeding
    asyncio.create_task(_seed_funnel_test_lead())

    yield
    from app.routes.scrape import shutdown_scrape_jobs

    await shutdown_scrape_jobs()


app = FastAPI(title="LeadGen API", lifespan=lifespan)

# Build CORS kwargs conditionally (allow-all in development for ngrok/preview ease)
cors_kwargs = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if os.getenv("NODE_ENV", "").lower() == "development" or os.getenv("DEV_CORS_ALLOW_ALL", "").lower() == "true":
    cors_kwargs["allow_origins"] = ["*"]
    cors_debug_desc = "allow_origins=['*']"
else:
    cors_kwargs["allow_origins"] = origins
    cors_kwargs["allow_origin_regex"] = r"^(https://.*\.vercel\.app|https://.*\.ngrok-free\.(app|dev|io)|http://(localhost|127\.0\.0\.1):\d+)$"
    cors_debug_desc = f"allow_origins={origins} allow_origin_regex={cors_kwargs['allow_origin_regex']}"

app.add_middleware(CORSMiddleware, **cors_kwargs)
print(f"CORS configured: {cors_debug_desc}")
app.include_router(avatar12_router)
app.include_router(avatar3_router)
app.include_router(avatar3_tools_router)
app.include_router(classify_search_router)
app.include_router(dashboard_router)
app.include_router(funnel_events_router)
app.include_router(scrape_router)
app.include_router(places_router)


@app.get("/api/health")
def health():
    settings = load_settings()
    return {"ok": True, "openai_model": settings.openai_model}


def main() -> None:
    settings = load_settings()
    print(f"OpenAI backend ready with model: {settings.openai_model}")


if __name__ == "__main__":
    main()
