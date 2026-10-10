import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetPolicyTool } from "./tools/get_policy";
import { registerCheckCoverageTool } from "./tools/check_coverage";
import { registerFlagReviewTool } from "./tools/flag_review";

export const MCP_SERVER_NAME = "InsuranceClaimMCP";
export const MCP_SERVER_VERSION = "1.0.0";

/**
 * Builds a fresh MCP server with every tool registered, without connecting a transport.
 *
 * An McpServer can only be connected to one transport, so each caller gets its own
 * instance: the stdio entry point below, and the agent's in-process client
 * (src/agent/mcp_client.ts), which links one over an in-memory transport.
 */
export function createMcpServer(): McpServer {
    const server = new McpServer({
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
    });

    registerGetPolicyTool(server);
    registerCheckCoverageTool(server);
    registerFlagReviewTool(server);

    return server;
}

/** Serves the MCP tools over stdio (external MCP clients, and the agent when MCP_TRANSPORT=stdio). */
export async function runServer(): Promise<void> {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Exit once the client goes away (stdin ended) instead of lingering as an orphan
    // process that still holds a database pool.
    process.stdin.on("end", () => {
        server.close().finally(() => process.exit(0));
    });
    console.error("Insurance Claim MCP Server running on stdio");
}

// Ensure the server can be run if executed directly
if (require.main === module) {
    runServer().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
