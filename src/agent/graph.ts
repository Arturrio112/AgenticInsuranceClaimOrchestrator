import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { GraphState, GraphStateType } from "./state";
import { loadClaimNode } from "./nodes/load_claim_node";
import { llmNode } from "./nodes/llm_node";
import { toolNode } from "./nodes/tool_node";
import { decideNode } from "./nodes/decide_node";
import { persistNode } from "./nodes/persist_node";

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
 */
const workflow = new StateGraph(GraphState)
    .addNode("load_claim", loadClaimNode)
    .addNode("agent", llmNode)
    .addNode("tools", toolNode)
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
    .addEdge("persist", END);

export const app = workflow.compile();
