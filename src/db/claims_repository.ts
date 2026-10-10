import { query } from "./client";
import type { ClaimStatus } from "./schema";
import type { ClaimSummary } from "../api/types";

/** Raw row shape returned by the claim summary query. */
export interface ClaimSummaryRow {
    id: number;
    policy_number: string | null;
    policy_type: string | null;
    /** pg returns DECIMAL columns as strings. */
    claim_amount: string | number;
    damage_type: string;
    status: ClaimStatus;
    description: string | null;
    /** pg returns TIMESTAMP columns as Date objects. */
    created_at: Date | string;
}

const CLAIM_SUMMARY_SELECT = `
    SELECT c.id, p.policy_number, p.type AS policy_type, c.claim_amount, c.damage_type,
           c.status, c.description, c.created_at
    FROM claims c
    LEFT JOIN policies p ON p.id = c.policy_id`;

/** Converts a DB row into the API's `ClaimSummary` (DECIMAL -> number, Date -> ISO 8601). */
export function toClaimSummary(row: ClaimSummaryRow): ClaimSummary {
    return {
        id: row.id,
        policy_number: row.policy_number,
        policy_type: row.policy_type,
        claim_amount: Number(row.claim_amount),
        damage_type: row.damage_type,
        status: row.status,
        description: row.description,
        created_at: new Date(row.created_at).toISOString(),
    };
}

/** All claims joined with their policy, ordered by id ascending. */
export async function listClaims(): Promise<ClaimSummary[]> {
    const result = await query(`${CLAIM_SUMMARY_SELECT} ORDER BY c.id ASC`);
    return (result.rows as ClaimSummaryRow[]).map(toClaimSummary);
}

/** A single claim joined with its policy, or `null` if it does not exist. */
export async function getClaimById(id: number): Promise<ClaimSummary | null> {
    const result = await query(`${CLAIM_SUMMARY_SELECT} WHERE c.id = $1`, [id]);
    const row = result.rows[0] as ClaimSummaryRow | undefined;
    return row ? toClaimSummary(row) : null;
}
