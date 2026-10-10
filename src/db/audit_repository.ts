import { query } from './client';
import { AuditEventType, AuditLog, JsonValue } from './schema';

/**
 * Data access for the append-only `audit_logs` table.
 * Only insert and read operations are exposed on purpose; the database also
 * rejects UPDATE/DELETE via the `audit_logs_append_only` trigger.
 */

export interface NewAuditLog {
    claim_id: number;
    run_id: string;
    step_index: number;
    event_type: AuditEventType;
    node_name: string | null;
    payload: JsonValue;
}

const AUDIT_COLUMNS = 'id, claim_id, run_id, step_index, event_type, node_name, payload, created_at';

export async function insertAuditLog(entry: NewAuditLog): Promise<AuditLog> {
    const result = await query(
        `INSERT INTO audit_logs (claim_id, run_id, step_index, event_type, node_name, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING ${AUDIT_COLUMNS}`,
        [
            entry.claim_id,
            entry.run_id,
            entry.step_index,
            entry.event_type,
            entry.node_name,
            JSON.stringify(entry.payload),
        ]
    );
    return result.rows[0] as AuditLog;
}

/** Returns every audit entry for a claim in the order the events happened. */
export async function getAuditLogsForClaim(claimId: number): Promise<AuditLog[]> {
    const result = await query(
        `SELECT ${AUDIT_COLUMNS} FROM audit_logs
         WHERE claim_id = $1
         ORDER BY created_at ASC, id ASC`,
        [claimId]
    );
    return result.rows as AuditLog[];
}
