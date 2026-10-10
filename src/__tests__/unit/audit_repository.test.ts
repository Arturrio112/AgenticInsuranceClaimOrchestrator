import { query } from '../../db/client';
import * as auditRepository from '../../db/audit_repository';
import { getAuditLogsForClaim, insertAuditLog } from '../../db/audit_repository';

jest.mock('../../db/client', () => ({
    query: jest.fn(),
}));

const queryMock = query as jest.Mock;

describe('audit_repository', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('insertAuditLog inserts a row with a JSON-encoded payload and returns it', async () => {
        const row = {
            id: 1, claim_id: 5, run_id: 'run-1', step_index: 0, event_type: 'tool_end',
            node_name: 'tools', payload: { tool_name: 'flag_review' }, created_at: new Date(),
        };
        queryMock.mockResolvedValueOnce({ rows: [row] });

        const result = await insertAuditLog({
            claim_id: 5,
            run_id: 'run-1',
            step_index: 0,
            event_type: 'tool_end',
            node_name: 'tools',
            payload: { tool_name: 'flag_review' },
        });

        expect(result).toEqual(row);
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO audit_logs/);
        expect(sql).toMatch(/\$6::jsonb/);
        expect(params).toEqual([5, 'run-1', 0, 'tool_end', 'tools', '{"tool_name":"flag_review"}']);
    });

    it('getAuditLogsForClaim selects entries for the claim in chronological order', async () => {
        queryMock.mockResolvedValueOnce({ rows: [] });

        const result = await getAuditLogsForClaim(9);

        expect(result).toEqual([]);
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toMatch(/FROM audit_logs\s+WHERE claim_id = \$1\s+ORDER BY created_at ASC, id ASC/);
        expect(params).toEqual([9]);
    });

    it('exposes no update or delete operations', () => {
        const repo: Record<string, unknown> = { ...auditRepository };
        const functions = Object.keys(repo).filter((key) => typeof repo[key] === 'function').sort();
        expect(functions).toEqual(['getAuditLogsForClaim', 'insertAuditLog']);
    });
});
