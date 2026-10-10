import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

/**
 * Builds the chat model for the configured provider.
 *
 * All supported providers extend `BaseChatModel`, so callers get one typed
 * interface (`bindTools`, `withStructuredOutput`, `invoke`) regardless of the
 * backend. Construction is lazy and memoised so that importing the graph
 * (e.g. in tests) never instantiates a provider client.
 */
export function createChatModel(): BaseChatModel {
    const provider = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
    const modelName = process.env.LLM_MODEL || "llama3.1";
    const temperature = 0;

    switch (provider) {
        case "gemini":
            return new ChatGoogleGenerativeAI({ model: modelName, temperature });
        case "anthropic":
            return new ChatAnthropic({ model: modelName, temperature });
        case "openai":
            return new ChatOpenAI({ model: modelName, temperature });
        case "ollama":
        default:
            return new ChatOllama({
                model: modelName,
                temperature,
                baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
            });
    }
}

let cachedModel: BaseChatModel | undefined;

export function getChatModel(): BaseChatModel {
    if (!cachedModel) {
        cachedModel = createChatModel();
    }
    return cachedModel;
}
