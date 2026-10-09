import request from 'supertest';
import { app } from '../../api/webhook';
import { query, pool } from '../../db/client';
import { createTables, AuditLog } from '../../db/schema';
import { signToken } from '../../auth/jwt';

// Mock the LLM node: first call asks for flag_review, second call returns a summary.
jest.mock('../../agent/nodes/llm_node', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AIMessage } = require('@langchain/core/messages');
    let callCount = 0;

    return {
        llmNode: jest.fn().mockImplementation(async (state: { claim_id?: number }) => {
            callCount++;
            if (callCount === 1) {
                return {
                    messages: [new AIMessage({
                        content: '',
                        tool_calls: [{
                            name: 'flag_review',
                            args: { claim_id: state.claim_id || 1, reason: 'Audit trail e2e check' },
                            id: 'call_audit_1',
                        }],
                    })],
                };
            }
            return { messages: [new AIMessage('Investigation complete. The claim was flagged for review.')] };
        }),
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
        await pool.end();
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

        const toolEnd = rows.find((row) => row.event_type === 'tool_end');
        expect(toolEnd).toBeDefined();
        expect(toolEnd?.node_name).toBe('tools');
        expect(toolEnd?.payload).toMatchObject({ tool_name: 'flag_review' });
        expect(JSON.stringify(toolEnd?.payload)).toContain('Successfully flagged claim 1');

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
        expect(entries[0]).toMatchObject({ claim_id: 1, step_index: 0, event_type: 'node_start', node_name: 'agent' });
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
