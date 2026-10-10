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
*   **Database Client:** `src/db/client.ts` - The connection logic to PostgreSQL (using `pg` or an ORM like Prisma).
*   **Seed Data:** `scripts/seed.ts` - Scripts to populate the database with mock insurance data.
*   **Audit Trail:** `src/db/schema.ts` defines the append-only `audit_logs` table (trigger rejects UPDATE/DELETE); `src/db/audit_repository.ts` exposes only `insertAuditLog` and `getAuditLogsForClaim`.

### 2. MCP Server Layer (`/src/mcp/`)
*Everything related to exposing tools to the LLM via Model Context Protocol.*
*   **Server Initialization:** `src/mcp/server.ts` - The core MCP server setup and transport configuration.
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
*   **Nodes:** `src/agent/nodes/`
    *   `load_claim_node.ts` - Loads the claim + policy number from Postgres into state before the agent runs.
    *   `llm_node.ts` - The investigating agent (tool-calling LLM). Sees the claim details in its system prompt.
    *   `tool_node.ts` - Executes the read-only tools (`get_policy`, `check_coverage`).
    *   `decide_node.ts` - Structured final decision via `withStructuredOutput` + zod; invalid output falls back to `flag` / confidence 0; invented citation IDs are dropped.
    *   `persist_node.ts` - Writes status + decision columns to `claims`; low confidence -> `needs_human_review`.
*   **Graph Routing:** `src/agent/graph.ts` - The edges and conditional routing logic binding the nodes together.
*   **Prompts:** `src/agent/prompts.ts` - Agent system prompt, claim context formatter and decision prompt.
*   **Audit Callback:** `src/agent/callbacks/audit_callback.ts` - `AuditCallbackHandler` that writes node/LLM/tool/error events of a run into `audit_logs` (call `flush()` before responding).

### 4. API & Entry Points (`/src/api/`)
*How the outside world triggers the workflow.*
*   **Webhook Handler:** `src/api/webhook.ts` - Express app (exported as `app`) with the JWT-protected `POST /claim` route that triggers the LangGraph agent and returns a `ClaimResolutionResponse`.
*   **Audit API:** `GET /claims/:id/audit` in `src/api/webhook.ts` - JWT-protected (`requireAuth`), returns the ordered audit entries for a claim.
*   **API Types:** `src/api/types.ts` - Exported request/response interfaces (shared with the UI).
*   **Login Route:** `src/api/routes/auth.ts` - `POST /login`; validates the body (400), checks credentials (401) and issues a JWT.

### 4a. Authentication (`/src/auth/`)
*Single shared auth module used by both the API and the MCP server.*
*   **JWT:** `src/auth/jwt.ts` - Loads `JWT_SECRET` (required, no fallback) and `JWT_EXPIRES_IN` (default `1h`); exposes `signToken`, `verifyToken` (typed payload or `null`, HS256 only) and the Express `requireAuth` middleware.
*   **Credentials:** `src/auth/credentials.ts` - Compares `/login` input with `AUTH_USERNAME` / `AUTH_PASSWORD` using `crypto.timingSafeEqual`.
*   **Tests:** `src/__tests__/auth/` - Unit tests for token handling, the middleware and `/login` (no DB or LLM needed).

### 5. Configuration & Observability (`/`)
*   **Docker:** `docker-compose.yml` - Spins up Postgres.
*   **Observability:** `src/utils/logger.ts` or Langfuse configuration injected into the LangGraph setup.
*   **Environment Variables:** `.env` (Ignored in Git) - Stores DB credentials, Langfuse API keys and auth settings (`JWT_SECRET`, `JWT_EXPIRES_IN`, `AUTH_USERNAME`, `AUTH_PASSWORD`). See `.env.example`.

---

## 🔄 Data Flow (Quick Reference)
`POST /claim` ➔ `src/api/webhook.ts` ➔ `src/agent/graph.ts` ➔ `Ollama (LLM)` ➔ `ToolCall` ➔ `src/db/client.ts` ➔ `Postgres`

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
