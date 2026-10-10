import type { ClaimStatus } from "../db/schema";
import type { ClaimDecision, DecisionCitations, DecisionVerdict } from "../agent/decision";

export type { ClaimStatus, ClaimDecision, DecisionCitations, DecisionVerdict };

/** Request body for `POST /claim`. */
export interface ClaimRequest {
    claim_id?: number | string;
}

/**
 * Response body for `POST /claim`. Shared with the web UI.
 *
 * `status` is the status written to the DB. It equals the mapped `decision.decision`
 * (approve -> approved, reject -> rejected, flag -> flagged) unless
 * `decision.confidence_score` is below CONFIDENCE_THRESHOLD, in which case it is
 * `needs_human_review`.
 */
export interface ClaimResolutionResponse {
    claim_id: number;
    status: ClaimStatus;
    decision: ClaimDecision;
    /** The agent's free-text summary of its investigation. */
    summary: string;
}

export interface ErrorResponse {
    error: string;
}
