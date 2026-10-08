import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState, GraphStateType } from "./state";
import { llmNode } from "./nodes/llm_node";
import { toolNode } from "./nodes/tool_node";
import { AIMessage } from "@langchain/core/messages";

function shouldContinue(state: GraphStateType) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    
    if (lastMessage.tool_calls?.length) {
        return "tools";
    }
    return END;
}

const workflow = new StateGraph(GraphState)
    .addNode("agent", llmNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
        tools: "tools",
        [END]: END,
    })
    .addEdge("tools", "agent");

export const app = workflow.compile();
