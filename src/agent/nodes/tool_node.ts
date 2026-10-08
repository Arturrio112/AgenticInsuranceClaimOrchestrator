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

const flagReviewTool = tool(
    async ({ claim_id, reason }) => {
        try {
            const getResult = await query('SELECT description FROM claims WHERE id = $1', [claim_id]);
            if (getResult.rows.length === 0) return `Claim with ID ${claim_id} not found.`;

            const currentDescription = getResult.rows[0].description || '';
            const newDescription = currentDescription ? `${currentDescription}\nFlagged: ${reason}` : `Flagged: ${reason}`;

            await query(
                'UPDATE claims SET status = $1, description = $2 WHERE id = $3',
                ['flagged', newDescription, claim_id]
            );
            return `Successfully flagged claim ${claim_id} for review.`;
        } catch (error) {
            return `Error flagging claim: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
    {
        name: "flag_review",
        description: "Flag a claim for review and append a reason to its description",
        schema: z.object({
            claim_id: z.number().describe("The ID of the claim to flag"),
            reason: z.string().describe("The reason for flagging the claim for review"),
        }),
    }
);

export const tools = [getPolicyTool, checkCoverageTool, flagReviewTool];
export const toolNode = new ToolNode(tools);
