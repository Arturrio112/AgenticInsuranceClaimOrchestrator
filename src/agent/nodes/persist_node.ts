import { query } from "../../db/client";
import { ClaimStatus } from "../../db/schema";
import { logger } from "../../utils/logger";
import { getConfidenceThreshold } from "../config";
import { ClaimDecision, DecisionVerdict, fallbackDecision } from "../decision";
import { GraphStateType } from "../state";

const VERDICT_TO_STATUS: Record<DecisionVerdict, ClaimStatus> = {
    approve: "approved",
    reject: "rejected",
    flag: "flagged",
};

/**
 * Human-in-the-loop routing (Ticket 8.2): any decision below the confidence
 * threshold goes to `needs_human_review`, whatever the verdict was.
 */
export function resolveFinalStatus(decision: ClaimDecision, threshold: number): ClaimStatus {
    if (decision.confidence_score < threshold) {
        return "needs_human_review";
    }
    return VERDICT_TO_STATUS[decision.decision];
}

/** Writes the final status and the structured decision to the `claims` row. */
export async function persistNode(
    state: GraphStateType
): Promise<{ claim_status: ClaimStatus; decision: ClaimDecision; confidence_threshold: number }> {
    const decision = state.decision ?? fallbackDecision("no decision was produced");
    const threshold = getConfidenceThreshold();
    const status = resolveFinalStatus(decision, threshold);

    await query(
        `UPDATE claims
         SET status = $1,
             ai_decision = $2,
             decision_reasoning = $3,
             confidence_score = $4,
             cited_policy_id = $5,
             cited_rule_ids = $6,
             decided_at = NOW()
         WHERE id = $7`,
        [
            status,
            decision.decision,
            decision.reasoning,
            decision.confidence_score,
            decision.citations.policy_id,
            decision.citations.coverage_rule_ids,
            state.claim_id,
        ]
    );

    logger.info("Claim decision persisted", {
        claim_id: state.claim_id,
        status,
        decision: decision.decision,
        confidence_score: decision.confidence_score,
        threshold,
    });

    return { claim_status: status, decision, confidence_threshold: threshold };
}
