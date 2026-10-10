import path from 'path';
import { existsSync } from 'fs';
import { ToolMessage } from '@langchain/core/messages';
import { connectMcp, loadAgentTools, McpConnection } from '../../agent/mcp_client';
import { query, pool } from '../../db/client';
import { createTables } from '../../db/schema';

/**
 * MCP_TRANSPORT=stdio against the compiled server: the agent's client spawns
 * dist/mcp/server.js as a child process, which reads Postgres with the inherited env.
 * Requires `npm run build` first (CI and `make test-e2e` build before the E2E suite).
 */
const SERVER_PATH = path.resolve(__dirname, '../../../dist/mcp/server.js');

describe('E2E: agent tools over the stdio MCP transport', () => {
    let connection: McpConnection;

    beforeAll(async () => {
        if (!existsSync(SERVER_PATH)) {
            throw new Error(`Compiled MCP server not found at ${SERVER_PATH}. Run "npm run build" first.`);
        }
        await query(createTables);
        await query('TRUNCATE TABLE audit_logs, claims, coverage_rules, policies RESTART IDENTITY CASCADE;');
        await query(`
            INSERT INTO policies (user_id, policy_number, status, type) VALUES
            ('test_user', 'POL-STDIO-001', 'active', 'home');
        `);
        await query(`
            INSERT INTO coverage_rules (policy_type, damage_type, max_coverage_amount, conditions) VALUES
            ('home', 'water_damage', 20000.00, 'Excludes gradual leaks');
        `);
        connection = await connectMcp('stdio', { ...process.env, MCP_SERVER_PATH: SERVER_PATH });
    });

    afterAll(async () => {
        await connection?.close();
        await pool.end();
    });

    async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
        const tool = (await loadAgentTools(connection)).find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`Tool ${name} not bound`);
        const message: unknown = await tool.invoke({ type: 'tool_call', id: `call_${name}`, name, args });
        if (!ToolMessage.isInstance(message)) throw new Error('Expected a ToolMessage');
        return JSON.parse(message.content as string);
    }

    it('binds only the read-only tools from the spawned server', async () => {
        const tools = await loadAgentTools(connection);
        expect(tools.map((tool) => tool.name)).toEqual(['get_policy', 'check_coverage']);
        expect(tools[0].metadata).toMatchObject({ mcp_server: 'InsuranceClaimMCP', mcp_transport: 'stdio' });
    });

    it('reads policies and coverage rules from Postgres through the child process', async () => {
        await expect(call('get_policy', { policy_number: 'POL-STDIO-001' })).resolves.toMatchObject({
            id: 1,
            policy_number: 'POL-STDIO-001',
            status: 'active',
            type: 'home',
        });
        await expect(call('check_coverage', { policy_type: 'home', damage_type: 'water_damage' })).resolves.toMatchObject({
            id: 1,
            max_coverage_amount: '20000.00',
        });
    });
});
