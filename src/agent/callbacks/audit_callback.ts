import { randomUUID } from "crypto";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { BaseMessage, isAIMessage, isBaseMessage, isToolMessage } from "@langchain/core/messages";
import { Serialized } from "@langchain/core/load/serializable";
import { LLMResult } from "@langchain/core/outputs";
import { ChainValues } from "@langchain/core/utils/types";
import { insertAuditLog, NewAuditLog } from "../../db/audit_repository";
import { AuditEventType, JsonValue } from "../../db/schema";
import { logger } from "../../utils/logger";

/** Strings longer than this are cut so a single huge prompt/tool output cannot bloat the audit table. */
export const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 100;
const MAX_DEPTH = 8;

export function truncateString(value: string, max: number = MAX_STRING_LENGTH): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}...[truncated ${value.length - max} chars]`;
}

function serializeMessage(message: BaseMessage, depth: number, seen: WeakSet<object>): JsonValue {
    const result: { [key: string]: JsonValue } = {
        type: message.getType(),
        content: toJsonSafe(message.content, depth + 1, seen),
    };
    if (message.name) result.name = message.name;
    if (isAIMessage(message) && message.tool_calls && message.tool_calls.length > 0) {
        result.tool_calls = message.tool_calls.map((call) => ({
            id: call.id ?? null,
            name: call.name,
            args: toJsonSafe(call.args, depth + 2, seen),
        }));
    }
    if (isToolMessage(message)) result.tool_call_id = message.tool_call_id;
    return result;
}

/**
 * Converts arbitrary callback data (messages, state, errors, ...) into a JSON value
 * that can be stored in JSONB. Long strings are truncated, cycles and deep nesting are cut.
 */
export function toJsonSafe(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): JsonValue {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return truncateString(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "boolean") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") return null;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { name: value.name, message: truncateString(value.message) };
    if (depth >= MAX_DEPTH) return "[max depth]";

    const obj = value as object;
    if (seen.has(obj)) return "[circular]";
    seen.add(obj);
    try {
        if (isBaseMessage(value)) return serializeMessage(value, depth, seen);
        if (Array.isArray(value)) {
            const items = value.slice(0, MAX_ARRAY_ITEMS).map((item: unknown) => toJsonSafe(item, depth + 1, seen));
            if (value.length > MAX_ARRAY_ITEMS) items.push(`[${value.length - MAX_ARRAY_ITEMS} more items truncated]`);
            return items;
        }
        const result: { [key: string]: JsonValue } = {};
        for (const [key, entry] of Object.entries(obj)) {
            if (entry === undefined) continue;
            result[key] = toJsonSafe(entry, depth + 1, seen);
        }
        return result;
    } finally {
        seen.delete(obj);
    }
}

function serializedName(serialized: Serialized | undefined): string {
    const id = serialized?.id;
    return id && id.length > 0 ? id[id.length - 1] : "unknown";
}

function nodeFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
    const node = metadata?.langgraph_node;
    return typeof node === "string" ? node : null;
}

/**
 * LangChain/LangGraph callback handler that writes the agent's execution trace into
 * the append-only `audit_logs` table for a single claim.
 *
 * - Writes are queued in event order and never throw: failures are logged and swallowed,
 *   so auditing can never break claim processing.
 * - Call `flush()` before responding to make sure every entry has been persisted.
 */
export class AuditCallbackHandler extends BaseCallbackHandler {
    name = "audit_callback_handler";

    readonly claimId: number;
    readonly runId: string;

    private stepIndex = 0;
    private queue: Promise<void> = Promise.resolve();
    private readonly enabled: boolean;
    /** LangChain run id -> graph node the LLM/tool run belongs to. */
    private readonly runNodes = new Map<string, string | null>();
    /** LangChain run id -> tool name, so tool_end entries can name the tool. */
    private readonly toolNames = new Map<string, string>();
    /** LangChain run ids of chain runs that are LangGraph nodes (internal chains are skipped). */
    private readonly nodeRuns = new Map<string, string>();

    constructor(claimId: number, runId: string = randomUUID()) {
        // Await handlers so events are enqueued in order before graph.invoke() resolves.
        super({ _awaitHandler: true });
        this.claimId = claimId;
        this.runId = runId;
        this.enabled = Number.isInteger(claimId) && claimId > 0;
        if (!this.enabled) {
            logger.warn("Audit trail disabled: invalid claim_id", { claim_id: claimId });
        }
    }

    /** Resolves once every queued audit entry has been written (or has failed and been logged). */
    async flush(): Promise<void> {
        await this.queue;
    }

    private record(eventType: AuditEventType, nodeName: string | null, payload: Record<string, unknown>): void {
        if (!this.enabled) return;
        try {
            const entry: NewAuditLog = {
                claim_id: this.claimId,
                run_id: this.runId,
                step_index: this.stepIndex++,
                event_type: eventType,
                node_name: nodeName,
                payload: toJsonSafe(payload),
            };
            this.queue = this.queue.then(async () => {
                try {
                    await insertAuditLog(entry);
                } catch (error) {
                    logger.error("Failed to write audit log entry", {
                        claim_id: entry.claim_id,
                        run_id: entry.run_id,
                        event_type: entry.event_type,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        } catch (error) {
            logger.error("Failed to build audit log entry", {
                claim_id: this.claimId,
                event_type: eventType,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // ---- Graph nodes -------------------------------------------------------

    handleChainStart(
        _chain: Serialized,
        inputs: ChainValues,
        runId: string,
        _parentRunIdOrRunType?: string,
        tags?: string[],
        metadata?: Record<string, unknown>
    ): void {
        // NOTE: @langchain/core declares (..., runType, tags, metadata, runName, parentRunId) but the
        // CallbackManager actually passes (..., parentRunId, tags, metadata, runType, runName). Only
        // `tags` and `metadata` sit at the same position in both, so node detection relies on those.
        const node = nodeFromMetadata(metadata);
        // The node runnable itself carries the non-inheritable "graph:step:N" tag; routers,
        // channel writers and functions nested in a node do not. "__start__" etc. are internal.
        const isNodeRun = (tags ?? []).some((tag) => tag.startsWith("graph:step:"));
        if (!node || !isNodeRun || node.startsWith("__")) return;
        this.nodeRuns.set(runId, node);
        this.record("node_start", node, { inputs });
    }

    handleChainEnd(outputs: ChainValues, runId: string): void {
        const node = this.nodeRuns.get(runId);
        if (node === undefined) return;
        this.nodeRuns.delete(runId);
        this.record("node_end", node, { outputs });
    }

    handleChainError(err: unknown, runId: string): void {
        const node = this.nodeRuns.get(runId);
        if (node === undefined) return;
        this.nodeRuns.delete(runId);
        this.record("error", node, { source: "node", error: err });
    }

    // ---- LLM calls ---------------------------------------------------------

    handleChatModelStart(
        llm: Serialized,
        messages: BaseMessage[][],
        runId: string,
        _parentRunId?: string,
        _extraParams?: Record<string, unknown>,
        _tags?: string[],
        metadata?: Record<string, unknown>,
        runName?: string
    ): void {
        const node = nodeFromMetadata(metadata);
        this.runNodes.set(runId, node);
        this.record("llm_start", node, { model: runName ?? serializedName(llm), messages });
    }

    handleLLMStart(
        llm: Serialized,
        prompts: string[],
        runId: string,
        _parentRunId?: string,
        _extraParams?: Record<string, unknown>,
        _tags?: string[],
        metadata?: Record<string, unknown>,
        runName?: string
    ): void {
        const node = nodeFromMetadata(metadata);
        this.runNodes.set(runId, node);
        this.record("llm_start", node, { model: runName ?? serializedName(llm), prompts });
    }

    handleLLMEnd(output: LLMResult, runId: string): void {
        const node = this.runNodes.get(runId) ?? null;
        this.runNodes.delete(runId);
        const generations = output.generations.flat();
        const toolCalls = generations.flatMap((generation) =>
            "message" in generation && isBaseMessage(generation.message) && isAIMessage(generation.message)
                ? generation.message.tool_calls ?? []
                : []
        );
        this.record("llm_end", node, {
            generations: generations.map((generation) =>
                "message" in generation && isBaseMessage(generation.message)
                    ? generation.message
                    : { text: generation.text }
            ),
            tool_calls: toolCalls,
            llm_output: output.llmOutput,
        });
    }

    handleLLMError(err: unknown, runId: string): void {
        const node = this.runNodes.get(runId) ?? null;
        this.runNodes.delete(runId);
        this.record("error", node, { source: "llm", error: err });
    }

    // ---- Tool calls --------------------------------------------------------

    handleToolStart(
        tool: Serialized,
        input: string,
        runId: string,
        _parentRunId?: string,
        _tags?: string[],
        metadata?: Record<string, unknown>,
        runName?: string,
        toolCallId?: string
    ): void {
        const node = nodeFromMetadata(metadata);
        const toolName = runName ?? serializedName(tool);
        this.runNodes.set(runId, node);
        this.toolNames.set(runId, toolName);
        this.record("tool_start", node, { tool_name: toolName, input, tool_call_id: toolCallId });
    }

    handleToolEnd(output: unknown, runId: string): void {
        const node = this.runNodes.get(runId) ?? null;
        const toolName = this.toolNames.get(runId) ?? "unknown";
        this.runNodes.delete(runId);
        this.toolNames.delete(runId);
        this.record("tool_end", node, { tool_name: toolName, output });
    }

    handleToolError(err: unknown, runId: string): void {
        const node = this.runNodes.get(runId) ?? null;
        const toolName = this.toolNames.get(runId) ?? "unknown";
        this.runNodes.delete(runId);
        this.toolNames.delete(runId);
        this.record("error", node, { source: "tool", tool_name: toolName, error: err });
    }
}
