# Feature Map (Architecture & Context Guide)

This document serves as a spatial map for AI agents to understand the codebase structure, where specific features are implemented, and how the modules interact.

## 🏗 System Architecture

The project is divided into three main domains:
1.  **Database Layer (PostgreSQL)**: Stores policies, rules, and claims.
2.  **MCP Server Layer**: Exposes database operations as standardized tools.
3.  **Orchestration Layer (LangGraph)**: The agentic brain that reasons about claims and calls MCP tools.

---

## 📂 Codebase Geography

### 1. Database & Infrastructure (`/src/db/`)
*Everything related to data persistence and schemas.*
*   **Schema Definitions:** `src/db/schema.ts` (or `.sql` files in `/scripts/`) - Defines the `policies`, `coverage_rules`, and `claims` tables.
*   **Database Client:** `src/db/client.ts` - The connection logic to PostgreSQL (`pg` pool, created lazily on first query; `closePool()` shuts it down).
*   **Database Config:** `src/db/config.ts` - `getDbConfig()` validates the connection settings: `DATABASE_URL`, or `DB_USER`/`DB_PASSWORD`/`DB_NAME` (no credential fallbacks; only `DB_HOST`/`DB_PORT` default). Called at startup in `src/index.ts` so the app fails fast.
*   **Seed Data:** `src/db/seed.ts` - Truncates the tables and inserts the demo policies, coverage rules and claims (`make db-seed`).
*   **Test-Data Generator:** [x] `src/db/generate.ts` (`make db-generate CLAIMS=<n> SEED=<n>`, `npm run db:generate`) - Append-only (never truncates or deletes): adds new policies, missing catalog coverage rules and `pending` claims covering the scenarios covered / over_limit / inactive_policy / no_rule / exclusion / at_limit, plus the low-confidence scenarios contradictory_damage / uncertain_evidence / uncertain_cause / amount_mismatch (facts that conflict or that the claimant is unsure about, expected to land in `needs_human_review`), and prints a summary table.
*   **Decision Eval (real LLM):** [x] `src/evals/decision/` (`make eval CLAIMS=<n> SEED=<n>`) - Appends generated claims, runs the full graph on each against the configured LLM and prints verdict / confidence per scenario, checking uncertain scenarios land below `CONFIDENCE_THRESHOLD` and clear-cut ones at or above it. Not part of `npm test`/CI; `report.ts` is unit-tested.
    *   `src/db/generate/catalog.ts` - Rule catalog (auto, home, travel), uncovered damage types and natural-language description templates.
    *   `src/db/generate/scenarios.ts` - Pure, seeded (mulberry32) scenario builders; `generateDataset()` respects existing rules' limits and taken policy numbers.
    *   `src/db/generate/args.ts`, `summary.ts`, `writer.ts` - CLI parsing, console summary and the INSERT-only DB writer (run in one transaction).
    *   Tests: `src/__tests__/db/generate/`.
*   **Audit Trail:** `src/db/schema.ts` defines the append-only `audit_logs` table (trigger rejects UPDATE/DELETE); `src/db/audit_repository.ts` exposes only `insertAuditLog` and `getAuditLogsForClaim`.

### 2. MCP Server Layer (`/src/mcp/`)
*Everything related to exposing tools to the LLM via Model Context Protocol.*
*   **Server Initialization:** `src/mcp/server.ts` - `createMcpServer()` builds a fresh server with all tools registered (no transport); `runServer()` serves it over stdio for external clients and for the agent's stdio mode. The MCP tools are the only implementation of the agent's tools (Epic 11).
*   **Tool Definitions:** `src/mcp/tools/`
    *   `get_policy.ts` - Tool to fetch active policy details.
    *   `check_coverage.ts` - Tool to fetch business rules for damage types.
    *   `flag_review.ts` - Tool to mutate claim status in the DB.
*   **Authentication:** `src/mcp/auth.ts` - Thin MCP-side wrapper that delegates token validation to the shared `src/auth/jwt.ts` module.

### 3. Orchestration Layer (`/src/agent/`)
*Everything related to LangGraph and the LLM workflow.*
*   **Graph State:** `src/agent/state.ts` - Defines the channels and state object passed between nodes (`messages`, `claim`, `decision`, `claim_status`).
*   **Model Factory:** `src/agent/model.ts` - Builds the typed `BaseChatModel` for `LLM_PROVIDER` (Ollama by default). The single seam tests mock to fake the LLM.
*   **Decision Contract:** `src/agent/decision.ts` - Zod `DecisionSchema`, `ClaimDecision` type, citation cross-checking and the safe fallback decision.
*   **Config:** `src/agent/config.ts` - `CONFIDENCE_THRESHOLD` (default 70).
*   **MCP Client:** `src/agent/mcp_client.ts` - Ticket 11.1 [x]. Connects to the project's MCP server (`MCP_TRANSPORT=inmemory` default via `InMemoryTransport`, or `stdio` spawning `dist/mcp/server.js` / `MCP_SERVER_PATH`), converts its tools with `@langchain/mcp-adapters` and keeps only `AGENT_TOOL_ALLOW_LIST` (`get_policy`, `check_coverage`; never `flag_review`). `getAgentTools()` shares one connection, `closeMcpClient()` shuts it down. Tools carry `mcp_server` / `mcp_transport` metadata, which the audit trail and Langfuse record.
*   **Nodes:** `src/agent/nodes/`
    *   `load_claim_node.ts` - Loads the claim + policy number from Postgres into state before the agent runs.
    *   `llm_node.ts` - The investigating agent (tool-calling LLM), bound to the MCP-served tools. Sees the claim details in its system prompt.
    *   `tool_node.ts` - Ticket 11.2 [x]. `createToolNode(tools)`: executes the MCP-served read-only tools (`get_policy`, `check_coverage`). No tool or DB code of its own.
    *   `decide_node.ts` - Structured final decision via `withStructuredOutput` + zod; invalid output falls back to `flag` / confidence 0; invented citation IDs are dropped.
    *   `persist_node.ts` - Writes status + decision columns to `claims`; low confidence -> `needs_human_review`.
*   **Graph Routing:** `src/agent/graph.ts` - The edges and conditional routing logic binding the nodes together. `buildAgentGraph(tools)` compiles the graph for a tool set (tests inject fakes); `getAgentGraph()` builds it once the MCP tools are loaded; `app.invoke()` is the API's entry point.
*   **Prompts:** `src/agent/prompts.ts` - Agent system prompt, claim context formatter and decision prompt. [x] `buildDecisionSystemPrompt(threshold)` scores confidence with a start-at-100 checklist (contradicting damage type, unconfirmed evidence, cause straddling an exclusion, mismatched figures, vague description); the per-problem penalty comes from `confidencePenalty(threshold)` so one conflicting fact lands below `CONFIDENCE_THRESHOLD`, while clear-cut rejects stay high.
*   **Audit Trail:** `src/agent/callbacks/audit/` - Records node/LLM/tool/error events of a run into `audit_logs` (call `flush()` before responding). Import from the folder's `index.ts`.
    *   `audit_callback_handler.ts` - `AuditCallbackHandler`: maps LangChain/LangGraph callback events to audit records.
    *   `audit_writer.ts` - `AuditWriter`: step indexes, ordered write queue, swallows and logs DB failures.
    *   `run_tracker.ts` - Remembers which graph node / tool each in-flight run belongs to.
    *   `run_metadata.ts` - Reads node names and model/tool names from callback metadata and tags.
    *   `llm_result.ts` - Builds the `llm_end` payload (messages, tool calls, provider output).
    *   `json_safe.ts` - Converts payloads to JSONB-safe values (truncation, cycles, depth limit).
    *   `types.ts` - Shared payload/metadata/run-context types.

### 4. API & Entry Points (`/src/api/`)
*How the outside world triggers the workflow.*
*   **Webhook Handler:** `src/api/webhook.ts` - Express app (exported as `app`) with the JWT-protected `POST /claim` route that triggers the LangGraph agent and returns a `ClaimResolutionResponse`.
*   **Audit API:** `GET /claims/:id/audit` in `src/api/webhook.ts` - JWT-protected (`requireAuth`), returns the ordered audit entries for a claim.
*   **API Types:** `src/api/types.ts` - Exported request/response interfaces (shared with the UI).
*   **Login Route:** `src/api/routes/auth.ts` - `POST /login`; validates the body (400), checks credentials (401) and issues a JWT.
*   **Claims Routes:** `src/api/routes/claims.ts` - JWT-protected `GET /claims` (all claims, by id) and `GET /claims/:id` (400 bad id, 404 unknown) returning `ClaimSummary`.
*   **Decision Sources:** `src/api/sources.ts` - Resolves `decision.citations` to full policy / coverage-rule rows for the `sources` field of `POST /claim` (Ticket 7.2 [x]; the UI renders it as the Source of Truth section in `public/js/result.mjs`).
*   **Read Repositories:** `src/db/claims_repository.ts` (claims joined with policies) and `src/db/sources_repository.ts` (policies, coverage rules); parameterized queries, DECIMAL -> number, Date -> ISO 8601.

### 4a. Authentication (`/src/auth/`)
*Single shared auth module used by both the API and the MCP server.*
*   **JWT:** `src/auth/jwt.ts` - Loads `JWT_SECRET` (required, no fallback) and `JWT_EXPIRES_IN` (default `1h`); exposes `signToken`, `verifyToken` (typed payload or `null`, HS256 only) and the Express `requireAuth` middleware.
*   **Credentials:** `src/auth/credentials.ts` - Compares `/login` input with `AUTH_USERNAME` / `AUTH_PASSWORD` using `crypto.timingSafeEqual`.
*   **Tests:** `src/__tests__/auth/` - Unit tests for token handling, the middleware and `/login` (no DB or LLM needed).

### 4b. Web UI (`/public/`) - Ticket 6.1 [x]
*Framework-free claims console served statically by Express. Plain HTML, CSS and browser ES modules; no build step.*
*   **Page:** `public/index.html` - Sign-in view and the console (claims list + case panel).
*   **Styles:** `public/css/app.css` - Design tokens, light/dark via `prefers-color-scheme`, responsive down to phone width.
*   **Entry point:** `public/js/main.mjs` - State and wiring: sign-in, claims list, running an investigation, 401 -> back to sign-in.
*   **API client:** `public/js/api.mjs` - `login`, `listClaims` (`GET /claims`), `investigateClaim` (`POST /claim`) with the JWT header.
*   **View model:** `public/js/view-model.mjs` - Pure, DOM-free logic: status labels/tones, currency/date formatting, confidence bands vs. `CONFIDENCE_THRESHOLD`, Source of Truth card text, pipeline stage timing. Unit-tested in `src/__tests__/ui/viewModel.test.mjs` (native ESM under Jest).
*   **Rendering:** `public/js/claims-list.mjs`, `public/js/pipeline.mjs`, `public/js/result.mjs`, helpers in `public/js/dom.mjs`, token storage in `public/js/session.mjs`.

### 5. Configuration & Observability (`/`)
*   **Docker:** `docker-compose.yml` - Spins up Postgres.
*   **Observability:** `src/utils/logger.ts` or Langfuse configuration injected into the LangGraph setup.
*   **Environment Variables:** `.env` (Ignored in Git) - Stores DB credentials, Langfuse API keys and auth settings (`JWT_SECRET`, `JWT_EXPIRES_IN`, `AUTH_USERNAME`, `AUTH_PASSWORD`). See `.env.example`.
*   **MCP transport:** `MCP_TRANSPORT` (`inmemory` | `stdio`) and `MCP_SERVER_PATH` select how the agent reaches the MCP server.

---

## 🔄 Data Flow (Quick Reference)
`POST /claim` ➔ `src/api/webhook.ts` ➔ `src/agent/graph.ts` ➔ `Ollama (LLM)` ➔ `ToolCall` ➔ `src/agent/mcp_client.ts` ➔ `MCP server (src/mcp/tools/)` ➔ `src/db/client.ts` ➔ `Postgres`

### Graph Flow
```
START -> load_claim --(claim not found)--> END   (API returns 404)
             |
             v
           agent <--> tools        (loop while the agent requests get_policy / check_coverage)
             |
             v
           decide                  (structured output: decision, reasoning, confidence_score, citations)
             |
             v
           persist -> END          (claims.status = approved | rejected | flagged,
                                    or needs_human_review if confidence_score < CONFIDENCE_THRESHOLD)
```
The investigation loop is read-only; `persist` is the only node that changes a claim's status.

### Claim statuses
`pending` -> `approved` | `rejected` | `flagged` | `needs_human_review`.
Decision columns on `claims`: `ai_decision`, `decision_reasoning`, `confidence_score`, `cited_policy_id`, `cited_rule_ids`, `decided_at`.
