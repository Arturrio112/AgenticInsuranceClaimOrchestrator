import { query } from "../../db/client";
import { ClaimStatus } from "../../db/schema";
import { logger } from "../../utils/logger";
import { ClaimContext, GraphStateType } from "../state";

interface ClaimRow {
    id: number;
    policy_id: number;
    policy_number: string | null;
    claim_amount: string | number;
    damage_type: string;
    status: ClaimStatus;
    description: string | null;
}

/**
 * Loads the claim (joined with its policy number) into graph state before the
 * agent runs. Doing this deterministically, instead of exposing a `get_claim`
 * tool, guarantees the facts are present even if a small local model forgets
 * to call a tool, and saves one LLM round trip.
 */
export async function loadClaimNode(
    state: GraphStateType
): Promise<{ claim: ClaimContext | null; policy_number?: string }> {
    const result = await query(
        `SELECT c.id, c.policy_id, p.policy_number, c.claim_amount, c.damage_type, c.status, c.description
         FROM claims c
         LEFT JOIN policies p ON p.id = c.policy_id
         WHERE c.id = $1`,
        [state.claim_id]
    );

    const row = result.rows[0] as ClaimRow | undefined;
    if (!row) {
        logger.warn("Claim not found", { claim_id: state.claim_id });
        return { claim: null };
    }

    const claim: ClaimContext = {
        id: row.id,
        policy_id: row.policy_id,
        policy_number: row.policy_number,
        // pg returns DECIMAL columns as strings
        claim_amount: Number(row.claim_amount),
        damage_type: row.damage_type,
        status: row.status,
        description: row.description,
    };

    return { claim, policy_number: claim.policy_number ?? undefined };
}
