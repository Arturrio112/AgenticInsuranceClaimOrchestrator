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
*   **Graph State:** `src/agent/state.ts` - Defines the channels and state object passed between nodes.
*   **Nodes:** `src/agent/nodes/`
    *   `llm_node.ts` - The node that interacts with Ollama (Gemma2/Llama3).
    *   `tool_node.ts` - The node that executes the MCP tools.
*   **Graph Routing:** `src/agent/graph.ts` - The edges and conditional routing logic binding the nodes together.
*   **Prompts:** `src/agent/prompts.ts` - System instructions for evaluating claims.
*   **Audit Callback:** `src/agent/callbacks/audit_callback.ts` - `AuditCallbackHandler` that writes node/LLM/tool/error events of a run into `audit_logs` (call `flush()` before responding).

### 4. API & Entry Points (`/src/api/`)
*How the outside world triggers the workflow.*
*   **Webhook Handler:** `src/api/webhook.ts` - Express app (exported as `app`) with the JWT-protected `POST /claim` route that triggers the LangGraph agent.
*   **Audit API:** `GET /claims/:id/audit` in `src/api/webhook.ts` - JWT-protected (`requireAuth`), returns the ordered audit entries for a claim.
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
`POST /webhook` ➔ `src/api/webhook.ts` ➔ `src/agent/graph.ts` ➔ `Ollama (LLM)` ➔ `ToolCall` ➔ `src/mcp/server.ts` ➔ `src/db/client.ts` ➔ `Postgres`
