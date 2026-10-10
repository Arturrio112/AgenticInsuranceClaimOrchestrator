import type { DecisionCitations, DecisionSources, PolicySource } from "./types";
import { getCoverageRulesByIds, getPolicyById, getPolicyByNumber } from "../db/sources_repository";

/**
 * Resolves a decision's citation IDs to full DB rows (Ticket 7.2, "Source of Truth").
 * The policy is looked up by `policy_id`, falling back to `policy_number`.
 * Cited IDs that do not exist are silently dropped.
 */
export async function resolveDecisionSources(citations: DecisionCitations): Promise<DecisionSources> {
    const [policy, coverageRules] = await Promise.all([
        resolvePolicy(citations),
        getCoverageRulesByIds(citations.coverage_rule_ids),
    ]);
    return { policy, coverage_rules: coverageRules };
}

async function resolvePolicy(citations: DecisionCitations): Promise<PolicySource | null> {
    if (citations.policy_id !== null) {
        const byId = await getPolicyById(citations.policy_id);
        if (byId) return byId;
    }
    if (citations.policy_number !== null) {
        return getPolicyByNumber(citations.policy_number);
    }
    return null;
}
