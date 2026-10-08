# Agentic Insurance Claim Orchestrator

An AI-driven insurance claim resolution system powered by LangGraph, MCP (Model Context Protocol), and PostgreSQL.

## Features
- Fully automated claim triage and resolution using local LLMs (Ollama).
- Immutable PostgreSQL database exposed via standard MCP tools.
- JWT-secured Webhook API and simple Web UI for claim submission.
- Comprehensive Observability with Langfuse tracing.

## Future Improvements
- **Duplication Triage:** Automatically detect and triage duplicate claims (using vector similarity or SQL) to prevent double payouts.
- **Fraud Scoring:** Analyze claims for potential fraud using ML heuristics or 3rd-party risk assessment APIs before auto-approving them.
