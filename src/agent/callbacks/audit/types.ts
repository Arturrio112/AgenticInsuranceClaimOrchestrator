/** Raw event data before it is made JSON-safe. */
export type AuditPayload = Record<string, unknown>;

/** Metadata LangChain passes to callbacks; LangGraph adds `langgraph_node`. */
export type CallbackMetadata = Record<string, unknown> | undefined;

/** MCP server a tool is served by (set by the agent's MCP client as tool metadata). */
export interface McpOrigin {
    mcp_server: string;
    mcp_transport: string | null;
}

/** Graph node and tool name an in-flight LLM/tool run belongs to. */
export interface RunContext {
    node: string | null;
    toolName: string;
    /** Present when the tool call went through the MCP server. */
    mcp?: McpOrigin;
}
