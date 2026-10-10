import { AIMessage } from '@langchain/core/messages';
import { ChatGeneration } from '@langchain/core/outputs';
import { llmEndPayload } from '../../../agent/callbacks/audit/llm_result';
import { graphNodeOfChainRun, nodeFromMetadata, serializedName } from '../../../agent/callbacks/audit/run_metadata';
import { RunTracker } from '../../../agent/callbacks/audit/run_tracker';

describe('run_metadata', () => {
    it('reads the class name from a serialized runnable', () => {
        expect(serializedName({ lc: 1, type: 'not_implemented', id: ['langchain', 'ChatOllama'] })).toBe('ChatOllama');
        expect(serializedName(undefined)).toBe('unknown');
    });

    it('reads the LangGraph node from metadata', () => {
        expect(nodeFromMetadata({ langgraph_node: 'decide' })).toBe('decide');
        expect(nodeFromMetadata({ langgraph_node: 3 })).toBeNull();
        expect(nodeFromMetadata(undefined)).toBeNull();
    });

    it('only treats tagged, non-internal chain runs as graph nodes', () => {
        expect(graphNodeOfChainRun(['graph:step:2'], { langgraph_node: 'persist' })).toBe('persist');
        expect(graphNodeOfChainRun([], { langgraph_node: 'persist' })).toBeNull();
        expect(graphNodeOfChainRun(['graph:step:0'], { langgraph_node: '__start__' })).toBeNull();
        expect(graphNodeOfChainRun(['graph:step:1'], {})).toBeNull();
    });
});

describe('RunTracker', () => {
    it('returns and forgets the node of a graph-node chain run', () => {
        const tracker = new RunTracker();
        tracker.startNode('chain-1', 'agent');
        expect(tracker.endNode('chain-1')).toBe('agent');
        expect(tracker.endNode('chain-1')).toBeUndefined();
    });

    it('returns and forgets the context of an llm/tool run, with a safe default', () => {
        const tracker = new RunTracker();
        tracker.startRun('tool-1', 'tools', 'get_policy');
        expect(tracker.endRun('tool-1')).toEqual({ node: 'tools', toolName: 'get_policy' });
        expect(tracker.endRun('tool-1')).toEqual({ node: null, toolName: 'unknown' });
    });
});

describe('llmEndPayload', () => {
    it('collects generated messages, tool calls and provider output', () => {
        const generation: ChatGeneration = {
            text: '',
            message: new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'check_coverage', args: {} }] }),
        };
        const payload = llmEndPayload({ generations: [[generation], [{ text: 'plain' }]], llmOutput: { tokens: 3 } });

        expect(payload.tool_calls).toEqual([expect.objectContaining({ id: 'c1', name: 'check_coverage' })]);
        expect(payload.generations).toEqual([generation.message, { text: 'plain' }]);
        expect(payload.llm_output).toEqual({ tokens: 3 });
    });
});
