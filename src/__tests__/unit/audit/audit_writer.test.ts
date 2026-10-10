import { AuditWriter } from '../../../agent/callbacks/audit';
import { insertAuditLog, NewAuditLog } from '../../../db/audit_repository';
import { logger } from '../../../utils/logger';

jest.mock('../../../db/audit_repository', () => ({
    insertAuditLog: jest.fn(),
}));

const insertMock = insertAuditLog as jest.MockedFunction<typeof insertAuditLog>;

function recordedEntries(): NewAuditLog[] {
    return insertMock.mock.calls.map(([entry]) => entry);
}

describe('AuditWriter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        insertMock.mockResolvedValue({
            id: 1, claim_id: 1, run_id: 'r', step_index: 0, event_type: 'node_start',
            node_name: null, payload: {}, created_at: new Date(),
        });
    });

    it('writes entries in order with gapless step indexes and JSON-safe payloads', async () => {
        const writer = new AuditWriter(5, 'run-1');
        writer.record('node_start', 'agent', { when: new Date('2026-01-01T00:00:00Z'), skip: undefined });
        writer.record('node_end', 'agent', { outputs: { ok: true } });
        await writer.flush();

        expect(recordedEntries()).toEqual([
            { claim_id: 5, run_id: 'run-1', step_index: 0, event_type: 'node_start', node_name: 'agent', payload: { when: '2026-01-01T00:00:00.000Z' } },
            { claim_id: 5, run_id: 'run-1', step_index: 1, event_type: 'node_end', node_name: 'agent', payload: { outputs: { ok: true } } },
        ]);
    });

    it('swallows DB failures, logs them and keeps writing later entries', async () => {
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        insertMock.mockRejectedValueOnce(new Error('connection refused'));
        const writer = new AuditWriter(1, 'run-2');

        writer.record('tool_start', null, { tool_name: 'get_policy' });
        writer.record('tool_end', null, { tool_name: 'get_policy' });
        await expect(writer.flush()).resolves.toBeUndefined();

        expect(insertMock).toHaveBeenCalledTimes(2);
        expect(errorSpy).toHaveBeenCalledWith('Failed to write audit log entry', expect.objectContaining({
            event_type: 'tool_start',
            error: 'connection refused',
        }));
        errorSpy.mockRestore();
    });

    it('does nothing for an invalid claim id', async () => {
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const writer = new AuditWriter(Number.NaN, 'run-3');
        writer.record('tool_start', null, {});
        await writer.flush();

        expect(insertMock).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith('Audit trail disabled: invalid claim_id', { claim_id: Number.NaN });
        warnSpy.mockRestore();
    });
});
