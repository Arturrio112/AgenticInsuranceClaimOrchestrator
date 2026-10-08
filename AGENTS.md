# Agent Instructions (Antigravity)

Welcome to the Agentic Insurance Claim Orchestrator project. 
As an AI Agent (Antigravity), you are tasked with building this project alongside the User.

## 🛠 Tech Stack
- **Language:** TypeScript / Node.js
- **Database:** PostgreSQL (running in Docker)
- **Agent Framework:** LangGraph.js
- **Tooling Protocol:** MCP (Model Context Protocol)
- **LLM Provider:** Local Ollama (Gemma2 / Llama3.1)
- **Testing:** Jest
- **Observability:** Langfuse

## 📋 Standard Operating Procedures (SOPs)

### 1. Workflow & Git
- The User will handle merging PRs into the `main` branch.
- When generating large features, always propose creating a feature branch first (e.g., `git checkout -b feat/mcp-server`).
- After completing a task from the `feature_map.md`, update the `feature_map.md` file by checking the box `[x]`.

### 2. Coding Standards
- **Strict TypeScript:** Always use strict typing. Avoid `any`.
- **Modularity:** Separate database logic, MCP server logic, and LangGraph logic into different files/folders.
- **Testing:** When writing a new MCP tool or LangGraph node, write a Jest test for it. The CI pipeline will fail if tests are missing.

### 3. Using Local LLMs (Ollama)
- When writing the LangGraph code, assume the LLM is running locally via Ollama on port `11434`. 
- Use `@langchain/community/chat_models/ollama` (or `@langchain/ollama`).
- Since smaller models might struggle with tool-calling formats, ensure prompts are extremely clear and consider using structured output parsing.

### 4. Running Commands
- Always verify if a command succeeded before moving to the next step.
- Do not run destructive commands without the User's approval.

## 🚀 Mission Context
We are building a portfolio piece for an **AI Engineer / AI Agent Developer** role. The code must look enterprise-grade (clean architecture, Dockerized, tested, observable).

### 5. Multi-Agent Workflow
- **Subagent Delegation:** The main agent (Antigravity) acts as the project manager and orchestrator. Complex tasks (writing features, complex debugging) must be delegated to specialized subagents.
- **Small PRs & GH CLI:** Keep Pull Requests small and focused to make them easily reviewable by the User. Use the `gh` CLI to create PRs (`gh pr create`).
- **Makefile:** Maintain a `Makefile` at the root of the project to encapsulate common operational commands (e.g., `make up` for Docker, `make db-seed`, `make test-e2e`).
- **E2E Feature Tests (Evals):** Every major feature must include E2E tests / evaluations to prove it works before it is merged.
- **PR Template:** Always use the `.github/PULL_REQUEST_TEMPLATE.md` to ensure standardized PR descriptions.

### 6. Automated PR Monitoring Workflow
- **PR Creation:** After creating a PR, the main agent should immediately spawn a `pr_fixer` subagent (using `invoke_subagent` and `gh pr checks --watch`).
- **PR Fixer Subagent Role:** The `pr_fixer` subagent will monitor the CI pipeline and PR review comments. If the CI fails or the user leaves review comments, the subagent will automatically checkout the PR branch, fix the code, commit, push, and resume monitoring. It reports success back to the main agent once the PR is entirely green and ready to merge.
- **Agent Parallelism:** While the `pr_fixer` is monitoring and fixing a PR, the main agent can immediately proceed to the next Epic or task without waiting.
