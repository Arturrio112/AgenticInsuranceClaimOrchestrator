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

