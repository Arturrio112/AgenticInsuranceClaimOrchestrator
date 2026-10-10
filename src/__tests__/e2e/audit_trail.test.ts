import request from 'supertest';
import { BaseMessage } from '@langchain/core/messages';
import { app } from '../../api/webhook';
import { query, closePool } from '../../db/client';
import { createTables, AuditLog } from '../../db/schema';
import { signToken } from '../../auth/jwt';
import { closeMcpClient } from '../../agent/mcp_client';

/**
 * Replace only the LLM provider; every graph node (load_claim, agent, tools, decide, persist)
 * runs for real so the audit trail reflects the production graph. Tool calls go through
 * the project's MCP server to Postgres.
 *  - Agent model: first turn calls get_policy, then summarises.
 *  - Structured-output model: returns a fixed flag decision.
 */
jest.mock('../../agent/model', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AIMessage, ToolMessage } = require('@langchain/core/messages');

    const agentModel = {
        invoke: jest.fn(async (messages: BaseMessage[]) => {
            if (!messages.some((m) => ToolMessage.isInstance(m))) {
                return new AIMessage({
                    content: '',
                    tool_calls: [{ name: 'get_policy', args: { policy_number: 'POL-TEST-001' }, id: 'call_audit_1' }],
                });
            }
            return new AIMessage('Investigation complete. The claim amount exceeds typical limits.');
        }),
    };
    const decisionModel = {
        invoke: jest.fn(async () => ({
            decision: 'flag',
            reasoning: 'Claim amount 500000 is unusually high for policy POL-TEST-001.',
            confidence_score: 85,
            citations: { policy_id: 1, policy_number: 'POL-TEST-001', coverage_rule_ids: [] },
        })),
    };
    const chatModel = {
        bindTools: jest.fn(() => agentModel),
        withStructuredOutput: jest.fn(() => decisionModel),
    };

    return {
        createChatModel: jest.fn(() => chatModel),
        getChatModel: jest.fn(() => chatModel),
    };
});

describe('E2E: Audit trail for claim processing', () => {
    // Signed with JWT_SECRET from the environment (no fallback secret).
    const token = signToken({ sub: 'test_user' });

    beforeAll(async () => {
        // Running the schema twice proves it is re-runnable (CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
        await query(createTables);
        await query(createTables);
        // TRUNCATE does not fire the row-level append-only trigger, so resetting test data still works.
        await query('TRUNCATE TABLE audit_logs, claims, coverage_rules, policies RESTART IDENTITY CASCADE;');
        await query(`
            INSERT INTO policies (user_id, policy_number, status, type) VALUES
            ('test_user', 'POL-TEST-001', 'active', 'auto');
        `);
        await query(`
            INSERT INTO claims (id, policy_id, claim_amount, damage_type, status, description) VALUES
            (1, 1, 500000.00, 'collision', 'pending', 'Test collision claim')
        `);
    });

    afterAll(async () => {
        await closeMcpClient();
        await closePool();
    });

    it('writes the execution trace to audit_logs before /claim responds', async () => {
        await request(app)
            .post('/claim')
            .set('Authorization', `Bearer ${token}`)
            .send({ claim_id: 1 })
            .expect(200);

        const result = await query(
            'SELECT event_type, node_name, step_index, payload FROM audit_logs WHERE claim_id = 1 ORDER BY step_index'
        );
        const rows = result.rows as Pick<AuditLog, 'event_type' | 'node_name' | 'step_index' | 'payload'>[];
        const events = rows.map((row) => row.event_type);

        expect(events).toContain('node_start');
        expect(events).toContain('node_end');
        expect(events).toContain('tool_start');

        // The tool call was served by the MCP server, not by in-process tool code.
        const mcpOrigin = { mcp_server: 'InsuranceClaimMCP', mcp_transport: 'inmemory' };
        const toolStart = rows.find((row) => row.event_type === 'tool_start');
        expect(toolStart?.payload).toMatchObject({ tool_name: 'get_policy', ...mcpOrigin });

        const toolEnd = rows.find((row) => row.event_type === 'tool_end');
        expect(toolEnd).toBeDefined();
        expect(toolEnd?.node_name).toBe('tools');
        expect(toolEnd?.payload).toMatchObject({ tool_name: 'get_policy', ...mcpOrigin });
        // The output is the MCP get_policy result: the policy row read from Postgres.
        const output = (toolEnd?.payload as { output: { type: string; name: string; content: string } }).output;
        expect(output).toMatchObject({ type: 'tool', name: 'get_policy' });
        expect(JSON.parse(output.content)).toMatchObject({ id: 1, policy_number: 'POL-TEST-001', status: 'active', type: 'auto' });

        // Every node of the decision graph shows up in the trace, in execution order.
        const nodeStarts = rows.filter((row) => row.event_type === 'node_start').map((row) => row.node_name);
        expect(nodeStarts).toEqual(['load_claim', 'agent', 'tools', 'agent', 'decide', 'persist']);

        // Steps form a gapless sequence starting at 0.
        expect(rows.map((row) => row.step_index)).toEqual(rows.map((_, index) => index));
    });

    it('GET /claims/:id/audit returns the ordered audit entries', async () => {
        const response = await request(app)
            .get('/claims/1/audit')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(response.body.claim_id).toBe(1);
        const entries = response.body.entries as AuditLog[];
        expect(response.body.count).toBe(entries.length);
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0]).toMatchObject({ claim_id: 1, step_index: 0, event_type: 'node_start', node_name: 'load_claim' });
        expect(entries.map((entry) => entry.step_index)).toEqual(entries.map((_, index) => index));
        expect(entries.some((entry) => entry.event_type === 'tool_end' && entry.node_name === 'tools')).toBe(true);
    });

    it('GET /claims/:id/audit requires a valid Bearer token', async () => {
        await request(app).get('/claims/1/audit').expect(401);
    });

    it('GET /claims/:id/audit rejects a non-numeric id', async () => {
        await request(app)
            .get('/claims/abc/audit')
            .set('Authorization', `Bearer ${token}`)
            .expect(400);
    });

    it('rejects UPDATE and DELETE on audit_logs (append-only)', async () => {
        await expect(query("UPDATE audit_logs SET event_type = 'tampered' WHERE claim_id = 1"))
            .rejects.toThrow(/append-only/);
        await expect(query('DELETE FROM audit_logs WHERE claim_id = 1'))
            .rejects.toThrow(/append-only/);

        const result = await query("SELECT COUNT(*)::int AS tampered FROM audit_logs WHERE event_type = 'tampered'");
        expect(result.rows[0].tampered).toBe(0);
    });
});
