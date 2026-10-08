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

- [ ] **Ticket 4.1: Logger Setup**
  - Create `src/utils/logger.ts` for standardized console logging.
  - *Dependencies:* None.
- [ ] **Ticket 4.2: Langfuse Integration**
  - Integrate Langfuse callback handlers into `src/agent/graph.ts` or `src/agent/nodes/llm_node.ts` to trace LLM calls.
  - *Dependencies:* Ticket 4.1.
