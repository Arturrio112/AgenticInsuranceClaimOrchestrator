import { Serialized } from "@langchain/core/load/serializable";
import { CallbackMetadata } from "./types";

/** Class name of the serialized runnable (last segment of its id), e.g. "ChatOllama". */
export function serializedName(serialized: Serialized | undefined): string {
    const id = serialized?.id;
    return id && id.length > 0 ? id[id.length - 1] : "unknown";
}

/** The LangGraph node a run belongs to, if any. */
export function nodeFromMetadata(metadata: CallbackMetadata): string | null {
    const node = metadata?.langgraph_node;
    return typeof node === "string" ? node : null;
}

/**
 * Returns the node name when a chain run is a LangGraph node itself, otherwise null.
 *
 * The node runnable carries the non-inheritable "graph:step:N" tag; routers, channel
 * writers and functions nested in a node do not. "__start__" etc. are internal.
 */
export function graphNodeOfChainRun(tags: string[] | undefined, metadata: CallbackMetadata): string | null {
    const node = nodeFromMetadata(metadata);
    const isNodeRun = (tags ?? []).some((tag) => tag.startsWith("graph:step:"));
    if (!node || !isNodeRun || node.startsWith("__")) return null;
    return node;
}
