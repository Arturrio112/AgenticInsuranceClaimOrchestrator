import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFlagReviewTool } from '../../mcp/tools/flag_review';
import { query } from '../../db/client';

jest.mock('../../db/client', () => ({
    query: jest.fn()
}));

describe('flag_review tool', () => {
    let server: McpServer;

    beforeEach(() => {
        server = {
            tool: jest.fn()
        } as unknown as McpServer;
        jest.clearAllMocks();
    });

    it('should register the flag_review tool and handle successful execution', async () => {
        registerFlagReviewTool(server);

        expect(server.tool).toHaveBeenCalledWith(
            'flag_review',
            expect.any(String),
            expect.any(Object),
            expect.any(Function)
        );

        const toolHandler = (server.tool as jest.Mock).mock.calls[0][3];

        (query as jest.Mock).mockResolvedValueOnce({ rows: [{ description: 'Original desc' }] });
        (query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

        const result = await toolHandler({ claim_id: 1, reason: 'Suspected fraud' }, {});

        expect(query).toHaveBeenNthCalledWith(1, 'SELECT description FROM claims WHERE id = $1', [1]);
        expect(query).toHaveBeenNthCalledWith(2, 'UPDATE claims SET status = $1, description = $2 WHERE id = $3', ['flagged', 'Original desc\nFlagged: Suspected fraud', 1]);
        
        expect(result).toEqual({
            content: [{ type: 'text', text: 'Successfully flagged claim 1 for review.' }]
        });
    });

    it('should handle claim not found', async () => {
        registerFlagReviewTool(server);
        const toolHandler = (server.tool as jest.Mock).mock.calls[0][3];

        (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

        const result = await toolHandler({ claim_id: 2, reason: 'Invalid' }, {});

        expect(query).toHaveBeenCalledWith('SELECT description FROM claims WHERE id = $1', [2]);
        expect(result).toEqual({
            content: [{ type: 'text', text: 'Failed to flag claim: Claim with ID 2 not found.' }]
        });
    });

    it('should return error message if query fails', async () => {
        registerFlagReviewTool(server);
        const toolHandler = (server.tool as jest.Mock).mock.calls[0][3];

        (query as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

        const result = await toolHandler({ claim_id: 3, reason: 'Error case' }, {});

        expect(result).toEqual({
            content: [{ type: 'text', text: 'Error flagging claim: Database error' }]
        });
    });
});
