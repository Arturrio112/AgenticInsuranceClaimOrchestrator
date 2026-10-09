export const createTables = `
CREATE TABLE IF NOT EXISTS policies (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    policy_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL,
    type VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coverage_rules (
    id SERIAL PRIMARY KEY,
    policy_type VARCHAR(100) NOT NULL,
    damage_type VARCHAR(100) NOT NULL,
    max_coverage_amount DECIMAL(12, 2) NOT NULL,
    conditions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS claims (
    id SERIAL PRIMARY KEY,
    policy_id INTEGER REFERENCES policies(id),
    claim_amount DECIMAL(12, 2) NOT NULL,
    damage_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL, -- pending, approved, flagged, rejected
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Append-only audit trail of every step the agent took while processing a claim.
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    claim_id INTEGER REFERENCES claims(id),
    run_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- node_start, node_end, llm_start, llm_end, tool_start, tool_end, error
    node_name VARCHAR(255),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_claim_created ON audit_logs (claim_id, created_at);

-- Reject UPDATE/DELETE so the trail is immutable. TRUNCATE (used by seeds/tests) does not fire row-level triggers.
CREATE OR REPLACE FUNCTION audit_logs_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
`;

export interface Policy {
    id: number;
    user_id: string;
    policy_number: string;
    status: string;
    type: string;
    created_at: Date;
}

export interface CoverageRule {
    id: number;
    policy_type: string;
    damage_type: string;
    max_coverage_amount: number;
    conditions: string;
    created_at: Date;
}

export interface Claim {
    id: number;
    policy_id: number;
    claim_amount: number;
    damage_type: string;
    status: string;
    description: string;
    created_at: Date;
}


/** Any value that survives a JSON round-trip, as stored in a JSONB column. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AuditEventType =
    | 'node_start'
    | 'node_end'
    | 'llm_start'
    | 'llm_end'
    | 'tool_start'
    | 'tool_end'
    | 'error';

export interface AuditLog {
    id: number;
    claim_id: number | null;
    run_id: string;
    step_index: number;
    event_type: AuditEventType;
    node_name: string | null;
    payload: JsonValue;
    created_at: Date;
}
