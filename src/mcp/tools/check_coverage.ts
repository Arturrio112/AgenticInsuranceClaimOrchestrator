import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../../db/client';

export function registerCheckCoverageTool(server: McpServer) {
    server.tool(
        'check_coverage',
        'Check coverage rules for a given policy type and damage type',
        {
            policy_type: z.string().describe('The type of policy (e.g., auto, home)'),
            damage_type: z.string().describe('The type of damage (e.g., collision, water)')
        },
        async ({ policy_type, damage_type }) => {
            const sql = 'SELECT id, policy_type, damage_type, max_coverage_amount, conditions, created_at FROM coverage_rules WHERE policy_type = $1 AND damage_type = $2';
            const result = await query(sql, [policy_type, damage_type]);

            if (result.rows.length === 0) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'No coverage rule found' }) }]
                };
            }

            return {
                content: [{ type: 'text', text: JSON.stringify(result.rows[0]) }]
            };
        }
    );
}
