# Insurance Lead Gen CRM — monthly cost estimate

**Purpose:** Client-facing estimate of recurring vendor costs for the current stack.  
**Last updated:** July 2026 · **Model in production today:** OpenAI `gpt-4o` on the SerpAPI search path.

---

## Volume assumptions (read this first)

Monthly totals are only defensible when tied to usage. The table below is what the cost ranges assume.

| Assumption | Light | Normal | Heavy |
|------------|-------|--------|-------|
| CRM people searches / month (avatar 1/2) | 20 | 80 | 200 |
| Business searches / month (avatar 3) | 5 | 20 | 60 |
| New leads enriched per search (avg) | 12 | 15 | 18 |
| First-time outreach drafts / month | 50 | 200 | 500 |
| Location picker lookups / month | 200 | 800 | 2,000 |

**How to read the math**

- **OpenAI:** ~$0.25–$0.50 per people search (plan + structure + scoring) + ~$0.02–$0.05 per first-time draft.  
  Example: 80 searches × $0.40 + 200 drafts × $0.03 ≈ **$38/month** (normal column).
- **SerpAPI:** ~**4–7 credits per people search** (parallel LinkedIn lanes) + **0–1 credit per lead** when email lookup runs (default cap 25/search).  
  Example at 5 lane credits + 10 email credits = **15 credits/search** → Starter (1,000 credits) ≈ **~65 searches/month**, not 1,000.
- **Google Places:** Avatar 1/2 picker is cheap at volume; avatar 3 Text Search Enterprise burns the 1,000/month free tier quickly (see steady-state column below).

---

## Core vendor table

| # | Tool | Role | Unit rate | Est. monthly (light → heavy) | Source |
|---|------|------|-----------|------------------------------|--------|
| 1 | **OpenAI** (`gpt-4o` today) | Search plan, structure results, match scoring, outreach drafts | $2.50 / 1M input · $10 / 1M output | **$20–$50** → **$50–$150** → **$150–$300** | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |
| 2 | **SerpAPI** | Google SERP for LinkedIn people lanes + optional email lookup | Free 250 credits/mo; Starter **$25 / 1,000 credits** | **$0–$25** → **$25–$75** → **$75–$275** | [SerpAPI pricing](https://serpapi.com/pricing) |
| 3 | **Google Places** | Location picker (avatar 1/2) + business search (avatar 3) | See Places breakdown below | **$0–$35** early month · **$35–$200+** at avatar 3 steady state | [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing) |
| 4 | **Supabase Pro** | Leads, drafts, auth, storage | Fixed | **$25** | [Supabase pricing](https://supabase.com/pricing) |

### OpenAI — model note (boss item #1)

`gpt-4o` at **$2.50 / $10 per 1M tokens** is still the published rate and matches what the app uses today. It is **not** stale like original GPT-4 list pricing was.

**Cost optimization (not deployed yet):** same pipeline could route cheaper steps to **`gpt-4o-mini`** ($0.15 / $0.60 per 1M) or **`gpt-4.1`** ($2 / $8) and keep `gpt-4o` only for outreach drafts — often **30–60% lower** OpenAI spend at the same search volume. Call that out separately so the client knows the quote is “as built,” not “optimized.”

### OpenAI — reconciling per-run vs monthly (boss item #2)

| Volume | Searches/mo | Drafts/mo | Approx. OpenAI/mo |
|--------|-------------|-----------|-------------------|
| Light | 20 | 50 | $20–$50 |
| Normal | 80 | 200 | $50–$150 |
| Heavy | 200 | 500 | $150–$300 |

Per-search line (~$0.25–$0.50) × searches + per-draft line (~$0.02–$0.05) × drafts = the monthly band. **$300/month at $0.50/search implies ~600 searches with few extra drafts** — the heavy column assumes more drafts on top.

### SerpAPI — credits-per-search multiplier (boss item #3)

| Component | Credits per CRM search |
|-----------|------------------------|
| LinkedIn lane queries (typical) | **4–7** (parallel lanes per search) |
| Email lookup (if enabled, per lead, max 25) | **+0–25** |
| **Typical total** | **~8–15** with moderate email enrichment |
| **Lanes only (email off)** | **~4–7** |

| Plan | Monthly credits | At ~10 credits/search | At ~15 credits/search |
|------|-----------------|----------------------|------------------------|
| Free | 250 | ~25 searches | ~16 searches |
| Starter ($25) | 1,000 | ~100 searches | ~65 searches |
| Developer ($75) | 5,000 | ~500 searches | ~330 searches |

**Do not** divide plan credits by “1 search = 1 credit.” One CRM search is a **multiplier**.

---

## Google Places — two SKUs + free tier vs steady state (boss item #6)

The codebase makes **two different Places call types**:

| Use | Avatars | API / fields | Free tier | After free tier |
|-----|---------|--------------|-----------|-----------------|
| Location picker autocomplete | 1/2 | Autocomplete Essentials | 10,000/mo | $2.83 / 1,000 |
| Place details (address fill) | 1/2 | Place Details **Pro** (`displayName`, etc.) | 5,000/mo | $17.00 / 1,000 |
| Business lead search | 3 | Text Search **Enterprise** (rating, hours, website, phone) | **1,000/mo** | **$35.00 / 1,000** |

| Scenario | Avatar 1/2 picker | Avatar 3 business search | Places total |
|----------|-------------------|----------------------------|--------------|
| **Month 1 / low volume** | $0 (under free tiers) | $0 (under 1k free) | **$0–$10** |
| **Steady state (normal column)** | ~$0–$5 | 20 searches × ~30 results ≈ 600 Enterprise calls → mostly free, small overage | **$0–$35** |
| **Steady state (heavy avatar 3)** | ~$5–$15 | 60 searches × ~30 results ≈ 1,800 calls → ~800 billable × $35/1k | **~$35–$80+** |

Avatar 3 is the Places cost driver once free quota is exhausted.

---

## Infrastructure & outreach (boss item #5)

These are **not in the core subtotal** but are required for production outreach and public landing pages.

| Item | Role in this app | Typical cost | Notes |
|------|------------------|--------------|-------|
| **Email sending** | SMTP from `outreach_send.py` (SendGrid, Amazon SES, Gmail workspace, etc.) | **$0–$20/mo** | Without SMTP config, emails are **logged only** (dev mode). |
| **SMS** | Twilio (optional) | **~$0.01–$0.04 / SMS** + ~$1.15/mo number | Falls back to log file if unset. |
| **WhatsApp** | Channel type exists in schema; **not wired** to a provider yet | TBD (Twilio / Meta Business API) | Budget if client wants WhatsApp outreach. |
| **Web hosting** | Next.js frontend (+ API) on **Vercel** | **$0 Hobby** · **$20/mo Pro** per seat | Landing pages are `/landing-page/[leadId]` on the same app. |
| **Video** | YouTube embed on landing page | **$0** | `NEXT_PUBLIC_LANDING_VIDEO_YOUTUBE_ID`; no separate video host bill. |
| **Scheduling** | Built-in date/time picker on landing page | **$0** today | **Calendly** (~$10–$16/user/mo) only if client wants external calendar sync instead of built-in booking. |

---

## Optional enrichment (avatar 1/2 only — not used in avatar 3 today)

Email enrichment in production uses **SerpAPI**, not these vendors. Listed for clients who want paid enrichment APIs.

| Vendor | What you get | Typical monthly |
|--------|--------------|-----------------|
| **Hunter.io** | Email only · shared credit pool | Free 50/mo → **$34–49** Starter (2,000 credits) → higher tiers |
| **Apollo.io** | Email + phone · per-seat | **$49–99/user/mo** · phone lookups cost extra credits |

Sources: [hunter.io/pricing](https://hunter.io/pricing) · [apollo.io/pricing](https://apollo.io/pricing)

---

## Monthly summary (client-facing)

Assumes volume table above. Enrichment optional rows excluded unless noted.

| Item | Light | Normal | Heavy |
|------|-------|--------|-------|
| OpenAI (`gpt-4o`) | $20–$50 | $50–$150 | $150–$300 |
| SerpAPI | $0–$25 | $25–$75 | $75–$275 |
| Google Places | $0–$10 | $0–$35 | $35–$80+ |
| Supabase Pro | $25 | $25 | $25 |
| **Core subtotal** | **~$45–$110** | **~$100–$285** | **~$285–$680** |

**+ Production infra (typical):** Vercel Pro **$20** + email **$0–$20** → add **~$20–$40/mo**.

**+ Hunter (optional):** +$34–$49/mo  
**+ Apollo (optional):** +$49–$99/user/mo (phone usage can push higher)

**Midpoint examples (normal column, core only):** ~**$120–$180/month** before optional enrichment or heavy avatar 3 Places overage.

---

## What changed vs earlier draft

1. Added explicit **volume assumptions** so monthly bands reconcile with per-run costs.  
2. Documented **SerpAPI credits-per-search** (lanes + email), not 1:1 searches.  
3. Split **Places** into month-1 (free tier) vs **steady-state** avatar 3 burn.  
4. Added **email / SMS / hosting / video / scheduling** lines with “as built” vs optional.  
5. Noted **gpt-4o** is current production pricing; **mini/4.1** called out as future savings.
