Requirements — Insurance Lead-Gen CRM (Working Title: "Peter's Pipeline")
Prepared for: Development Team Deliverable: Proof-of-Concept (working prototype, real sample data) Target review date: 7–9 working days from kickoff 
Reference: Extends our internal LeadScout tool (linkedin-leads-blyv.vercel.app)

1. Overview
A lead-generation and outreach CRM for a client targeting the insurance industry (microinsurance, auto, medical, etc.). The system reuses LeadScout's LinkedIn lead-search foundation, then adds profiling, multi-channel outreach, a self-service prospect funnel, and an AI-assisted follow-up engine.

The system serves three distinct prospect types (avatars), each with its own workflow. Avatars 1 & 2 share a funnel (different messaging); Avatar 3 uses a separate human-in-the-loop workflow.


2. Target Avatars
#
Avatar
Definition
Workflow
1
Open-to-work insurance/sales pros
On LinkedIn, "Open to Work", past experience in sales or insurance (micro/auto/medical)
Automated funnel A
2
Upgraders
Currently at smaller insurance firms, want to move to a bigger team
Automated funnel B (same as A, different messaging)
3
Small business owners
Founder-led businesses offering some insurance lines but not others (cross-sell/switch targets)
Human-in-the-loop workflow



3. Functional Requirements
3.1 Lead Sourcing & Profiling (all avatars)
Search/import LinkedIn leads (extend existing LeadScout capability) → ALREADY IMPLEMENTED IN 
Auto-classify each lead into Avatar 1, 2, or 3 based on profile attributes (open-to-work flag, current employer size, industry, business ownership)
Store enriched profile: name, headline, current role/company, past experience, location
Manual override of avatar classification
3.2 Avatar 1 & 2 — Automated Outreach Funnel
Outreach dispatch:

Send outreach via email, SMS, and/or LinkedIn DM
Each message contains a personalized cover message + a unique tracked link
Avatar 1 and Avatar 2 use different cover-message templates (same mechanics, different copy)

Landing page (per unique link):

Walkthrough / explainer video
Intake form: name, email, phone, city, work-related questions, free-text past-experience description
Calendar scheduling widget for booking an online meeting

Tracking:

Link click → form start → form submit → meeting booked (funnel visibility per lead)
3.3 Avatar 3 — Human-in-the-Loop Workflow
Separate page/section in the dashboard
Profile leads and capture contact details: email, phone, physical address
Present as a call/visit list for a human rep
Rep performs outreach (call or in-person visit), then adds notes to the lead record
3.4 Lead Lifecycle & Buckets (only Avatar 3)
Based on rep notes / funnel activity, a lead moves between status buckets:

Suggested buckets: New → Qualified → Warm → Follow-up Later → Sealed/Won → Lost → Not Interested
(Finalize exact bucket list with client — placeholder above)
Manual move + (where possible) automatic suggestions
3.5 AI Follow-Up Engine(only Avatar 3)
Feed lead notes to an AI agent
Agent plans a follow-up strategy across channels: email, WhatsApp, or (flag for) a human call
Output should be reviewable/approvable by a human before send (recommended for POC)


4. Data Model (core entities)
Lead — profile fields, avatar type, source, status bucket, timestamps
Interaction — channel, message sent, direction, timestamp, link to lead
Note — free text, author (human rep), timestamp, linked to lead
Funnel Event — link click / form submit / meeting booked
Outreach Template — per avatar, per channel
Follow-up Plan — AI-generated, linked to lead + notes


5. Proof-of-Concept Scope (7–9 day target)
Must demonstrate (with real sample data):

Lead list with avatar classification (reuse LeadScout base)
Avatar 1/2 funnel: send a tracked link → working landing page (video placeholder + form + calendar) → capture submission
Avatar 3 page: call/visit list + notes entry
Status buckets: move a lead through the pipeline
AI follow-up: feed notes → generate a suggested follow-up plan (single channel is fine for POC)

Out of scope for POC (phase 2):

Full multi-channel send automation at scale
Production-grade LinkedIn DM automation (compliance/rate-limit considerations)
Advanced analytics/reporting
Auth/roles/permissions hardening


6. Open Questions (confirm with client)
Exact status-bucket names and order
Preferred calendar tool (Calendly embed vs. custom)
Which AI provider/agent for follow-up planning
Email/SMS/WhatsApp sending providers (e.g., SendGrid, Twilio)
LinkedIn DM: manual-assist vs. automated (compliance risk)
Video: who supplies the walkthrough content



POC to be reviewed with client within 7–9 working days. Prioritize a clickable, data-backed demo over completeness.

