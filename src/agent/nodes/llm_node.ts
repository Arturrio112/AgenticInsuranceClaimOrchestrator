import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessageChunk, BaseMessage, SystemMessage } from "@langchain/core/messages";
import { Runnable } from "@langchain/core/runnables";
import { getChatModel } from "../model";
import { GraphStateType } from "../state";
import { SYSTEM_PROMPT, formatClaimContext } from "../prompts";
import { tools } from "./tool_node";

export type ToolCallingModel = Runnable<BaseLanguageModelInput, AIMessageChunk>;

export function bindAgentTools(model: BaseChatModel): ToolCallingModel {
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

let agentModel: ToolCallingModel | undefined;

export const llmNode = createLlmNode(() => {
    if (!agentModel) {
        agentModel = bindAgentTools(getChatModel());
    }
    return agentModel;
});
