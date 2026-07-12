# Insurance Lead-Gen CRM

## Project Structure

```text
peters-pipeline/
├── .env
├── .env.example
├── README.md
└── backend/
    ├── venv/                 # Python virtual environment - always activate before any backend command
    ├── package.json
    ├── package-lock.json
    ├── node_modules/
    ├── src/                   # relocated LinkedIn lead scraper backend
    └── app/
        ├── db.py
        ├── models/
        │   ├── base.py
        │   └── business.py
        └── migrations/
            ├── 001_avatar3_tables.py
            └── run.py
```

## Environment Variables

The shared root `.env` currently uses these variable names:

`ANTHROPIC_API_KEY`

`CLAUDE_API_KEY`

`CLAUDE_MODEL`

`GEMINI_API_KEY`

`LLM_PROVIDER`

`MAX_RESULTS`

`MIN_CONFIDENCE`

`NODE_ENV`

`PORT`

`SUPABASE_CONNECTION_STRING`

`PUBLIC_APP_URL` (optional: base URL of the deployed frontend, defaults to `http://localhost:3000`)

## Backend Rule

Always activate `backend/venv` before running any backend command.

## Running the Backend

Run these commands from the repository root:

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
python -m app.migrations.run up
uvicorn app.main:app --reload --port 8000
```

The FastAPI server is reachable at `http://localhost:8000`.

Interactive API docs:

`http://localhost:8000/docs`

## Running the Frontend

The frontend is a Next.js application. Note that no Python virtual environment (`venv`) is required for the frontend (this rule applies to the backend only).

Run these commands from the repository root to start the frontend:

```bash
cd frontend
npm install
npm run dev
```

The Next.js application will start by default at `http://localhost:3000`. It automatically loads environment variables from the shared root-level `.env` file.

Frontend dev origin allowed by CORS:

`http://localhost:3000`

## API Reference

All endpoints below are exposed by the running FastAPI app on port `8000`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Basic backend health check. |
| `POST` | `/api/classify-search` | Classify a search query into Avatar 1, Avatar 2, or Avatar 3. |
| `POST` | `/api/avatar3/search` | Search Google Places for Avatar 3 business prospects. |
| `POST` | `/api/avatar3/enrich` | Enrich a business website with owner/contact details. |
| `POST` | `/api/avatar3/leads` | Create an Avatar 3 business lead. |
| `GET` | `/api/avatar3/leads` | List Avatar 3 business leads. |
| `GET` | `/api/avatar3/leads/{lead_id}` | Fetch one Avatar 3 lead with notes, interactions, plans, and events. |
| `PATCH` | `/api/avatar3/leads/{lead_id}/stage` | Manually move an Avatar 3 lead between pipeline stages. |
| `POST` | `/api/avatar3/leads/{lead_id}/notes` | Add a note to an Avatar 3 lead and trigger reclassification/follow-up planning. |
| `GET` | `/api/avatar12/leads` | List Avatar 1/2 leads and their latest draft summary. |
| `POST` | `/api/avatar12/leads` | Create or import an Avatar 1/2 lead and auto-generate a draft. |
| `GET` | `/api/avatar12/leads/{lead_id}` | Fetch an Avatar 1/2 lead with all drafts. |
| `GET` | `/api/avatar12/leads/{lead_id}/drafts/latest` | Fetch the latest draft for one Avatar 1/2 lead. |
| `POST` | `/api/avatar12/leads/{lead_id}/messages/send` | Mark the latest Avatar 1/2 draft as sent. |
| `POST` | `/api/funnel-events/{event_type}` | Record `link_clicked`, `form_started`, `form_submitted`, or `meeting_booked` for an Avatar 1/2 lead. |
| `GET` | `/api/dashboard/kpis` | Return dashboard totals for leads sourced, messages sent, meetings booked, and active pipeline count. |
| `GET` | `/api/dashboard/funnel` | Return funnel chart data and lead-level funnel table rows. |

## Legacy LinkedIn Scrape Test

This is the older Node-based scraper path, separate from the FastAPI app on port `8000`.

With `backend/venv` activated, you can trigger a scrape from the command prompt:

```bash
cd backend
source venv/bin/activate
node src/index.js --help
npm run scrape -- "CEOs in automotive united states"
```

For the legacy HTTP server path:

```bash
curl -X POST http://localhost:3001/api/scrape \
  -H 'Content-Type: application/json' \
  -d '{"query":"CEOs in marketing"}'
```
