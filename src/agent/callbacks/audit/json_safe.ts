import { BaseMessage, isAIMessage, isBaseMessage, isToolMessage } from "@langchain/core/messages";
import { JsonValue } from "../../../db/schema";

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
