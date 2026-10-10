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
    /** The claim AFTER persistence (reflects the updated status). */
    claim: ClaimSummary;
    /** `decision.citations` resolved to full DB rows. Unknown IDs are silently dropped. */
    sources: DecisionSources;
    /** The CONFIDENCE_THRESHOLD (0-100) applied when choosing `status`. */
    confidence_threshold: number;
}

/**
 * A claim joined with its policy, as returned by `GET /claims`, `GET /claims/:id`
 * and `POST /claim`. Shared with the web UI.
 */
export interface ClaimSummary {
    id: number;
    policy_number: string | null;
    policy_type: string | null;
    /** pg returns DECIMAL as a string; the API always converts it to a number. */
    claim_amount: number;
    damage_type: string;
    status: ClaimStatus;
    description: string | null;
    /** ISO 8601 timestamp. */
    created_at: string;
}

/** Response body for `GET /claims` (ordered by id ascending). */
export interface ClaimListResponse {
    claims: ClaimSummary[];
}

/** A cited policy, resolved from the DB ("source of truth", Ticket 7.2). */
export interface PolicySource {
    id: number;
    policy_number: string;
    status: string;
    type: string;
}

/** A cited coverage rule, resolved from the DB. */
export interface CoverageRuleSource {
    id: number;
    policy_type: string;
    damage_type: string;
    max_coverage_amount: number;
    conditions: string | null;
}

/** The decision's citations resolved to full DB rows. */
export interface DecisionSources {
    policy: PolicySource | null;
    coverage_rules: CoverageRuleSource[];
}

export interface ErrorResponse {
    error: string;
}
