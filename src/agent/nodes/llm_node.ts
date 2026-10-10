import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessageChunk, BaseMessage, SystemMessage } from "@langchain/core/messages";
import { Runnable } from "@langchain/core/runnables";
import { StructuredToolInterface } from "@langchain/core/tools";
import { getChatModel } from "../model";
import { GraphStateType } from "../state";
import { SYSTEM_PROMPT, formatClaimContext } from "../prompts";

export type ToolCallingModel = Runnable<BaseLanguageModelInput, AIMessageChunk>;

export function bindAgentTools(model: BaseChatModel, tools: StructuredToolInterface[]): ToolCallingModel {
    if (!model.bindTools) {
        throw new Error("The configured chat model does not support tool calling.");
    }
    return model.bindTools(tools);
}

/** System prompt with the claim loaded by `load_claim`, so the model never has to guess it. */
export function buildAgentPrompt(state: GraphStateType): SystemMessage {
    const context = state.claim ? `\n\n${formatClaimContext(state.claim)}` : "";
    return new SystemMessage(`${SYSTEM_PROMPT}${context}`);
}

/** Factory so tests can inject a fake tool-calling model. */
export function createLlmNode(getModel: () => ToolCallingModel) {
    return async function llmNode(state: GraphStateType): Promise<{ messages: BaseMessage[] }> {
        const response = await getModel().invoke([buildAgentPrompt(state), ...state.messages]);
        return { messages: [response] };
    };
}

/** Agent node backed by the configured chat model, bound to the given (MCP-served) tools on first use. */
export function createAgentLlmNode(tools: StructuredToolInterface[]) {
    let agentModel: ToolCallingModel | undefined;
    return createLlmNode(() => {
        if (!agentModel) {
            agentModel = bindAgentTools(getChatModel(), tools);
        }
        return agentModel;
    });
}
