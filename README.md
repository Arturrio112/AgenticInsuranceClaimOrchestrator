# Agentic Insurance Claim Orchestrator

The **Agentic Insurance Claim Orchestrator** is an enterprise-grade, AI-driven insurance claim resolution system. By leveraging local Large Language Models (LLMs), it fully automates the end-to-end claim adjudication process. 

The orchestrator utilizes **LangGraph** to coordinate multi-step reasoning workflows, allowing the AI to independently retrieve policy details, check coverage limits, and review flags. It connects to an immutable **PostgreSQL** database securely through the **Model Context Protocol (MCP)**, ensuring the LLM accesses and manipulates data via well-defined, safe tool interfaces. 

## Features
- **Automated Adjudication:** Fully automated claim triage and resolution using local LLMs (Ollama with Gemma2 or Llama3.1).
- **Secure Data Access:** Immutable PostgreSQL database exposed via standard MCP tools.
- **Agentic Workflow:** LangGraph.js implementation for cyclic reasoning and tool-use orchestration.
- **Interfaces:** JWT-secured Webhook API and simple Web UI for claim submission and monitoring.
- **Observability:** Comprehensive observability with Langfuse tracing.
- **Audit Trail:** Every node, LLM call and tool call of a claim run is written to an append-only `audit_logs` table (UPDATE/DELETE are rejected by a DB trigger) and exposed via `GET /claims/:id/audit`.

## Architecture Data Flow

```mermaid
flowchart TD
    User([User]) -->|Submits Claim| UI[Web UI / Webhook API]
    UI -->|Triggers Workflow| LangGraph[LangGraph Agent Orchestrator]
    
    subgraph Agentic System
        LangGraph <-->|Reasons & Decides| LLM[Local LLM - Ollama]
        LangGraph <-->|Tool Execution| MCP[MCP Server]
    end
    
    MCP <-->|Queries & Updates| DB[(PostgreSQL)]
    LangGraph -.->|Traces & Telemetry| Langfuse[Langfuse Observability]
    LangGraph -.->|Audit callback| DB
```

## Setup Instructions

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- [Node.js](https://nodejs.org/en/) (v20 or v22)
- [Ollama](https://ollama.com/) (running locally)

### 1. Environment Configuration
Copy the sample environment file and adjust the variables if necessary.
```bash
cp .env.example .env
```
Ensure Ollama is running locally and the appropriate model is pulled (e.g., `llama3.1` or `gemma2`).
```bash
ollama pull llama3.1
```

#### Authentication settings
The API refuses to start unless these are set in `.env` (there are no built-in defaults):

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Secret used to sign and verify JWTs (HS256). Use a long random value, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `JWT_EXPIRES_IN` | Token lifetime, in seconds or as a duration (`15m`, `1h`, `7d`). Defaults to `1h`. |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | Credentials accepted by `POST /login`. |

Get a token and call the protected endpoint:
```bash
TOKEN=$(curl -s -X POST localhost:3000/login -H 'Content-Type: application/json' \
  -d '{"username":"<AUTH_USERNAME>","password":"<AUTH_PASSWORD>"}' | jq -r .token)
curl -X POST localhost:3000/claim -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"claim_id":1}'
```
`/login` returns `400` for a malformed body and `401` for wrong credentials; `/claim` returns `401` without a valid, unexpired token. The API and the MCP server share one auth module (`src/auth/jwt.ts`).

### 2. Run the Application using Docker Compose
The project uses Docker Compose to orchestrate the Node.js application, PostgreSQL database, and PgAdmin.
```bash
docker-compose up --build -d
```
*The API will be available at `http://localhost:3000` and PgAdmin at `http://localhost:5050`.*

### 3. Database Initialization (Optional)
If you need to seed the database manually, you can run the initialization scripts via npm. (The `app` container will connect to the `postgres` container on port 5432).
```bash
npm install
npm run build
npx ts-node src/db/schema.ts
npx ts-node src/db/seed.ts
```
*(You may also use `make db-seed` if configured in the Makefile).*

## Claim Decisions

`POST /claim` (JWT-protected) runs the agent and returns a structured, cited decision:

```json
{
  "claim_id": 1,
  "status": "approved",
  "decision": {
    "decision": "approve",
    "reasoning": "Policy POL-AUTO-12345 is active and the 1500 collision claim is within the 50000 limit.",
    "confidence_score": 92,
    "citations": { "policy_id": 1, "policy_number": "POL-AUTO-12345", "coverage_rule_ids": [1] },
    "fallback": false
  },
  "summary": "Investigation complete. ..."
}
```

- `status` is one of `approved`, `rejected`, `flagged`, or `needs_human_review`. Any decision with `confidence_score` below `CONFIDENCE_THRESHOLD` (default `70`) goes to `needs_human_review`.
- Citations only include policy and coverage-rule IDs that the tools actually returned. IDs the model invents are removed.
- If the model returns malformed output, the claim is safely routed to human review (`decision: "flag"`, `confidence_score: 0`, `fallback: true`).
- The response type is `ClaimResolutionResponse` in `src/api/types.ts`.

## Audit Trail
Each `POST /claim` run attaches an `AuditCallbackHandler` (`src/agent/callbacks/audit/`) that records
`node_start`/`node_end`, `llm_start`/`llm_end` (messages and tool calls), `tool_start`/`tool_end` (tool name, input, output)
and `error` events into `audit_logs`. Writes are queued in event order, flushed before the HTTP response returns,
and never fail the claim (errors are only logged). Long strings in payloads are truncated.

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/claims/1/audit
# => { "claim_id": 1, "count": 8, "entries": [{ "step_index": 0, "event_type": "node_start", "node_name": "agent", "payload": {...}, ... }] }
```

## Future Improvements
- **Duplication Triage:** Automatically detect and triage duplicate claims (using vector similarity or SQL) to prevent double payouts.
- **Fraud Scoring:** Analyze claims for potential fraud using ML heuristics or 3rd-party risk assessment APIs before auto-approving them.
