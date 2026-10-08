import { ChatOllama } from "@langchain/ollama";
import { GraphStateType } from "../state";
import { SYSTEM_PROMPT } from "../prompts";
import { tools } from "./tool_node";

const llm = new ChatOllama({
    model: "llama3.1",
    temperature: 0,
});

const llmWithTools = llm.bindTools(tools);

export async function llmNode(state: GraphStateType) {
    const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...state.messages,
    ];
    
    const response = await llmWithTools.invoke(messages);
    return { messages: [response] };
}
