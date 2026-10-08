import { ChatOllama } from "@langchain/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { GraphStateType } from "../state";
import { SYSTEM_PROMPT } from "../prompts";
import { tools } from "./tool_node";

const provider = process.env.LLM_PROVIDER || "ollama";
const modelName = process.env.LLM_MODEL || "llama3.1";
const temperature = 0;

let llm: any;

switch (provider.toLowerCase()) {
    case "gemini":
        llm = new ChatGoogleGenerativeAI({ model: modelName, temperature });
        break;
    case "anthropic":
        llm = new ChatAnthropic({ modelName, temperature });
        break;
    case "openai":
        llm = new ChatOpenAI({ modelName, temperature });
        break;
    case "ollama":
    default:
        llm = new ChatOllama({ model: modelName, temperature });
        break;
}

const llmWithTools = llm.bindTools(tools);

export async function llmNode(state: GraphStateType) {
    const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...state.messages,
    ];
    
    const response = await llmWithTools.invoke(messages);
    return { messages: [response] };
}
