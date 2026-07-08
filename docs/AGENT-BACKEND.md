# What happens when you run a search

This explains the full journey — from typing a query in LeadScout to leads showing up in your list — in plain English. No code, no API names.

---

## Who is involved?

| Who | Role |
|-----|------|
| **You (the user)** | Type a search, wait, review leads in the app |
| **The web app** | Shows the search box, progress bar, and lead table. Talks to the server. |
| **The server** | Receives your search, runs the job in the background, saves results to the database |
| **The AI agent** | Does the actual “research” — searches the web, reads results, fills in lead details |
| **Claude or Gemini** | The AI company behind the agent (whichever is configured). Provides web search + text understanding |
| **The database** | Stores your leads, search history, and duplicate flags permanently |
| **LinkedIn’s website** | Sometimes opened briefly to double-check a profile link (often blocks automated checks) |

---

## The big picture (30 seconds)

1. You describe who you want to find in plain language.
2. The app sends that to the server and shows a progress screen.
3. The server asks an AI agent to **search the web for LinkedIn profiles** matching your words.
4. The agent **reads** what it finds and turns it into neat rows: name, job title, company, location, LinkedIn link.
5. The agent **tries to fix missing links**, **checks quality**, and **throws out** weak or unproven leads.
6. Good leads are **saved to your knowledge base** (database). Duplicates you already have may go to a **review queue**.
7. The app **refreshes** and you see the new leads in your table.

A typical run finishes in about **2 minutes** and returns up to **10 leads** (that’s the current limit per search).

---

## Step by step

### 1. You enter a query

You open **New search** and type something like:

> founders of AI startups in New York

You don’t need special syntax. Plain language is enough. If you type “scrape linkedin …” the app strips that prefix and uses the rest as your real search.

You click **Run search**.

---

### 2. The app hands off to the server

**The web app** immediately:

- Sends your words to the server
- Opens a modal with a **progress bar** (web search → structuring → links → scoring)
- Listens for live updates while the job runs

You keep the modal open until it finishes (the app tells you generation can take up to 2 minutes).

**The server**:

- Creates a **search run** record (so you have history in the sidebar later)
- Starts the agent **in the background** — it does not make you wait on a single long page load
- Streams progress events back to the modal

---

### 3. The agent builds a LinkedIn-focused search

**The AI agent** (on the server) turns your query into something like:

> Find LinkedIn profile pages for: founders of AI startups in New York

It is **not** opening Google in a browser like you would. It uses the AI provider’s **built-in web search tool** (Claude or Gemini). That search is biased toward:

- **linkedin.com/in/…** profile URLs
- Real people mentioned in search snippets

The agent is instructed to **only copy what it actually sees** in search results — not invent names, companies, or URLs from memory.

It may run **a few related searches** if the first pass is thin (usually 1–3 search rounds, with a hard cap on how many search calls the AI can make per step).

**Important:** This is **not** paging through Google result page 1, 2, 3, etc. It gets a **limited batch** of what the search tool returns — which is why you often see fewer people than a manual Google search.

---

### 4. Optional: “expand” pass for more detail

Search tools often return a **title and link** but hide the grey description text under each result.

If the agent’s written notes are too short, it runs a **second search pass** focused on filling in those profile descriptions (job title, company, city, etc.).

---

### 5. Raw results are saved (for debugging)

The server saves a snapshot of everything the agent saw (URLs, titles, notes) to a file on the server. This helps troubleshooting but you don’t see it in the normal UI.

---

### 6. The agent structures people into lead rows

A **second AI step** (no new web search) reads the raw material and outputs a list of people with:

- Name  
- Job title  
- Company  
- Location  
- LinkedIn link (if found)  
- Short snippet and “evidence” (a quote from search text)

Rules here:

- If a LinkedIn URL wasn’t in the search results, the agent **must not make one up**
- If a field wasn’t in the results, it stays **empty** rather than guessed
- People who don’t match your search intent are skipped
- At most **10 people** are requested (your current per-search limit)

The server also **parses LinkedIn title lines** (e.g. “Jane Doe - CEO - Acme Inc”) to fill gaps the JSON missed.

---

### 7. Missing LinkedIn links get a dedicated hunt

Some people have a name and company but **no profile URL**.

The agent runs **extra web searches** just for those individuals (e.g. search for their name + company on LinkedIn). Found URLs are attached with **lower trust** than URLs that appeared in the original search.

Only a **limited number** of missing links are hunted per run (to save time and API cost).

---

### 8. Links from Google’s search index are confirmed

When the search tool returns profile URLs (sometimes as redirect links), the server:

- Follows redirects to the real **linkedin.com/in/…** address  
- Matches URLs to people by comparing the URL slug to their name  

If a match is strong enough, that link **replaces** a weaker AI-written link. Links from the search index are treated as **more trustworthy** than links the resolver guessed later.

---

### 9. Duplicate people within the same run are merged

If the same person appeared twice in one batch (slightly different spelling, etc.), the server **keeps one richer record**.

It also flags **suspicious URL patterns** (e.g. two different people sharing one link, or URLs that look auto-generated). In rare cases, bad links are cleared and the resolver tries again.

---

### 10. LinkedIn links are spot-checked (when possible)

For leads that have a URL, the server tries to **open the profile page** with a simple automated request (not a full browser).

What it checks:

- Does the page exist (not 404)?  
- Did LinkedIn show a login wall instead of the profile?  
- Does the **page title** look like it belongs to this person’s name?  

Outcomes:

| Outcome | Meaning |
|---------|---------|
| **Verified** | Page loaded and the title matched the name |
| **Inconclusive** | LinkedIn blocked the check or showed “sign in” — link might still be fine |
| **Invalid** | Dead link, wrong page, or title shows a different person |

LinkedIn **often blocks** these checks, so “inconclusive” is common even for real profiles. Only a **limited number** of links are checked per run.

You can turn verification off entirely via server settings, but by default it’s on.

---

### 11. Each lead gets a confidence score

The server adds up **points** for good signals:

- Has name, title, company, location, snippet  
- Has a LinkedIn link  
- Link came from search results (better) vs. resolver (weaker)  
- URL slug looks like the person’s name  
- Link was **verified** by opening the page  

It **subtracts** for bad signals:

- No link  
- Link doesn’t match the name  
- Link failed verification  
- Same link assigned to two people  

You see this as a **percentage** in the app.

Each lead also gets a **plain-English status**, e.g. “We opened the link and confirmed it shows this person” or “needs review”.

---

### 12. Low-quality leads are dropped

Before saving, the server applies a **quality bar** (default: confidence at least **55%**).

Leads below that bar are **not added** to your knowledge base. They may be logged on the server for debugging but won’t appear in your list.

Optional stricter mode can require a **verified** link, not just a good score.

Finally, even good leads are **capped at 10 per search** (current product limit).

---

### 13. Leads are saved to your knowledge base

**The database** receives each passing lead:

- Stored as a row with name, title, company, location, link, score, notes, etc.  
- Linked to **this search run** so you can filter “leads from this search” later  

**If this person already exists** in your KB:

- Same LinkedIn URL or same name+company → treated as **already known**  
- The run is still linked to them  
- If the new data **conflicts** (different title/company/etc.) → a **duplicate review** item is created for you to merge, keep both, or dismiss  

The search run is marked **done** with stats: how many added, how many duplicates flagged.

---

### 14. The app updates what you see

When the job finishes:

- The modal shows a summary (e.g. “8 leads found, 6 added, 2 need review”)  
- **The web app** refreshes its cached data — surgically, so the rest of the page doesn’t feel slow  
- New leads appear in **All leads** (or filtered to this search if you’re viewing a run)  
- **Preview rows** may have appeared earlier while the job was still running (structured but not yet final)

You can star leads, edit them, export to Excel, filter, sort, and open the inspector to read **why** the agent trusted each field.

---

## What you see in the progress modal

The progress bar maps to these real backend stages:

1. **Web search** — AI searches the web (and maybe expands notes)  
2. **Structuring leads** — AI turns raw hits into a people list  
3. **Resolving links** — optional hunts for missing LinkedIn URLs  
4. **Confirming links** — match search-index URLs to people  
5. **Scoring confidence** — open links where possible, calculate scores, apply quality gate  

---

## What the app does *between* searches

This isn’t part of a single query, but it’s part of the product:

- **Dashboard** — charts built from leads already in the database (not live agent work)  
- **Filters & saved views** — read from the database  
- **Star / bulk actions / delete** — update the database directly (no AI)  
- **Duplicate review** — you decide how to merge conflicting records  
- **Export** — downloads from the database, not a new search  

---

## Why results differ from Google

| Google (you in a browser) | LeadScout agent |
|---------------------------|-----------------|
| Shows many result types (articles, company pages, etc.) | Focuses on **LinkedIn /in/ profiles** |
| You can click page 2, 3, … | **No pagination** — limited search API results |
| Hundreds of hits possible | **Max 10 saved** per search |
| No quality filter | Drops unproven / low-confidence rows |
| You judge links yourself | Tries to verify links automatically (often blocked by LinkedIn) |

The agent is built for **a small set of trustworthy leads**, not scraping everything Google shows.

---

## One-page flow diagram

```
YOU
  │  type query, click Run search
  ▼
WEB APP
  │  send job, show progress modal, listen for updates
  ▼
SERVER
  │  start background job, record search in history
  ▼
AI AGENT (Claude or Gemini)
  │  ① web search for LinkedIn profiles
  │  ② maybe expand for more profile text
  │  ③ structure into name / title / company / location / link
  │  ④ hunt missing links
  │  ⑤ align links with search-index URLs
  ▼
SERVER (quality layer)
  │  merge duplicates in batch
  │  open some LinkedIn URLs to verify
  │  score confidence, drop weak leads
  │  cap at 10 exports
  ▼
DATABASE
  │  save new leads, link to this search
  │  flag conflicts → duplicate review
  ▼
WEB APP
  │  refresh list, show results in modal + table
  ▼
YOU
     review, star, filter, export
```

---

## Summary in one sentence

**You describe who you want; the server runs an AI researcher that searches the web for LinkedIn profiles, carefully fills in details without inventing data, checks and scores each person, saves the good ones to your database, and the app shows them to you — usually within two minutes and up to ten leads per search.**
