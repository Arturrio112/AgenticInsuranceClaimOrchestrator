import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { tool } from '@langchain/core/tools';
import { Serialized } from '@langchain/core/load/serializable';
import { ChatGeneration } from '@langchain/core/outputs';
import { StateGraph, START, END, Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { z } from 'zod';
import { AuditCallbackHandler, MAX_STRING_LENGTH } from '../../../agent/callbacks/audit';
import { insertAuditLog, NewAuditLog } from '../../../db/audit_repository';

jest.mock('../../../db/audit_repository', () => ({
    insertAuditLog: jest.fn(),
}));

const insertMock = insertAuditLog as jest.MockedFunction<typeof insertAuditLog>;

const serialized: Serialized = { lc: 1, type: 'not_implemented', id: ['test', 'FakeModel'] };

function recordedEntries(): NewAuditLog[] {
    return insertMock.mock.calls.map(([entry]) => entry);
}

describe('AuditCallbackHandler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        insertMock.mockResolvedValue({
            id: 1, claim_id: 1, run_id: 'r', step_index: 0, event_type: 'node_start',
            node_name: null, payload: {}, created_at: new Date(),
        });
    });

    it('records node, llm and tool events in order with step indexes and node names', async () => {
        const handler = new AuditCallbackHandler(7, 'run-abc');
        const agentMeta = { langgraph_node: 'agent' };
        const toolsMeta = { langgraph_node: 'tools' };

        handler.handleChainStart(serialized, { claim_id: 7 }, 'chain-1', undefined, ['graph:step:1'], agentMeta);
        handler.handleChatModelStart(serialized, [[new HumanMessage('Process claim 7')]], 'llm-1', 'chain-1', {}, [], agentMeta, 'FakeModel');
        const generation: ChatGeneration = {
            text: '',
            message: new AIMessage({
                content: '',
                tool_calls: [{ id: 'call_1', name: 'flag_review', args: { claim_id: 7, reason: 'too high' } }],
            }),
        };
        handler.handleLLMEnd({ generations: [[generation]] }, 'llm-1');
        handler.handleChainEnd({ messages: [] }, 'chain-1');
        handler.handleChainStart(serialized, {}, 'chain-2', undefined, ['graph:step:2'], toolsMeta);
        handler.handleToolStart(serialized, '{"claim_id":7}', 'tool-1', 'chain-2', [], toolsMeta, 'flag_review', 'call_1');
        handler.handleToolEnd(new ToolMessage({ content: 'flagged', tool_call_id: 'call_1' }), 'tool-1');
        handler.handleChainEnd({ messages: [] }, 'chain-2');
        await handler.flush();

        const entries = recordedEntries();
        expect(entries.map((e) => e.event_type)).toEqual([
            'node_start', 'llm_start', 'llm_end', 'node_end', 'node_start', 'tool_start', 'tool_end', 'node_end',
        ]);
        expect(entries.map((e) => e.step_index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(entries.map((e) => e.node_name)).toEqual([
            'agent', 'agent', 'agent', 'agent', 'tools', 'tools', 'tools', 'tools',
        ]);
        expect(entries.every((e) => e.claim_id === 7 && e.run_id === 'run-abc')).toBe(true);

        expect(entries[1].payload).toMatchObject({
            model: 'FakeModel',
            messages: [[{ type: 'human', content: 'Process claim 7' }]],
        });
        expect(entries[2].payload).toMatchObject({
            tool_calls: [{ name: 'flag_review', args: { claim_id: 7, reason: 'too high' } }],
        });
        expect(entries[5].payload).toEqual({ tool_name: 'flag_review', input: '{"claim_id":7}', tool_call_id: 'call_1' });
        expect(entries[6].payload).toEqual({
            tool_name: 'flag_review',
            output: { type: 'tool', content: 'flagged', tool_call_id: 'call_1' },
        });
    });

    it('skips internal chains that are not graph nodes', async () => {
        const handler = new AuditCallbackHandler(1);
        handler.handleChainStart(serialized, {}, 'root', undefined, [], {});
        handler.handleChainStart(serialized, {}, 'router', undefined, [], { langgraph_node: 'agent' });
        handler.handleChainStart(serialized, {}, 'start', undefined, ['graph:step:0'], { langgraph_node: '__start__' });
        handler.handleChainEnd({}, 'root');
        handler.handleChainEnd({}, 'router');
        handler.handleChainEnd({}, 'start');
        await handler.flush();

        expect(insertMock).not.toHaveBeenCalled();
    });

    it('records errors from llm, tool and node runs', async () => {
        const handler = new AuditCallbackHandler(1);
        const meta = { langgraph_node: 'agent' };
        handler.handleChainStart(serialized, {}, 'chain-1', undefined, ['graph:step:1'], meta);
        handler.handleChatModelStart(serialized, [[]], 'llm-1', 'chain-1', {}, [], meta, 'FakeModel');
        handler.handleLLMError(new Error('model offline'), 'llm-1');
        handler.handleToolStart(serialized, 'x', 'tool-1', undefined, [], meta, 'get_policy');
        handler.handleToolError(new Error('tool broke'), 'tool-1');
        handler.handleChainError(new Error('node failed'), 'chain-1');
        await handler.flush();

        const errors = recordedEntries().filter((e) => e.event_type === 'error');
        expect(errors.map((e) => e.payload)).toEqual([
            { source: 'llm', error: { name: 'Error', message: 'model offline' } },
            { source: 'tool', tool_name: 'get_policy', error: { name: 'Error', message: 'tool broke' } },
            { source: 'node', error: { name: 'Error', message: 'node failed' } },
        ]);
    });

    it('records the MCP server a tool call went through', async () => {
        const handler = new AuditCallbackHandler(1);
        const meta = { langgraph_node: 'tools', mcp_server: 'InsuranceClaimMCP', mcp_transport: 'inmemory' };
        handler.handleToolStart(serialized, '{"policy_number":"P1"}', 'tool-1', undefined, [], meta, 'get_policy', 'c1');
        handler.handleToolEnd(new ToolMessage({ content: '{"id":1}', tool_call_id: 'c1' }), 'tool-1');
        await handler.flush();

        const [start, end] = recordedEntries();
        expect(start.payload).toEqual({
            tool_name: 'get_policy',
            input: '{"policy_number":"P1"}',
            tool_call_id: 'c1',
            mcp_server: 'InsuranceClaimMCP',
            mcp_transport: 'inmemory',
        });
        expect(end.payload).toMatchObject({
            tool_name: 'get_policy',
            mcp_server: 'InsuranceClaimMCP',
            mcp_transport: 'inmemory',
            output: { type: 'tool', content: '{"id":1}' },
        });
    });

    it('truncates huge strings in payloads', async () => {
        const handler = new AuditCallbackHandler(1);
        const huge = 'x'.repeat(MAX_STRING_LENGTH + 500);
        handler.handleToolStart(serialized, huge, 'tool-1', undefined, [], {}, 'get_policy');
        await handler.flush();

        const payload = recordedEntries()[0].payload as { input: string };
        expect(payload.input.startsWith('x'.repeat(MAX_STRING_LENGTH))).toBe(true);
        expect(payload.input).toContain('[truncated 500 chars]');
        expect(payload.input.length).toBeLessThan(huge.length);
    });

    it('captures node, llm and tool events from a real LangGraph run', async () => {
        const echoTool = tool(async ({ text }: { text: string }) => `echo: ${text}`, {
            name: 'echo',
            description: 'Echo text',
            schema: z.object({ text: z.string() }),
        });
        const model = new FakeListChatModel({ responses: ['All done.'] });
        const State = Annotation.Root({ ...MessagesAnnotation.spec });

        const graph = new StateGraph(State)
            .addNode('agent', async (state: typeof State.State) => ({ messages: [await model.invoke(state.messages)] }))
            .addNode('tools', async () => ({
                messages: [new ToolMessage({ content: await echoTool.invoke({ text: 'hi' }), tool_call_id: 'c1' })],
            }))
            .addEdge(START, 'tools')
            .addEdge('tools', 'agent')
            .addEdge('agent', END)
            .compile();

        const handler = new AuditCallbackHandler(3, 'graph-run');
        expect(handler.claimId).toBe(3);
        expect(handler.runId).toBe('graph-run');
        await graph.invoke({ messages: [new HumanMessage('hello')] }, { callbacks: [handler] });
        await handler.flush();

        const entries = recordedEntries();
        expect(entries.map((e) => `${e.event_type}:${e.node_name}`)).toEqual([
            'node_start:tools', 'tool_start:tools', 'tool_end:tools', 'node_end:tools',
            'node_start:agent', 'llm_start:agent', 'llm_end:agent', 'node_end:agent',
        ]);
        expect(entries[2].payload).toMatchObject({ tool_name: 'echo', output: 'echo: hi' });
    });
});
