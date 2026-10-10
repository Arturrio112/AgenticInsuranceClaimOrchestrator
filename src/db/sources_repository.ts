import { query } from "./client";
import type { CoverageRuleSource, PolicySource } from "../api/types";

/** Raw row shape for a policy source. */
export interface PolicySourceRow {
    id: number;
    policy_number: string;
    status: string;
    type: string;
}

/** Raw row shape for a coverage rule source. */
export interface CoverageRuleSourceRow {
    id: number;
    policy_type: string;
    damage_type: string;
    /** pg returns DECIMAL columns as strings. */
    max_coverage_amount: string | number;
    conditions: string | null;
}

export function toPolicySource(row: PolicySourceRow): PolicySource {
    return { id: row.id, policy_number: row.policy_number, status: row.status, type: row.type };
}

export function toCoverageRuleSource(row: CoverageRuleSourceRow): CoverageRuleSource {
    return {
        id: row.id,
        policy_type: row.policy_type,
        damage_type: row.damage_type,
        max_coverage_amount: Number(row.max_coverage_amount),
        conditions: row.conditions,
    };
}

const POLICY_SELECT = "SELECT id, policy_number, status, type FROM policies";

export async function getPolicyById(id: number): Promise<PolicySource | null> {
    const result = await query(`${POLICY_SELECT} WHERE id = $1`, [id]);
    const row = result.rows[0] as PolicySourceRow | undefined;
    return row ? toPolicySource(row) : null;
}

export async function getPolicyByNumber(policyNumber: string): Promise<PolicySource | null> {
    const result = await query(`${POLICY_SELECT} WHERE policy_number = $1`, [policyNumber]);
    const row = result.rows[0] as PolicySourceRow | undefined;
    return row ? toPolicySource(row) : null;
}

/**
 * Coverage rules for the given IDs, in the order the IDs were given.
 * IDs that do not exist are omitted; duplicates are returned once.
 */
export async function getCoverageRulesByIds(ids: number[]): Promise<CoverageRuleSource[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];

    const result = await query(
        `SELECT id, policy_type, damage_type, max_coverage_amount, conditions
         FROM coverage_rules
         WHERE id = ANY($1::int[])`,
        [uniqueIds]
    );
    const byId = new Map<number, CoverageRuleSource>();
    for (const row of result.rows as CoverageRuleSourceRow[]) {
        byId.set(row.id, toCoverageRuleSource(row));
    }
    return uniqueIds.flatMap((id) => {
        const rule = byId.get(id);
        return rule ? [rule] : [];
    });
}
