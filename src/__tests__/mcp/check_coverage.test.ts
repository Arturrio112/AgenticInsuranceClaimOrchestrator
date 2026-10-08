import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCheckCoverageTool } from '../../mcp/tools/check_coverage';
import { query } from '../../db/client';

jest.mock('../../db/client', () => ({
    query: jest.fn()
}));

describe('check_coverage tool', () => {
    let server: McpServer;

    beforeEach(() => {
        jest.clearAllMocks();
        
        server = {
            tool: jest.fn()
        } as unknown as McpServer;
    });

    it('should register the check_coverage tool', () => {
        registerCheckCoverageTool(server);
        expect(server.tool).toHaveBeenCalledWith(
            'check_coverage',
            expect.any(String),
            expect.any(Object),
            expect.any(Function)
        );
    });

    it('should execute the tool and return coverage rules', async () => {
        registerCheckCoverageTool(server);

        const toolHandler = (server.tool as jest.Mock).mock.calls[0][3];

        const mockRow = {
            id: 1,
            policy_type: 'auto',
            damage_type: 'collision',
            max_coverage_amount: 5000,
            conditions: 'none',
            created_at: new Date()
        };
        (query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

        const result = await toolHandler({ policy_type: 'auto', damage_type: 'collision' });

        expect(query).toHaveBeenCalledWith(
            'SELECT id, policy_type, damage_type, max_coverage_amount, conditions, created_at FROM coverage_rules WHERE policy_type = $1 AND damage_type = $2',
            ['auto', 'collision']
        );
        expect(result.content[0].text).toEqual(JSON.stringify(mockRow));
    });

    it('should return error if no rule is found', async () => {
        registerCheckCoverageTool(server);

        const toolHandler = (server.tool as jest.Mock).mock.calls[0][3];

        (query as jest.Mock).mockResolvedValue({ rows: [] });

        const result = await toolHandler({ policy_type: 'auto', damage_type: 'scratch' });

        expect(query).toHaveBeenCalledWith(
            'SELECT id, policy_type, damage_type, max_coverage_amount, conditions, created_at FROM coverage_rules WHERE policy_type = $1 AND damage_type = $2',
            ['auto', 'scratch']
        );
        expect(result.content[0].text).toEqual(JSON.stringify({ error: 'No coverage rule found' }));
    });
});
