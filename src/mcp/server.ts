import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetPolicyTool } from "./tools/get_policy.js";
import { registerCheckCoverageTool } from "./tools/check_coverage.js";
import { registerFlagReviewTool } from "./tools/flag_review.js";

// Core MCP setup
export const server = new McpServer({
    name: "InsuranceClaimMCP",
    version: "1.0.0"
});

// Register tools
registerGetPolicyTool(server);
registerCheckCoverageTool(server);
registerFlagReviewTool(server);

export async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Insurance Claim MCP Server running on stdio");
}

// Ensure the server can be run if executed directly
if (require.main === module) {
    runServer().catch(console.error);
}
