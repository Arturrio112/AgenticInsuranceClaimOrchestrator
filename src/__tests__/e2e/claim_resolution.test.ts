import request from 'supertest';
import { BaseMessage } from '@langchain/core/messages';
import { app } from '../../api/webhook';
import { ClaimListResponse, ClaimResolutionResponse, ClaimSummary } from '../../api/types';
import { query, closePool } from '../../db/client';
import { createTables } from '../../db/schema';
import { signToken } from '../../auth/jwt';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getChatModel } from '../../agent/model';
import { closeMcpClient } from '../../agent/mcp_client';

/**
 * Structured decision the fake model returns for the current test.
 * (Variables referenced inside jest.mock factories must be prefixed with `mock`.)
 */
let mockDecision: unknown = null;

/**
 * Replace only the LLM provider. Every graph node (load_claim, agent, tools,
 * decide, persist) runs for real against Postgres, and the tools node reaches
 * Postgres through the project's MCP server (default in-memory transport).
 *  - Agent model: first turn calls get_policy + check_coverage, then summarises.
 *  - Structured-output model: returns `mockDecision`.
 */
jest.mock('../../agent/model', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AIMessage, ToolMessage } = require('@langchain/core/messages');

    const agentModel = {
        invoke: jest.fn(async (messages: BaseMessage[]) => {
            const hasToolResults = messages.some((m) => ToolMessage.isInstance(m));
            if (!hasToolResults) {
                return new AIMessage({
                    content: '',
                    tool_calls: [
                        { name: 'get_policy', args: { policy_number: 'POL-TEST-001' }, id: 'call_policy' },
                        { name: 'check_coverage', args: { policy_type: 'auto', damage_type: 'collision' }, id: 'call_coverage' },
                    ],
                });
            }
            return new AIMessage('Investigation complete. Policy POL-TEST-001 is active and collision is covered.');
        }),
    };

    const decisionModel = { invoke: jest.fn(async () => mockDecision) };

    const chatModel = {
        bindTools: jest.fn(() => agentModel),
        withStructuredOutput: jest.fn(() => decisionModel),
    };

    return {
        createChatModel: jest.fn(() => chatModel),
        getChatModel: jest.fn(() => chatModel),
    };
});

function postClaim(claimId: number) {
    // Signed with JWT_SECRET from the environment (no fallback secret).
    const token = signToken({ sub: 'test_user' });
    return request(app)
        .post('/claim')
        .set('Authorization', `Bearer ${token}`)
        .send({ claim_id: claimId });
}

describe('E2E Eval Testing: Claim Resolution Workflow', () => {
    const originalThreshold = process.env.CONFIDENCE_THRESHOLD;
    const callTool = jest.spyOn(Client.prototype, 'callTool');

    beforeAll(async () => {
        process.env.CONFIDENCE_THRESHOLD = '70';
        await query(createTables);
        await query('TRUNCATE TABLE audit_logs, claims, coverage_rules, policies RESTART IDENTITY CASCADE;');

        await query(`
            INSERT INTO policies (user_id, policy_number, status, type) VALUES
            ('test_user', 'POL-TEST-001', 'active', 'auto');
        `);
        await query(`
            INSERT INTO coverage_rules (policy_type, damage_type, max_coverage_amount, conditions) VALUES
            ('auto', 'collision', 50000.00, 'Requires police report if over $1000');
        `);
        await query(`
            INSERT INTO claims (id, policy_id, claim_amount, damage_type, status, description) VALUES
            (1, 1, 1500.00, 'collision', 'pending', 'Fender bender in parking lot'),
            (2, 1, 49000.00, 'collision', 'pending', 'Total loss, no police report attached')
        `);
    });

    afterAll(async () => {
        if (originalThreshold === undefined) delete process.env.CONFIDENCE_THRESHOLD;
        else process.env.CONFIDENCE_THRESHOLD = originalThreshold;
        await closeMcpClient();
        await closePool();
    });

    it('applies a high-confidence decision and stores verified citations', async () => {
        mockDecision = {
            decision: 'approve',
            reasoning: 'Policy POL-TEST-001 is active and the 1500 collision claim is within the 50000 limit.',
            confidence_score: 92,
            // 999 is not returned by any tool and must be dropped
            citations: { policy_id: 1, policy_number: 'POL-TEST-001', coverage_rule_ids: [1, 999] },
        };

        const response = await postClaim(1).expect(200);
        const body = response.body as ClaimResolutionResponse;

        expect(body).toEqual({
            claim_id: 1,
            status: 'approved',
            confidence_threshold: 70,
            decision: {
                decision: 'approve',
                reasoning: expect.stringContaining('within the 50000 limit'),
                confidence_score: 92,
                citations: { policy_id: 1, policy_number: 'POL-TEST-001', coverage_rule_ids: [1] },
                fallback: false,
            },
            summary: expect.stringContaining('Investigation complete'),
            // The claim as persisted (status already updated)
            claim: {
                id: 1,
                policy_number: 'POL-TEST-001',
                policy_type: 'auto',
                claim_amount: 1500,
                damage_type: 'collision',
                status: 'approved',
                description: 'Fender bender in parking lot',
                created_at: expect.any(String),
            },
            // Citations resolved to full DB rows; the invented rule 999 is absent
            sources: {
                policy: { id: 1, policy_number: 'POL-TEST-001', status: 'active', type: 'auto' },
                coverage_rules: [
                    {
                        id: 1,
                        policy_type: 'auto',
                        damage_type: 'collision',
                        max_coverage_amount: 50000,
                        conditions: 'Requires police report if over $1000',
                    },
                ],
            },
        });
        expect(new Date(body.claim.created_at).toISOString()).toBe(body.claim.created_at);

        const { rows } = await query(
            'SELECT status, ai_decision, decision_reasoning, confidence_score, cited_policy_id, cited_rule_ids, decided_at FROM claims WHERE id = 1'
        );
        expect(rows[0]).toMatchObject({
            status: 'approved',
            ai_decision: 'approve',
            confidence_score: 92,
            cited_policy_id: 1,
            cited_rule_ids: [1],
        });
        expect(rows[0].decision_reasoning).toContain('within the 50000 limit');
        expect(rows[0].decided_at).toBeInstanceOf(Date);
    });

    it('investigates through the MCP server: only the read-only MCP tools are bound and called', async () => {
        const bindTools = (getChatModel() as unknown as { bindTools: jest.Mock }).bindTools;
        const boundTools = bindTools.mock.calls[0][0] as { name: string; metadata?: Record<string, unknown> }[];
        expect(boundTools.map((tool) => tool.name)).toEqual(['get_policy', 'check_coverage']);
        for (const tool of boundTools) {
            expect(tool.metadata).toMatchObject({ mcp_server: 'InsuranceClaimMCP', mcp_transport: 'inmemory' });
        }

        // The first claim run issued both tool calls as MCP tools/call requests.
        const calls = callTool.mock.calls.map(([params]) => [params.name, params.arguments]);
        expect(calls).toEqual(expect.arrayContaining([
            ['get_policy', { policy_number: 'POL-TEST-001' }],
            ['check_coverage', { policy_type: 'auto', damage_type: 'collision' }],
        ]));
        expect(calls.map(([name]) => name)).not.toContain('flag_review');
    });

    it('routes a low-confidence decision to needs_human_review', async () => {
        mockDecision = {
            decision: 'approve',
            reasoning: 'Amount is within coverage but the required police report is missing.',
            confidence_score: 45,
            citations: { policy_id: 1, policy_number: 'POL-TEST-001', coverage_rule_ids: [1] },
        };

        const response = await postClaim(2).expect(200);
        const body = response.body as ClaimResolutionResponse;

        expect(body.status).toBe('needs_human_review');
        expect(body.claim.status).toBe('needs_human_review');
        expect(body.decision.decision).toBe('approve');
        expect(body.decision.confidence_score).toBe(45);
        expect(body.confidence_threshold).toBe(70);

        const { rows } = await query('SELECT status, ai_decision, confidence_score FROM claims WHERE id = 2');
        expect(rows[0]).toEqual({ status: 'needs_human_review', ai_decision: 'approve', confidence_score: 45 });
    });

    it('falls back to human review when the model returns malformed output', async () => {
        mockDecision = { decision: 'definitely', confidence_score: 'high' };

        const response = await postClaim(2).expect(200);
        const body = response.body as ClaimResolutionResponse;

        expect(body.status).toBe('needs_human_review');
        expect(body.decision).toMatchObject({ decision: 'flag', confidence_score: 0, fallback: true });
        // The fallback cites nothing, so there is nothing to resolve
        expect(body.sources).toEqual({ policy: null, coverage_rules: [] });
    });

    it('lists claims and fetches a single claim with the persisted status', async () => {
        const token = signToken({ sub: 'test_user' });

        const list = await request(app).get('/claims').set('Authorization', `Bearer ${token}`).expect(200);
        const claims = (list.body as ClaimListResponse).claims;
        expect(claims.map((c) => [c.id, c.status, c.claim_amount])).toEqual([
            [1, 'approved', 1500],
            [2, 'needs_human_review', 49000],
        ]);

        const single = await request(app).get('/claims/1').set('Authorization', `Bearer ${token}`).expect(200);
        expect(single.body as ClaimSummary).toEqual(claims[0]);

        await request(app).get('/claims/12345').set('Authorization', `Bearer ${token}`).expect(404);
    });

    it('returns 404 for an unknown claim', async () => {
        const response = await postClaim(12345).expect(404);
        expect(response.body.error).toBe('Claim 12345 not found');
    });

    it('should reject requests without a valid Bearer token', async () => {
        const response = await request(app)
            .post('/claim')
            .send({ claim_id: 1 })
            .expect(401);

        expect(response.body.error).toBe('Missing or invalid Bearer token');
    });
});
