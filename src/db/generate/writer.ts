/**
 * Append-only database writer for the test-data generator.
 * Only SELECTs and INSERTs: it never updates, deletes or truncates.
 */
import { createTables } from "../schema";
import type { ExistingRule, GeneratedClaim, GeneratedDataset } from "./scenarios";

/** The subset of `pg` Pool / PoolClient the writer needs, so tests can pass a mock. */
export interface Queryable {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface DbSnapshot {
    existingRules: ExistingRule[];
    takenPolicyNumbers: string[];
}

export interface InsertedClaim extends GeneratedClaim {
    id: number;
}

export interface WriteResult {
    policiesInserted: number;
    rulesInserted: number;
    claims: InsertedClaim[];
}

interface RuleRow {
    policy_type: string;
    damage_type: string;
    /** pg returns DECIMAL columns as strings. */
    max_coverage_amount: string | number;
    conditions: string | null;
}

interface IdRow {
    id: number;
}

/** Creates any missing tables (all statements use IF NOT EXISTS). */
export async function ensureSchema(db: Queryable): Promise<void> {
    await db.query(createTables);
}

/** Reads what the generator needs to stay consistent with the current data. */
export async function readSnapshot(db: Queryable): Promise<DbSnapshot> {
    const rules = await db.query(
        "SELECT policy_type, damage_type, max_coverage_amount, conditions FROM coverage_rules ORDER BY id ASC"
    );
    const policies = await db.query("SELECT policy_number FROM policies");
    return {
        existingRules: (rules.rows as RuleRow[]).map((row) => ({
            policy_type: row.policy_type,
            damage_type: row.damage_type,
            max_coverage_amount: Number(row.max_coverage_amount),
            conditions: row.conditions,
        })),
        takenPolicyNumbers: (policies.rows as Array<{ policy_number: string }>).map((row) => row.policy_number),
    };
}

/**
 * Inserts the dataset. Policies use ON CONFLICT DO NOTHING and fail loudly if a
 * number was taken in the meantime; rules are only inserted when no rule for
 * the same (policy_type, damage_type) exists. Run it inside a transaction.
 */
export async function writeDataset(db: Queryable, dataset: GeneratedDataset): Promise<WriteResult> {
    const policyIds = new Map<string, number>();
    for (const policy of dataset.policies) {
        const result = await db.query(
            `INSERT INTO policies (user_id, policy_number, status, type) VALUES ($1, $2, $3, $4)
             ON CONFLICT (policy_number) DO NOTHING
             RETURNING id`,
            [policy.user_id, policy.policy_number, policy.status, policy.type]
        );
        const row = result.rows[0] as IdRow | undefined;
        if (row === undefined) {
            throw new Error(`Policy number ${policy.policy_number} was taken concurrently; run the generator again`);
        }
        policyIds.set(policy.policy_number, row.id);
    }

    let rulesInserted = 0;
    for (const rule of dataset.rules) {
        const result = await db.query(
            `INSERT INTO coverage_rules (policy_type, damage_type, max_coverage_amount, conditions)
             SELECT $1::varchar, $2::varchar, $3::numeric, $4::text
             WHERE NOT EXISTS (
                 SELECT 1 FROM coverage_rules WHERE policy_type = $1::varchar AND damage_type = $2::varchar
             )`,
            [rule.policy_type, rule.damage_type, rule.max_coverage_amount.toFixed(2), rule.conditions]
        );
        rulesInserted += result.rowCount ?? 0;
    }

    const claims: InsertedClaim[] = [];
    for (const claim of dataset.claims) {
        const policyId = policyIds.get(claim.policy_number);
        if (policyId === undefined) throw new Error(`No policy generated for ${claim.policy_number}`);
        const result = await db.query(
            `INSERT INTO claims (policy_id, claim_amount, damage_type, status, description)
             VALUES ($1, $2, $3, 'pending', $4)
             RETURNING id`,
            [policyId, claim.claim_amount.toFixed(2), claim.damage_type, claim.description]
        );
        claims.push({ ...claim, id: (result.rows[0] as IdRow).id });
    }

    return { policiesInserted: policyIds.size, rulesInserted, claims };
}
