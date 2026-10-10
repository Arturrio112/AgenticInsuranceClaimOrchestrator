import { RunContext } from "./types";

const UNKNOWN_TOOL = "unknown";

/**
 * Remembers which graph node (and tool) each in-flight LangChain run belongs to, so
 * end/error events, which only carry a run id, can be attributed correctly.
 */
export class RunTracker {
    /** Chain run id -> LangGraph node (only chain runs that are graph nodes). */
    private readonly nodeRuns = new Map<string, string>();
    /** LLM/tool run id -> node and tool name. */
    private readonly runs = new Map<string, RunContext>();

    startNode(runId: string, node: string): void {
        this.nodeRuns.set(runId, node);
    }

    /** Returns the node of a finished chain run, or undefined if it was not a graph node. */
    endNode(runId: string): string | undefined {
        const node = this.nodeRuns.get(runId);
        this.nodeRuns.delete(runId);
        return node;
    }

    startRun(runId: string, node: string | null, toolName: string = UNKNOWN_TOOL): void {
        this.runs.set(runId, { node, toolName });
    }

    /** Returns (and forgets) the context of a finished LLM/tool run. */
    endRun(runId: string): RunContext {
        const context = this.runs.get(runId) ?? { node: null, toolName: UNKNOWN_TOOL };
        this.runs.delete(runId);
        return context;
    }
}
