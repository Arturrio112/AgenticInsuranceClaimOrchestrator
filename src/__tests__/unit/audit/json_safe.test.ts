import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { MAX_STRING_LENGTH, toJsonSafe, truncateString } from '../../../agent/callbacks/audit';

describe('toJsonSafe', () => {
    it('handles cycles, dates, undefined and non-finite numbers', () => {
        const cyclic: Record<string, unknown> = { a: 1, when: new Date('2026-01-01T00:00:00Z'), skip: undefined, n: Infinity };
        cyclic.self = cyclic;
        expect(toJsonSafe(cyclic)).toEqual({ a: 1, when: '2026-01-01T00:00:00.000Z', n: 'Infinity', self: '[circular]' });
    });

    it('serializes errors to name and message', () => {
        expect(toJsonSafe(new Error('boom'))).toEqual({ name: 'Error', message: 'boom' });
    });

    it('serializes messages with their tool calls and tool call id', () => {
        const ai = new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'get_policy', args: { policy_number: 'P-1' } }] });
        const toolMessage = new ToolMessage({ content: 'ok', tool_call_id: 'c1' });

        expect(toJsonSafe([ai, toolMessage])).toEqual([
            { type: 'ai', content: '', tool_calls: [{ id: 'c1', name: 'get_policy', args: { policy_number: 'P-1' } }] },
            { type: 'tool', content: 'ok', tool_call_id: 'c1' },
        ]);
    });

    it('caps long arrays', () => {
        const result = toJsonSafe(Array.from({ length: 105 }, (_, i) => i)) as unknown[];
        expect(result).toHaveLength(101);
        expect(result[100]).toBe('[5 more items truncated]');
    });
});

describe('truncateString', () => {
    it('leaves short strings untouched', () => {
        expect(truncateString('short')).toBe('short');
    });

    it('cuts strings over the limit and notes how much was dropped', () => {
        const result = truncateString('x'.repeat(MAX_STRING_LENGTH + 10));
        expect(result).toBe(`${'x'.repeat(MAX_STRING_LENGTH)}...[truncated 10 chars]`);
    });
});
