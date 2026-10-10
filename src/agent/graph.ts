import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { GraphState, GraphStateType } from "./state";
import { loadClaimNode } from "./nodes/load_claim_node";
import { createAgentLlmNode } from "./nodes/llm_node";
import { createToolNode } from "./nodes/tool_node";
import { decideNode } from "./nodes/decide_node";
import { persistNode } from "./nodes/persist_node";
import { getAgentTools } from "./mcp_client";

/** Stop early when the claim does not exist; the API turns this into a 404. */
export function routeAfterLoad(state: GraphStateType): "agent" | typeof END {
    return state.claim ? "agent" : END;
}

/** Keep looping through tools until the agent stops requesting them, then decide. */
export function routeAfterAgent(state: GraphStateType): "tools" | "decide" {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && AIMessage.isInstance(lastMessage) && lastMessage.tool_calls?.length) {
        return "tools";
    }
    return "decide";
}

/**
 * load_claim -> agent <-> tools -> decide -> persist
 *
 * `tools` are bound to the agent model and executed by the tools node. In production
 * they are the MCP server's tools (see getAgentGraph); tests can pass their own.
 */
export function buildAgentGraph(tools: StructuredToolInterface[]) {
    return new StateGraph(GraphState)
        .addNode("load_claim", loadClaimNode)
        .addNode("agent", createAgentLlmNode(tools))
        .addNode("tools", createToolNode(tools))
        .addNode("decide", decideNode)
        .addNode("persist", persistNode)
        .addEdge(START, "load_claim")
        .addConditionalEdges("load_claim", routeAfterLoad, {
            agent: "agent",
            [END]: END,
        })
        .addConditionalEdges("agent", routeAfterAgent, {
            tools: "tools",
            decide: "decide",
        })
        .addEdge("tools", "agent")
        .addEdge("decide", "persist")
        .addEdge("persist", END)
        .compile();
}

export type AgentGraph = ReturnType<typeof buildAgentGraph>;

let cached: { tools: StructuredToolInterface[]; graph: AgentGraph } | undefined;

/**
 * The claim graph wired to the MCP-served tools. The MCP client connects on first use;
 * the compiled graph is reused for as long as the client keeps the same connection
 * (it is rebuilt after closeMcpClient() and a reconnect).
 */
export async function getAgentGraph(): Promise<AgentGraph> {
    const tools = await getAgentTools();
    if (cached?.tools !== tools) {
        cached = { tools, graph: buildAgentGraph(tools) };
    }
    return cached.graph;
}

/**
 * Entry point used by the API: `app.invoke(state, config)` runs the graph, connecting
 * to the MCP server first if needed.
 */
export const app = {
    invoke: async (...args: Parameters<AgentGraph["invoke"]>) => (await getAgentGraph()).invoke(...args),
};
