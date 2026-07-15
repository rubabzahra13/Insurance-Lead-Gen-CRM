"""Vercel serverless entrypoint. Exposes the FastAPI ASGI app.

On Vercel the function's working directory is the service root (backend/),
so this directory is added to sys.path for `app.*` imports.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import app  # noqa: E402, F401
