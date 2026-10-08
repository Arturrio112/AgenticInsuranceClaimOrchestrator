import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query } from "../../db/client.js";

export function registerGetPolicyTool(server: McpServer) {
  server.tool(
    "get_policy",
    "Get insurance policy details by policy number",
    {
      policy_number: z.string().describe("The policy number to look up"),
    },
    async ({ policy_number }) => {
      const result = await query(
        "SELECT id, user_id, policy_number, status, type, created_at FROM policies WHERE policy_number = $1",
        [policy_number]
      );
      if (result.rows.length === 0) {
        return {
          content: [{ type: "text", text: "Policy not found." }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows[0], null, 2) }],
      };
    }
  );
}
