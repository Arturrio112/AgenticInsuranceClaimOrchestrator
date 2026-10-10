# Epics & Ticket Breakdown

We have successfully completed **Phase 1: Database Layer & Infrastructure**. The remaining work has been broken down into Epics and Tickets. Many of these tickets are designed to be independent so they can be picked up by parallel subagents.

## 🚀 Epic 1: MCP Server Implementation
*Goal: Expose our database capabilities to the LLM via standard Model Context Protocol tools.*

- [x] **Ticket 1.1: Core Server & Auth**
  - Create `src/mcp/server.ts` (Core MCP setup & transport).
  - Create `src/mcp/auth.ts` (Mock JWT validation).
  - *Dependencies:* None.
- [x] **Ticket 1.2: `get_policy` Tool**
  - Implement `src/mcp/tools/get_policy.ts` to query DB for policy details.
  - Write unit test in `src/__tests__/mcp/get_policy.test.ts`.
  - *Dependencies:* Ticket 1.1.
- [x] **Ticket 1.3: `check_coverage` Tool**
  - Implement `src/mcp/tools/check_coverage.ts` to fetch business rules.
  - Write unit test in `src/__tests__/mcp/check_coverage.test.ts`.
  - *Dependencies:* Ticket 1.1.
- [x] **Ticket 1.4: `flag_review` Tool**
  - Implement `src/mcp/tools/flag_review.ts` to mutate claim status in DB.
  - Write unit test in `src/__tests__/mcp/flag_review.test.ts`.
  - *Dependencies:* Ticket 1.1.

> [!TIP]
> Once Ticket 1.1 is done, Tickets 1.2, 1.3, and 1.4 can be assigned to **3 separate subagents** to complete in parallel.

---

## 🧠 Epic 2: LangGraph Orchestration Layer
*Goal: Create the agentic brain that reasons about claims and triggers our MCP tools.*

- [x] **Ticket 2.1: State & Prompts Definition**
  - Create `src/agent/state.ts` (Graph channels/state).
  - Create `src/agent/prompts.ts` (System instructions).
  - *Dependencies:* None.
- [x] **Ticket 2.2: Nodes Implementation**
  - Create `src/agent/nodes/llm_node.ts` (Ollama integration).
  - Create `src/agent/nodes/tool_node.ts` (Tool execution logic).
  - *Dependencies:* Ticket 2.1.
- [x] **Ticket 2.3: Graph Assembly & Routing**
  - Create `src/agent/graph.ts` (Connecting nodes with conditional routing).
  - *Dependencies:* Ticket 2.2.

---

## 🌐 Epic 3: API & E2E Verification
*Goal: Expose the system to the outside world and verify the entire pipeline.*

- [x] **Ticket 3.1: Webhook Entry Point**
  - Create `src/api/webhook.ts` (Express/FastAPI equivalent route).
  - *Dependencies:* Epic 2.
- [x] **Ticket 3.2: E2E Eval Testing**
  - Write the final `src/__tests__/e2e/claim_resolution.test.ts` to trigger a webhook with a mock claim and assert the final DB state.
  - *Dependencies:* Epic 1, Epic 2, Ticket 3.1.

---

## 📊 Epic 4: Observability & Langfuse Integration
*Goal: Instrument the agent with tracing and observability to monitor LLM performance, tool usage, and overall claim resolution times.*

- [x] **Ticket 4.1: Logger Setup**
  - Create `src/utils/logger.ts` for standardized console logging.
  - *Dependencies:* None.
- [x] **Ticket 4.2: Langfuse Integration**
  - Integrate Langfuse callback handlers into `src/agent/graph.ts` or `src/agent/nodes/llm_node.ts` to trace LLM calls.
  - *Dependencies:* Ticket 4.1.

---

## 🔒 Epic 5: Security & JWT Validation
*Goal: Secure the MCP server and Webhook API using JWT authentication.*

- [x] **Ticket 5.1: API Authentication Middleware**
  - Implement JWT validation in `src/api/webhook.ts` and `src/mcp/auth.ts` to ensure only authorized clients can trigger the claim resolution workflow.
  - *Dependencies:* None.

---

## 💻 Epic 6: Simple Web UI
*Goal: Create a simple frontend to interact with the insurance claim orchestrator.*

- [x] **Ticket 6.1: Frontend UI Application**
  - Create a simple HTML/JS or React frontend (e.g. in a `public/` folder served by Express) where users can input a claim, submit it, and see the AI's response and decision.
  - *Dependencies:* Epic 5 (for auth if needed, or can be done in parallel).

---

## 📝 Epic 7: Descriptive End Product & Source Linking
*Goal: Ensure the AI's final decision is highly transparent and cites the specific business rules used.*

- [x] **Ticket 7.1: Citation Generation**
  - Update the LLM node prompt to require structured output containing the exact `coverage_rules` or `policies` IDs used in the decision.
- [ ] **Ticket 7.2: UI/API Response Enhancement**
  - Update the webhook response schema and the UI to clearly display the "Source of Truth" linking back to the specific policy clauses.

---

## 🧑‍⚖️ Epic 8: Low Confidence Tagger & Human-in-the-loop
*Goal: Tag ambiguous or complex claims for human review rather than auto-resolving them.*

- [x] **Ticket 8.1: Confidence Scoring**
  - Implement structured output in the LLM decision step to include a `confidence_score` (0-100%).
- [x] **Ticket 8.2: Human Review Routing**
  - Update the orchestration layer to flag the claim in the database with a `needs_human_review` tag if the confidence falls below a configured threshold.

---

## 📜 Epic 9: Audit Trail Logging
*Goal: Maintain an immutable record of every step the AI took to reach a decision.*

- [ ] **Ticket 9.1: Audit Table Creation**
  - Create an `audit_logs` table in PostgreSQL to store the agent's thought process, tool invocations, and state transitions per claim.
- [ ] **Ticket 9.2: Audit LangGraph Callback**
  - Implement a LangGraph callback handler that writes the internal execution trace directly into the `audit_logs` table.
