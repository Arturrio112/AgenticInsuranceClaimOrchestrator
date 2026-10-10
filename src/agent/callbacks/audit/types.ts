/** Raw event data before it is made JSON-safe. */
export type AuditPayload = Record<string, unknown>;

/** Metadata LangChain passes to callbacks; LangGraph adds `langgraph_node`. */
export type CallbackMetadata = Record<string, unknown> | undefined;

/** Graph node and tool name an in-flight LLM/tool run belongs to. */
export interface RunContext {
    node: string | null;
    toolName: string;
}
