# Lead Generation Engine Extraction Summary

This document summarizes the refactoring of the `LeadScout` backend into a standalone Lead Generation Engine for the new Insurance Lead-Gen CRM. The repository has been cleaned up, and a new branch `Insurance-9-July` has been created to isolate the core engine.

## 1. What was Preserved

The following components were kept to form the core Lead Generation Engine. This engine is responsible for searching LinkedIn profiles, extracting their information, verifying links, and structuring the data into clean lead objects.

* **Core Pipeline (`pipeline.js`)**: Orchestrates the entire search-to-export process (web search, LLM structuring, link resolution, grounding, verification, and confidence scoring).
* **LLM Providers (`llm.js`, `claude.js`, `gemini.js`)**: Handles communication with AI models for web search, text understanding, and JSON structuring.
* **Prompts (`prompts.js`)**: Contains the exact instructions for searching, expanding notes, structuring leads, and resolving missing links.
* **Extraction & Validation (`extract-leads.js`, `structure-leads.js`, `validate-leads.js`)**: Parses LLM responses, normalizes lead data, validates fields against the raw search corpus, and deduplicates results.
* **Link Resolution & Grounding (`resolve-grounding.js`, `verify-url.js`)**: Confirms LinkedIn URLs against Google's search index and actively opens URLs to verify they lead to the correct profile.
* **Confidence Scoring (`confidence.js`)**: Assigns a confidence score (0-100%) to each lead based on available data (name, title, company, link source, verification status).
* **Utilities (`utils.js`, `parse-json.js`, `llm-response.js`)**: Core utility functions for normalizing names, parsing URLs, and formatting LLM responses.
* **Export (`xlsx.js`, `output-dir.js`)**: Exports the final, clean leads to an XLSX file.

## 2. What was Removed

All client-specific business logic, dashboards, database persistence, and frontend UI components have been removed.

* **Database Layer (`src/db/`)**: Removed all Supabase/PostgreSQL connections, run history, lead CRUD operations, duplicate reviews, and analytics aggregations.
* **Frontend (`web/`, `public/`, `dist/`)**: Removed the entire React/SPA application, including the dashboard, search modal, and desk UI.
* **Server Routes (`src/server.js`)**: Removed Express routes for dashboards, analytics, desk views, saved views, and bulk lead actions. Kept only the `/api/scrape` endpoint.
* **Middleware (`src/middleware/`)**: Removed database-attachment middleware and unnecessary HTTP headers for the old SPA.
* **Configurations (`vercel.json`, `vite.config.js`)**: Removed deployment configs that assumed a frontend SPA build.
* **Dependencies (`package.json`)**: Removed `react`, `chart.js`, `vite`, `tailwindcss`, `concurrently`, `postgres`, and `googleapis`. Kept only `express`, `dotenv`, `xlsx`, and `cors`.

## 3. New Backend Architecture

The backend is now a lean, stateless Node.js application (CLI and Express) that accepts a search query and returns structured lead data.

**Input**
`POST /api/scrape` or CLI command `npm run scrape`
```json
{
  "query": "Insurance agents in New York"
}
```

**Process (The Pipeline)**
1. **Search**: Uses Claude or Gemini to search the web for LinkedIn profiles.
2. **Structure**: LLM extracts name, title, company, location, and snippet.
3. **Resolve**: Finds missing LinkedIn URLs.
4. **Ground**: Confirms URLs against Google's index.
5. **Verify**: Opens profiles to check validity.
6. **Score**: Assigns confidence ratings.

**Output**
```json
{
  "leads": [
    {
      "name": "John Doe",
      "title": "Insurance Agent",
      "company": "ABC Insurance",
      "location": "New York",
      "link": "https://linkedin.com/in/johndoe",
      "confidence": 0.85,
      "status": "verified"
    }
  ],
  "rejected": [],
  "stats": {
    "researched": 10,
    "exported": 8,
    "avgConfidence": 0.82
  }
}
```

## 4. Assumptions Made

1. **Database Independence**: The extracted engine does not need to persist leads immediately. It focuses purely on generating and returning them. The new CRM can handle database persistence separately.
2. **CLI Focus**: The `index.js` entry point was simplified to run the pipeline and export to XLSX, removing Sheets integration and DB syncing for cleaner CLI usage.
3. **Single Provider**: While both Claude and Gemini are supported, the `.env.example` defaults to Claude.

## 5. Verification

The extraction has been verified by:
1. Checking that the Express server starts successfully (`http://localhost:3001/api/health`).
2. Confirming that the `/api/scrape` endpoint accepts a request, runs the pipeline, and returns a 202 status with a `runId`.
3. Verifying that the CLI `node src/index.js --help` runs correctly without importing missing DB modules.
