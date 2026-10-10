/* eslint-disable */
// Minimal stdio MCP server used by src/__tests__/agent/mcp_client.test.ts to exercise the
// agent's stdio transport without a build step or a database. It offers the same tool
// names as src/mcp/server.ts and echoes FIXTURE_MARKER to prove the child inherits the env.
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const server = new McpServer({ name: "InsuranceClaimMCP", version: "0.0.0-fixture" });
const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

server.tool("get_policy", "fixture", { policy_number: z.string() }, async ({ policy_number }) =>
    text({ id: 7, policy_number, marker: process.env.FIXTURE_MARKER ?? null })
);
server.tool("check_coverage", "fixture", { policy_type: z.string(), damage_type: z.string() }, async () =>
    text({ id: 3 })
);
server.tool("flag_review", "fixture", { claim_id: z.number(), reason: z.string() }, async () =>
    text({ flagged: true })
);

server.connect(new StdioServerTransport()).catch((error) => {
    console.error(error);
    process.exit(1);
});
process.stdin.on("end", () => process.exit(0));
