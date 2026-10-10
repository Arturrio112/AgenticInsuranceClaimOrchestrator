import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { getChatModel } from "../model";
import { buildDecisionSystemPrompt, formatClaimContext } from "../prompts";
import { getConfidenceThreshold } from "../config";
import { GraphStateType } from "../state";
import {
    ClaimDecision,
    DecisionSchema,
    collectKnownSources,
    fallbackDecision,
    filterCitations,
    messageText,
} from "../decision";
import { logger } from "../../utils/logger";

/** Anything that turns a prompt into (hopefully) a DecisionSchema-shaped object. */
export interface DecisionModel {
    invoke(input: BaseLanguageModelInput): Promise<unknown>;
}

/**
 * Flattens the investigation into plain text. Small local models handle one
 * explicit text block far better than a replay of tool-call messages.
 */
export function buildDecisionTranscript(messages: BaseMessage[]): string {
    const lines: string[] = [];
    for (const message of messages) {
        if (ToolMessage.isInstance(message)) {
            lines.push(`[${message.name ?? "tool"} result] ${messageText(message.content)}`);
        } else if (AIMessage.isInstance(message)) {
            const text = messageText(message.content).trim();
            if (text) lines.push(`[agent note] ${text}`);
        }
    }
    return lines.length ? lines.join("\n") : "(no tool results)";
}

export function buildDecisionPrompt(state: GraphStateType): BaseMessage[] {
    const claim = state.claim ? formatClaimContext(state.claim) : `CLAIM:\n- claim_id: ${state.claim_id}`;
    return [
        new SystemMessage(buildDecisionSystemPrompt(getConfidenceThreshold())),
        new HumanMessage(`${claim}\n\nTOOL RESULTS:\n${buildDecisionTranscript(state.messages)}\n\nReturn the decision now.`),
    ];
}

/**
 * Validates raw model output and removes hallucinated citations.
 * Never throws: any invalid output becomes a safe "flag" with confidence 0.
 */
export function toClaimDecision(raw: unknown, state: GraphStateType): ClaimDecision {
    const parsed = DecisionSchema.safeParse(raw);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "output"}: ${i.message}`).join("; ");
        logger.warn("Decision output failed validation, using fallback", { claim_id: state.claim_id, issues });
        return fallbackDecision(`model output failed validation (${issues})`);
    }

    const { citations, dropped } = filterCitations(
        parsed.data.citations,
        collectKnownSources(state.messages, state.claim)
    );
    if (dropped.length) {
        logger.warn("Dropped citations not returned by any tool", { claim_id: state.claim_id, dropped });
    }

    return {
        decision: parsed.data.decision,
        reasoning: parsed.data.reasoning,
        confidence_score: Math.round(parsed.data.confidence_score),
        citations,
        fallback: false,
    };
}

/** Factory so tests can inject a fake structured-output model. */
export function createDecideNode(getModel: () => DecisionModel) {
    return async function decideNode(state: GraphStateType): Promise<{ decision: ClaimDecision }> {
        let raw: unknown;
        try {
            raw = await getModel().invoke(buildDecisionPrompt(state));
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logger.warn("Structured decision call failed, using fallback", { claim_id: state.claim_id, reason });
            return { decision: fallbackDecision(`model call failed (${reason})`) };
        }
        return { decision: toClaimDecision(raw, state) };
    };
}

let decisionModel: DecisionModel | undefined;

export function getDecisionModel(): DecisionModel {
    if (!decisionModel) {
        decisionModel = getChatModel().withStructuredOutput(DecisionSchema, { name: "claim_decision" });
    }
    return decisionModel;
}

export const decideNode = createDecideNode(getDecisionModel);
