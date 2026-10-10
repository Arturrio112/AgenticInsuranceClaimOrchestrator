import { isAIMessage, isBaseMessage } from "@langchain/core/messages";
import { LLMResult } from "@langchain/core/outputs";
import { AuditPayload } from "./types";

/** Builds the `llm_end` payload: generated messages (or text), requested tool calls and provider output. */
export function llmEndPayload(output: LLMResult): AuditPayload {
    const generations = output.generations.flat();
    const toolCalls = generations.flatMap((generation) =>
        "message" in generation && isBaseMessage(generation.message) && isAIMessage(generation.message)
            ? generation.message.tool_calls ?? []
            : []
    );
    return {
        generations: generations.map((generation) =>
            "message" in generation && isBaseMessage(generation.message)
                ? generation.message
                : { text: generation.text }
        ),
        tool_calls: toolCalls,
        llm_output: output.llmOutput,
    };
}
