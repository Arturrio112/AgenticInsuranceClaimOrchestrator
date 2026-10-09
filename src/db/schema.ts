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
    status VARCHAR(50) NOT NULL, -- pending, approved, rejected, flagged, needs_human_review
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Structured AI decision (Tickets 7.1, 8.1, 8.2). ADD COLUMN IF NOT EXISTS keeps existing DBs migratable.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS ai_decision VARCHAR(20);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS decision_reasoning TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS confidence_score INTEGER;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS cited_policy_id INTEGER;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS cited_rule_ids INTEGER[];
ALTER TABLE claims ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
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

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'flagged', 'needs_human_review'] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export interface Claim {
    id: number;
    policy_id: number;
    claim_amount: number;
    damage_type: string;
    status: ClaimStatus;
    description: string;
    created_at: Date;
    /** Raw AI verdict, kept even when the status is `needs_human_review`. */
    ai_decision: 'approve' | 'reject' | 'flag' | null;
    decision_reasoning: string | null;
    /** 0-100. */
    confidence_score: number | null;
    cited_policy_id: number | null;
    cited_rule_ids: number[] | null;
    decided_at: Date | null;
}

