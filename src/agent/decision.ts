import { z } from "zod";
import { BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { ClaimContext } from "./state";

/**
 * Schema the LLM must fill in for the final claim decision (Tickets 7.1 + 8.1).
 *
 * Every field is required (nullable instead of optional) so the schema also
 * works with providers that use strict JSON-schema mode.
 */
export const DecisionSchema = z.object({
    decision: z
        .enum(["approve", "reject", "flag"])
        .describe('Exactly one of "approve", "reject" or "flag".'),
    reasoning: z
        .string()
        .min(1)
        .describe("Two to four sentences explaining the decision, referring to the policy status, coverage rule and claim amount."),
    confidence_score: z
        .number()
        .min(0)
        .max(100)
        .describe("Integer from 0 to 100. How confident you are in the decision. 100 = certain."),
    citations: z
        .object({
            policy_id: z
                .number()
                .int()
                .nullable()
                .describe('The numeric "id" field of the policy returned by get_policy, or null.'),
            policy_number: z
                .string()
                .nullable()
                .describe('The "policy_number" of the policy returned by get_policy, or null.'),
            coverage_rule_ids: z
                .array(z.number().int())
                .describe('The numeric "id" fields of the coverage rules returned by check_coverage. Empty array if none.'),
        })
        .describe("Only IDs that appear in the tool results. Never invent IDs."),
});

export type DecisionOutput = z.infer<typeof DecisionSchema>;

export type DecisionVerdict = DecisionOutput["decision"];

export interface DecisionCitations {
    policy_id: number | null;
    policy_number: string | null;
    coverage_rule_ids: number[];
}

/** Final, validated decision stored in graph state and returned by the API. */
export interface ClaimDecision {
    decision: DecisionVerdict;
    reasoning: string;
    /** Integer 0-100. */
    confidence_score: number;
    citations: DecisionCitations;
    /** True when the LLM output could not be parsed and the safe fallback was used. */
    fallback: boolean;
}

/** IDs that the tools actually returned during the investigation. */
export interface KnownSources {
    policyIds: Set<number>;
    policyNumbers: Set<string>;
    coverageRuleIds: Set<number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function messageText(content: BaseMessage["content"]): string {
    if (typeof content === "string") return content;
    return content
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join("");
}

function parseToolPayload(message: ToolMessage): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(messageText(message.content));
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function toInt(value: unknown): number | null {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isInteger(n) ? n : null;
}

/**
 * Collects the policy and coverage-rule IDs present in tool results, plus the
 * claim's own policy (loaded from the DB before the agent ran).
 */
export function collectKnownSources(messages: BaseMessage[], claim: ClaimContext | null): KnownSources {
    const sources: KnownSources = {
        policyIds: new Set<number>(),
        policyNumbers: new Set<string>(),
        coverageRuleIds: new Set<number>(),
    };

    if (claim) {
        sources.policyIds.add(claim.policy_id);
        if (claim.policy_number) sources.policyNumbers.add(claim.policy_number);
    }

    for (const message of messages) {
        if (!ToolMessage.isInstance(message)) continue;
        const payload = parseToolPayload(message);
        if (!payload) continue;

        const id = toInt(payload.id);
        if (message.name === "get_policy") {
            if (id !== null) sources.policyIds.add(id);
            if (typeof payload.policy_number === "string") sources.policyNumbers.add(payload.policy_number);
        } else if (message.name === "check_coverage") {
            if (id !== null) sources.coverageRuleIds.add(id);
        }
    }

    return sources;
}

export interface CitationCheck {
    citations: DecisionCitations;
    /** Human-readable descriptions of the IDs the model invented. */
    dropped: string[];
}

/** Removes any cited ID that the tools never returned (hallucinated citations). */
export function filterCitations(citations: DecisionOutput["citations"], sources: KnownSources): CitationCheck {
    const dropped: string[] = [];

    let policyId = citations.policy_id;
    if (policyId !== null && !sources.policyIds.has(policyId)) {
        dropped.push(`policy_id ${policyId}`);
        policyId = null;
    }

    let policyNumber = citations.policy_number;
    if (policyNumber !== null && !sources.policyNumbers.has(policyNumber)) {
        dropped.push(`policy_number ${policyNumber}`);
        policyNumber = null;
    }

    const ruleIds: number[] = [];
    for (const ruleId of citations.coverage_rule_ids) {
        if (sources.coverageRuleIds.has(ruleId)) {
            if (!ruleIds.includes(ruleId)) ruleIds.push(ruleId);
        } else {
            dropped.push(`coverage_rule_id ${ruleId}`);
        }
    }

    return {
        citations: { policy_id: policyId, policy_number: policyNumber, coverage_rule_ids: ruleIds },
        dropped,
    };
}

/** Safe default used whenever the model output cannot be trusted. */
export function fallbackDecision(reason: string): ClaimDecision {
    return {
        decision: "flag",
        reasoning: `Automatic decision unavailable: ${reason}. Routed for manual review.`,
        confidence_score: 0,
        citations: { policy_id: null, policy_number: null, coverage_rule_ids: [] },
        fallback: true,
    };
}

