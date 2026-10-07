# QuickCart — Presentation Outline

An 8-slide deck for Canva. Vercel-minimal: black/white, generous space, short lines, one idea per bullet.

---

## Slide 1 — QuickCart Intelligence Platform

- Local-first quick-commerce intelligence, end to end
- One pipeline: Postgres → Spark/Delta → ML, RAG, agent
- Two front doors: Operations console and Business layer
- Runs on a laptop — zero cloud, zero paid APIs
- Grounded by data, governed by humans

---

## Slide 2 — The problem

- Q-commerce decisions are fast; the data is slow and technical
- Dashboards speak SQL, Delta, and IDs — managers don't
- "Late rate" computed three ways in three places
- AI tools hallucinate numbers and act without permission
- Need: plain answers, real figures, safe actions

---

## Slide 3 — Dual experience, one app

- Operations console at `/` for engineers, ops, analysts
- Business layer at `/b/*` for managers and leadership
- Role decides where you land after login
- ExperienceSwitcher jumps between the two views
- Business hides every piece of jargon by design

---

## Slide 4 — Architecture

- PostgreSQL is the operational source of truth
- CDC (Debezium) + Redpanda stream changes live
- Medallion: Raw → Bronze → Silver → Gold (Delta ACID)
- Serving read model in Postgres powers the business app
- FastAPI is the single boundary for both front ends

---

## Slide 5 — Tech stack

- Python 3.12, Java 17, PySpark 4.2, Delta 4.4
- Redpanda + Debezium streaming; Airflow batch orchestration
- Spark MLlib + MLflow; Qdrant RAG with local embeddings
- Gemini (opt-in) or Ollama (local) — never required to run
- Next.js + shadcn front ends; optional Vercel + AWS demo

---

## Slide 6 — Manager layer (`/b/*`)

- Today, Stores, Products, Delivery, Money, Targets, Customers
- Every tile: plain label, ₹ value, vs-last-week, status word
- Guided journeys answer real questions on real screens
- Assistant v2: words from the model, numbers from the server
- Matrix Orb voice — push-to-talk, provenance-checked answers

---

## Slide 7 — Operations console (`/`)

- Live overview, system map, and SSE streaming views
- SQL, data, database, cube, lineage, and layer explorers
- ML, logs, proposals, and embedded Streamlit dashboard
- RBAC: business roles never get raw SQL execute
- Proposals: AI drafts PENDING, humans tap to approve

---

## Slide 8 — Demo and outcomes

- Live: quikcart.tomriddle.in — frontend on Vercel, API on AWS
- Log in as a persona → onboarding → Today in minutes
- `/b/today` p95 target < 150 ms (measured ~10 ms local)
- Eval set: ≥90% card accuracy, 100% contract, zero scope leaks
- Ask by text or voice; approve a restock with one tap
- Phase 16 complete: identity, metrics, assistant, voice, actions
