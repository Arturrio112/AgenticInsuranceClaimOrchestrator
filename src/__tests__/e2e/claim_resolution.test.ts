import request from 'supertest';
import { app } from '../../api/webhook';
import { query, pool } from '../../db/client';
import { createTables } from '../../db/schema';

// We mock the LLM node to simulate an AI agent deciding to flag the claim
jest.mock('../../agent/nodes/llm_node', () => {
    const { AIMessage } = require('@langchain/core/messages');
    let callCount = 0;
    
    return {
        llmNode: jest.fn().mockImplementation(async (state: any) => {
            callCount++;
            const claimId = state.claim_id || 1;
            
            if (callCount === 1) {
                // First invocation: the LLM decides to call the flag_review tool
                const msg = new AIMessage({
                    content: "",
                    tool_calls: [{
                        name: "flag_review",
                        args: { claim_id: claimId, reason: "Amount suspiciously high for this policy" },
                        id: "call_123"
                    }]
                });
                return { messages: [msg] };
            } else {
                // Second invocation: the LLM provides its final summary after the tool execution
                const msg = new AIMessage("Investigation complete. The claim was flagged for review.");
                return { messages: [msg] };
            }
        })
    };
});

describe('E2E Eval Testing: Claim Resolution Workflow', () => {
    beforeAll(async () => {
        // Seed database with necessary test data
        await query(createTables);
        await query('TRUNCATE TABLE claims, coverage_rules, policies RESTART IDENTITY CASCADE;');
        
        await query(`
            INSERT INTO policies (user_id, policy_number, status, type) VALUES
            ('test_user', 'POL-TEST-001', 'active', 'auto');
        `);
        
        // Insert a mock pending claim
        await query(`
            INSERT INTO claims (id, policy_id, claim_amount, damage_type, status, description) VALUES
            (1, 1, 500000.00, 'collision', 'pending', 'Test collision claim')
        `);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('should trigger the webhook, run the graph, and update the DB state', async () => {
        // 1. Trigger the webhook
        const response = await request(app)
            .post('/claim')
            .send({ claim_id: 1 })
            .expect(200);
            
        expect(response.body.content).toContain('Investigation complete');

        // 2. Assert the final DB state
        const claimResult = await query('SELECT status, description FROM claims WHERE id = 1');
        
        expect(claimResult.rows.length).toBe(1);
        expect(claimResult.rows[0].status).toBe('flagged');
        expect(claimResult.rows[0].description).toContain('Flagged: Amount suspiciously high for this policy');
    });
});
