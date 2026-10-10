import { StructuredToolInterface } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

/**
 * Executes the tool calls requested by the agent.
 *
 * The tools are not implemented here: they are the MCP server's tools, loaded through
 * the agent's MCP client (src/agent/mcp_client.ts), so the investigation reaches
 * Postgres only via src/mcp/tools/.
 *
 * Note: flag_review is intentionally not bound to the agent (the MCP client's
 * allow-list keeps it out). Claim status is written exclusively by the `persist` node
 * from the structured decision, so the investigation loop stays read-only. The MCP
 * flag_review tool remains available to external MCP clients (src/mcp/tools/flag_review.ts).
 */
export function createToolNode(tools: StructuredToolInterface[]): ToolNode {
    return new ToolNode(tools);
}
