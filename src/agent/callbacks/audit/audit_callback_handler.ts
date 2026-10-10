import { randomUUID } from "crypto";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { BaseMessage } from "@langchain/core/messages";
import { Serialized } from "@langchain/core/load/serializable";
import { LLMResult } from "@langchain/core/outputs";
import { ChainValues } from "@langchain/core/utils/types";
import { AuditWriter } from "./audit_writer";
import { llmEndPayload } from "./llm_result";
import { graphNodeOfChainRun, nodeFromMetadata, serializedName } from "./run_metadata";
import { RunTracker } from "./run_tracker";
import { CallbackMetadata } from "./types";

/**
 * LangChain/LangGraph callback handler that records the agent's execution trace for a
 * single claim in the append-only `audit_logs` table.
 *
 * It only maps callback events to audit records. Ordering, persistence and error
 * handling live in `AuditWriter`. Call `flush()` before responding so every entry is stored.
 */
export class AuditCallbackHandler extends BaseCallbackHandler {
    name = "audit_callback_handler";

    private readonly writer: AuditWriter;
    private readonly runs = new RunTracker();

    constructor(claimId: number, runId: string = randomUUID()) {
        // Await handlers so events are enqueued in order before graph.invoke() resolves.
        super({ _awaitHandler: true });
        this.writer = new AuditWriter(claimId, runId);
    }

    get claimId(): number {
        return this.writer.claimId;
    }

    get runId(): string {
        return this.writer.runId;
    }

    /** Resolves once every queued audit entry has been written (or has failed and been logged). */
    flush(): Promise<void> {
        return this.writer.flush();
    }

    // ---- Graph nodes -------------------------------------------------------

    handleChainStart(
        _chain: Serialized,
        inputs: ChainValues,
        runId: string,
        _parentRunIdOrRunType?: string,
        tags?: string[],
        metadata?: CallbackMetadata
    ): void {
        // NOTE: @langchain/core declares (..., runType, tags, metadata, runName, parentRunId) but the
        // CallbackManager actually passes (..., parentRunId, tags, metadata, runType, runName). Only
        // `tags` and `metadata` sit at the same position in both, so node detection relies on those.
        const node = graphNodeOfChainRun(tags, metadata);
        if (node === null) return;
        this.runs.startNode(runId, node);
        this.writer.record("node_start", node, { inputs });
    }

    handleChainEnd(outputs: ChainValues, runId: string): void {
        const node = this.runs.endNode(runId);
        if (node !== undefined) this.writer.record("node_end", node, { outputs });
    }

    handleChainError(err: unknown, runId: string): void {
        const node = this.runs.endNode(runId);
        if (node !== undefined) this.writer.record("error", node, { source: "node", error: err });
    }

    // ---- LLM calls ---------------------------------------------------------

    handleChatModelStart(
        llm: Serialized,
        messages: BaseMessage[][],
        runId: string,
        _parentRunId?: string,
        _extraParams?: Record<string, unknown>,
        _tags?: string[],
        metadata?: CallbackMetadata,
        runName?: string
    ): void {
        const node = nodeFromMetadata(metadata);
        this.runs.startRun(runId, node);
        this.writer.record("llm_start", node, { model: runName ?? serializedName(llm), messages });
    }

    handleLLMStart(
        llm: Serialized,
        prompts: string[],
        runId: string,
        _parentRunId?: string,
        _extraParams?: Record<string, unknown>,
        _tags?: string[],
        metadata?: CallbackMetadata,
        runName?: string
    ): void {
        const node = nodeFromMetadata(metadata);
        this.runs.startRun(runId, node);
        this.writer.record("llm_start", node, { model: runName ?? serializedName(llm), prompts });
    }

    handleLLMEnd(output: LLMResult, runId: string): void {
        const { node } = this.runs.endRun(runId);
        this.writer.record("llm_end", node, llmEndPayload(output));
    }

    handleLLMError(err: unknown, runId: string): void {
        const { node } = this.runs.endRun(runId);
        this.writer.record("error", node, { source: "llm", error: err });
    }

    // ---- Tool calls --------------------------------------------------------

    handleToolStart(
        tool: Serialized,
        input: string,
        runId: string,
        _parentRunId?: string,
        _tags?: string[],
        metadata?: CallbackMetadata,
        runName?: string,
        toolCallId?: string
    ): void {
        const node = nodeFromMetadata(metadata);
        const toolName = runName ?? serializedName(tool);
        this.runs.startRun(runId, node, toolName);
        this.writer.record("tool_start", node, { tool_name: toolName, input, tool_call_id: toolCallId });
    }

    handleToolEnd(output: unknown, runId: string): void {
        const { node, toolName } = this.runs.endRun(runId);
        this.writer.record("tool_end", node, { tool_name: toolName, output });
    }

    handleToolError(err: unknown, runId: string): void {
        const { node, toolName } = this.runs.endRun(runId);
        this.writer.record("error", node, { source: "tool", tool_name: toolName, error: err });
    }
}
