import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { query } from "../../db/client";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const getPolicyTool = tool(
    async ({ policy_number }) => {
        const result = await query(
            "SELECT id, user_id, policy_number, status, type, created_at FROM policies WHERE policy_number = $1",
            [policy_number]
        );
        if (result.rows.length === 0) return "Policy not found.";
        return JSON.stringify(result.rows[0]);
    },
    {
        name: "get_policy",
        description: "Get insurance policy details by policy number",
        schema: z.object({
            policy_number: z.string().describe("The policy number to look up"),
        }),
    }
);

const checkCoverageTool = tool(
    async ({ policy_type, damage_type }) => {
        const sql = 'SELECT id, policy_type, damage_type, max_coverage_amount, conditions, created_at FROM coverage_rules WHERE policy_type = $1 AND damage_type = $2';
        const result = await query(sql, [policy_type, damage_type]);
        if (result.rows.length === 0) return JSON.stringify({ error: 'No coverage rule found' });
        return JSON.stringify(result.rows[0]);
    },
    {
        name: "check_coverage",
        description: "Check coverage rules for a given policy type and damage type",
        schema: z.object({
            policy_type: z.string().describe("The type of policy (e.g., auto, home)"),
            damage_type: z.string().describe("The type of damage (e.g., collision, water)"),
        }),
    }
);

// Note: flag_review is intentionally not bound to the agent. Claim status is now
// written exclusively by the `persist` node from the structured decision, so the
// investigation loop stays read-only. The MCP flag_review tool remains available
// to external MCP clients (src/mcp/tools/flag_review.ts).
export const tools = [getPolicyTool, checkCoverageTool];
export const toolNode = new ToolNode(tools);
