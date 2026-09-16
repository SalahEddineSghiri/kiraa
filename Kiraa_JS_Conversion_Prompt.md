# CONTEXT & OBJECTIVE

I have two reference sources:

1. A working Python prototype notebook: `kiraa_tutorial_executed.ipynb`. It already implements a functional Kiraa agent: deterministic business engine, real OCR/PDF ingestion, structured extraction via an LLM, a LangGraph `StateGraph` with seven nodes (`ingestor_node`, `extractor_node`, `intent_node`, `validator_node`, `calculator_node`, `explainer_node`, `reporter_node`) and conditional routing, a TF-IDF RAG over `rental_policies.md`, a controlled Explainer, and a full E2E test suite.
2. The official specification: `Kiraa_Cahier_des_Charges_updated-javascript.pdf` (ESISA – Fès, Maroc).

**Before writing any code, read `kiraa_tutorial_executed.ipynb` cell by cell.** It is your primary source of truth for business logic, node responsibilities, state fields, and test scenarios. The cahier des charges is your primary source of truth for the mandatory tech stack, deployment requirements, and grading criteria. Where the two differ (for example: the notebook keeps data in-memory and marks PostgreSQL/Streamlit/Docker as `OUT_OF_SCOPE` for educational reasons), **the cahier des charges wins** — this JavaScript project must implement full PostgreSQL persistence, pgvector RAG, Next.js UI, and Docker Compose as mandatory, production deliverables, not optional extensions.

## OBJECTIVE

Convert the entire Python logic into a **Zero-Hallucination, production-ready full-stack web application** written in TypeScript, using Next.js (App Router), Node.js v20+, Drizzle ORM, PostgreSQL with pgvector, and LangGraph.js — strictly following the mandatory tech stack and 7-layer agentic architecture defined in the cahier des charges.

---

## 1. Mandatory Tech Stack (no substitutions)

- **Full-stack framework:** Next.js 14+, App Router, TypeScript, React, Tailwind CSS.
- **ORM & database:** Drizzle ORM (`drizzle-orm`, `drizzle-kit`, `drizzle-zod`) with PostgreSQL + `pgvector` extension.
- **Agent orchestration:** `@langchain/langgraph` (LangGraph.js) with state persistence via a PostgreSQL checkpoint adapter compatible with LangGraph.js.
- **Validation & contracts:** Zod and `drizzle-zod`, shared across DB, API, agent state, and UI — one schema, no duplication.
- **LLM & embeddings:** a real, configurable LLM SDK (`groq-sdk`, `@langchain/openai`, or equivalent) for intent classification, structured extraction, and explanation only. Embeddings must be pgvector-compatible; document the model, dimension, and similarity strategy (cosine).
- **Ingestion & OCR:** Node.js pipeline (`pdf-parse` or `pdfjs-dist` for native PDF text, `tesseract.js` or a Vision API for OCR fallback) supporting JPG/JPEG/PNG, PDF, JSON, TXT.
- **Document generation:** `pdfkit` or `docx` for the Reporter node.
- **Testing:** Vitest (unit + E2E).
- **Containerization:** Docker, `docker-compose.yml` for local evaluation, plus a documented remote HTTPS deployment.

No Python, no in-memory-only datasets for operational data, no shortcuts inherited from the notebook's educational scope reductions.

---

## 2. Zero-Hallucination Axiom & Deterministic Engine

- The LLM handles **only** intent recognition, structured extraction, and natural-language explanation.
- 100% deterministic calculations — driver eligibility, fleet availability, pricing, discounts, mileage penalties — run in pure TypeScript functions with zero LLM involvement. Port these directly from the notebook's Module 2 functions (`verify_driver_eligibility`, `check_vehicle_availability`, `calculate_total_price`, `calculate_mileage_penalty`), preserving the exact same rules and constants:
  - Deposit by category (Economy, Compact, SUV, Premium, Utility) — use the same MAD amounts as the notebook.
  - Insurance options and rates (basic, all-risk, franchise buy-back) — same daily rates and flat fees as the notebook.
  - Discount codes and their nominal rates — same codes, same caps.
  - Mileage extra rate — same MAD/km value as the notebook.
  - Seasonal multipliers by month/category — same values as the notebook.
- **Financial formula (exact):**
  ```
  Total = (BasePrice × Days × SeasonalMultiplier) + InsuranceCost + Deposit − CappedDiscount
  Total = max(Total, Deposit)
  ```
  - Discount is strictly capped at 15%, regardless of the nominal rate on the code.
  - Deposit is increased by +50% for drivers under 25 years old.
- **RAG vs. operational data isolation:**
  - PostgreSQL/TypeScript: fleet catalog, customer profiles, booking logs, seasonal pricing matrix.
  - RAG (`rental_policies.md` + pgvector): used **exclusively** for commercial-policy questions (cancellation, deductible, insurance, mileage limits). Never use the specification PDF or the notebook itself as RAG source material.

---

## 3. Zero-Trust Controls (mandatory — missing from earlier draft)

Implement these exact behaviors, matching the cahier des charges:

- Off-topic or corrupted file → reject, ask for a new file.
- Missing required field → state `CLARIFICATION_REQUIRED`.
- Ambiguous date → request clarification, do not guess.
- Conflict between form input, extracted document data, and user message → require human confirmation.
- Extraction confidence below threshold → route to human review.

Never invent a missing field. Never silently proceed with incomplete or contradictory data.

---

## 4. Taxonomy of 7 Intents & HITL Thresholds

**Intents:** `check_availability`, `calculate_total_cost`, `validate_eligibility`, `make_reservation`, `policy_query`, `human_escalation`, `out_of_scope`.

**Human escalation triggers `needs_human_review = true` when:**
- OCR confidence score < 0.85.
- Young driver (21–24 years old) booking a Premium category vehicle.
- Required security deposit > 20,000 MAD.
- Direct conflict between form input, extracted document data, and user message.

---

## 5. Port the Notebook's LangGraph Topology Exactly

Study `Module 4` of the notebook and reproduce the same graph shape in LangGraph.js:

- Nodes: `ingestorNode`, `extractorNode`, `intentNode`, `validatorNode`, `calculatorNode`, `explainerNode`, `reporterNode`.
- Conditional routing functions equivalent to the notebook's `route_intent`, `route_after_validator`, `route_after_calculator` — same branching logic (policy queries skip the calculator's pricing path but use it for RAG; eligibility-only requests skip pricing; reservations run validator → calculator → reporter).
- A shared state type (`KiraaState`) as a Zod schema / TypeScript type containing at minimum: `requestId`, `rawInput`, `intent`, `intentConfidence`, `params`, `extractedContent`, `ocrConfidence`, `eligibilityResult`, `priceResult`, `bookingStatus`, `ragPassages`, `validation`, `needsHumanReview`, `escalationReasons`, `errors`, `explanation`, `report`, `graphTrace`.
- Preserve an `intentOverride` field usable only in deterministic Vitest E2E scenarios — never in the production route.
- Log the actual node execution path (`graphTrace`) for each request, same as the notebook does.

---

## 6. Expected Deliverables

Generate a production-ready codebase including:

**Architecture**
- `/app` (routes, API endpoints, UI pages)
- `/db` (`schema.ts`, `seed.ts`, migrations)
- `/lib/agent` (LangGraph.js graph, nodes, routing)
- `/lib/engine` (deterministic business functions)
- `/lib/ingestor` (OCR/PDF/JSON/TXT pipeline)
- `/lib/reporter` (PDF/DOCX generation)
- `/lib/schemas` (Zod schemas — extraction, state, API contracts)
- `/components` (React UI, including `ChatUI.tsx`)
- `/tests` (Vitest unit + E2E)

**Configuration**
- Complete `package.json` with all production dependencies.
- `docker-compose.yml` (Next.js app + PostgreSQL/pgvector + persistent volume + internal network + healthchecks for both services) and a production `Dockerfile` (Node 20-slim base).
- `.env.example` with all required variables, no secret values.
- `.dockerignore`, `.gitignore`.

**Database & Drizzle**
- Schemas for `fleet_catalog`, `customer_profiles`, `booking_logs`, `seasonal_pricing_matrix`, `rental_policies_vectors` (pgvector column), and LangGraph checkpoint tables.
- An idempotent, non-destructive TypeScript seed script loading the same source CSVs the notebook uses (`CarRentalData.csv`, etc.), never overwriting a populated remote database.

**Deterministic engine**
- Pure functions: `verifyDriverEligibility`, `checkVehicleAvailability`, `calculateTotalPrice`, `calculateMileagePenalty` — parity-tested against the notebook's 14 deterministic assertions.

**Zod schemas**
- Extraction schema (equivalent to `DriverLicenseSchema`), state validation schema, API request/response contracts — shared across DB, API, agent, and UI.

**Ingestion & OCR**
- Node.js service handling JPG/PNG, PDF (native extraction first, OCR fallback if native text is insufficient — same threshold logic as the notebook), JSON, TXT, with confidence scoring and `CLARIFICATION_REQUIRED` handling for defective files.

**LangGraph.js orchestration**
- `StateGraph` implementing the 7 nodes above, conditional routing, PostgreSQL-backed checkpointing, and human-escalation logic exactly matching the notebook's rules.

**Reporter**
- PDF/DOCX quote and contract generator using validated engine output only.

**API routes**
- `/app/api/chat/route.ts` (agent execution)
- `/app/api/health/route.ts` (checks both app and PostgreSQL connectivity — required for Docker/remote healthchecks)

**UI**
- `ChatUI.tsx`: message input, multi-file upload (JPG/PNG/PDF/JSON/TXT), OCR confidence display, RAG source citations, deterministic validation badges, human-review status, PDF quote download.

**Tests**
- Vitest unit tests for the engine (parity with the notebook's 14 assertions).
- Vitest E2E tests reproducing the notebook's 5 scenarios: underage driver rejected, expired license blocked, young driver + Premium → HITL + 50% deposit increase, discount over 15% capped, cancellation policy answered only via RAG.

**Deployment & documentation (mandatory — previously missing)**
- Two deployment modes: local evaluation (Docker Compose) and remote HTTPS demonstration — both required, not optional.
- Remote deployment must include: persistent pgvector-compatible PostgreSQL, secrets manager (no hardcoded keys), HTTP healthcheck, PostgreSQL health monitoring, auto-restart on failure, upload size limits, protected admin routes, and a documented rollback/archive/delete procedure.
- README documenting: install/run/test instructions, environment variables, secrets handling, ports, URLs, healthcheck routes, logging, access control, supervision, rollback, repository naming convention, and a 5-minute functional demo script.
- A final readiness report confirming the remote URL responds and all 5 E2E scenarios pass.

---

## 7. Grading Priorities (for your own prioritization)

- 25% — LangGraph.js architecture: 7 layers, state graph, persistence, intent routing, human escalation, zero-hallucination axiom.
- 20% — Deterministic engine + Zod validation: eligibility rules, financial calculation, 15% discount cap, 50% deposit increase.
- 15% — PostgreSQL + pgvector RAG: schemas, migrations, persistence, `rental_policies.md` ingestion, relevant passage retrieval.
- 15% — Multi-format ingestion & OCR: images, PDF, JSON, TXT, native PDF extraction, OCR fallback, confidence scoring, human review.
- 15% — Vitest tests & code quality: unit + E2E, critical scenarios, error handling, readability, no secrets in the repo.
- 10% — Next.js UI & remote demo: accessible interface, clear user flow, file upload, decision display, HTTPS deployment, reproducible demo.

---

## INPUT FILES

- `kiraa_tutorial_executed.ipynb` (primary logic and node-topology reference)
- `Kiraa_Cahier_des_Charges_updated-javascript.pdf` (binding specification)
- `rental_policies.md` (RAG corpus)
- `CarRentalData.csv` and other sample CSVs (seed source data)
- Sample test files: one JPG, one PDF, one JSON, one TXT
