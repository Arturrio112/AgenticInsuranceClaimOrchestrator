import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../../db/client';

export function registerFlagReviewTool(server: McpServer) {
    server.tool(
        'flag_review',
        'Flag a claim for review and append a reason to its description',
        {
            claim_id: z.number().describe('The ID of the claim to flag'),
            reason: z.string().describe('The reason for flagging the claim for review')
        },
        async ({ claim_id, reason }) => {
            try {
                // Fetch the current description
                const getResult = await query('SELECT description FROM claims WHERE id = $1', [claim_id]);
                if (getResult.rows.length === 0) {
                    return {
                        content: [{ type: 'text', text: `Failed to flag claim: Claim with ID ${claim_id} not found.` }]
                    };
                }

                const currentDescription = getResult.rows[0].description || '';
                const newDescription = currentDescription ? `${currentDescription}\nFlagged: ${reason}` : `Flagged: ${reason}`;

                await query(
                    'UPDATE claims SET status = $1, description = $2 WHERE id = $3',
                    ['flagged', newDescription, claim_id]
                );
                
                return {
                    content: [{ type: 'text', text: `Successfully flagged claim ${claim_id} for review.` }]
                };
            } catch (error) {
                return {
                    content: [{ type: 'text', text: `Error flagging claim: ${error instanceof Error ? error.message : String(error)}` }]
                };
            }
        }
    );
}
