import { GeneratedDataset } from "../../../db/generate/scenarios";
import { formatSummary } from "../../../db/generate/summary";
import { Queryable, readSnapshot, writeDataset } from "../../../db/generate/writer";

interface QueryResult {
    rows: unknown[];
    rowCount: number | null;
}

interface RecordedCall {
    text: string;
    params?: unknown[];
}

function mockDb(responses: QueryResult[]): { db: Queryable; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const queue = [...responses];
    const db: Queryable = {
        query: async (text: string, params?: unknown[]) => {
            calls.push({ text, params });
            return queue.shift() ?? { rows: [], rowCount: 0 };
        },
    };
    return { db, calls };
}

/** Responses for DATASET: two policy inserts, one rule insert, two claim inserts. */
function happyPath(ruleRowCount: number): QueryResult[] {
    return [
        { rows: [{ id: 10 }], rowCount: 1 },
        { rows: [{ id: 11 }], rowCount: 1 },
        { rows: [], rowCount: ruleRowCount },
        { rows: [{ id: 100 }], rowCount: 1 },
        { rows: [{ id: 101 }], rowCount: 1 },
    ];
}

const DATASET: GeneratedDataset = {
    seed: 1,
    policies: [
        { user_id: "user_1", policy_number: "POL-HOME-11111", status: "active", type: "home" },
        { user_id: "user_2", policy_number: "POL-AUTO-22222", status: "lapsed", type: "auto" },
    ],
    rules: [{ policy_type: "home", damage_type: "fire", max_coverage_amount: 250000, conditions: "Some condition" }],
    claims: [
        {
            policy_number: "POL-HOME-11111",
            policy_type: "home",
            damage_type: "fire",
            claim_amount: 1234.5,
            description: "Kitchen fire",
            described_damage_type: "fire",
            scenario: "covered",
            max_coverage_amount: 250000,
        },
        {
            policy_number: "POL-AUTO-22222",
            policy_type: "auto",
            damage_type: "glass",
            claim_amount: 300,
            description: "Cracked windshield",
            described_damage_type: "mechanical_breakdown",
            scenario: "inactive_policy",
            max_coverage_amount: 1000,
        },
    ],
};

describe("generator writer", () => {
    it("reads existing rules (DECIMAL -> number) and policy numbers", async () => {
        const { db } = mockDb([
            { rows: [{ policy_type: "auto", damage_type: "glass", max_coverage_amount: "1000.00", conditions: null }], rowCount: 1 },
            { rows: [{ policy_number: "POL-AUTO-12345" }], rowCount: 1 },
        ]);
        await expect(readSnapshot(db)).resolves.toEqual({
            existingRules: [{ policy_type: "auto", damage_type: "glass", max_coverage_amount: 1000, conditions: null }],
            takenPolicyNumbers: ["POL-AUTO-12345"],
        });
    });

    it("only inserts: no UPDATE, DELETE or TRUNCATE", async () => {
        const { db, calls } = mockDb(happyPath(1));
        const result = await writeDataset(db, DATASET);

        expect(calls).toHaveLength(5);
        for (const call of calls) {
            expect(call.text).toMatch(/^\s*INSERT/);
            expect(call.text).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
        }
        expect(calls[0].text).toMatch(/ON CONFLICT \(policy_number\) DO NOTHING/);
        expect(calls[2].text).toMatch(/WHERE NOT EXISTS/);
        expect(result.policiesInserted).toBe(2);
        expect(result.rulesInserted).toBe(1);
        expect(result.claims.map((c) => c.id)).toEqual([100, 101]);
    });

    it("links claims to their new policy ids, inserts them as pending and never stores the scenario or described damage type", async () => {
        const { db, calls } = mockDb(happyPath(0));
        const result = await writeDataset(db, DATASET);
        expect(result.rulesInserted).toBe(0);

        const claimCalls = calls.filter((c) => c.text.includes("INSERT INTO claims"));
        expect(claimCalls.map((c) => c.params)).toEqual([
            [10, "1234.50", "fire", "Kitchen fire"],
            [11, "300.00", "glass", "Cracked windshield"],
        ]);
        expect(claimCalls[0].text).toContain("'pending'");
        for (const call of calls) expect(JSON.stringify(call.params)).not.toMatch(/covered|inactive_policy|mechanical_breakdown/);
    });

    it("fails loudly when a policy number was taken concurrently", async () => {
        const { db } = mockDb([{ rows: [], rowCount: 0 }]);
        await expect(writeDataset(db, DATASET)).rejects.toThrow(/POL-HOME-11111 was taken/);
    });

    it("summarises counts and lists every claim with its scenario", async () => {
        const { db } = mockDb(happyPath(1));
        const summary = formatSummary(await writeDataset(db, DATASET), 1);
        expect(summary).toContain("Inserted 2 policies, 1 coverage rules, 2 pending claims (seed 1)");
        expect(summary).toMatch(/100\s+POL-HOME-11111\s+home\s+fire\s+\$1,234\.50\s+\$250,000\.00\s+covered/);
        expect(summary).toMatch(/101\s+POL-AUTO-22222\s+auto\s+glass\s+\$300\.00\s+\$1,000\.00\s+inactive_policy/);
        expect(summary).not.toMatch(/^\s+no_rule/m);
    });

    it("tells the reader to expect human review for the low-confidence scenarios", () => {
        const claim = { ...DATASET.claims[0], id: 7, scenario: "uncertain_cause" as const };
        const summary = formatSummary({ policiesInserted: 1, rulesInserted: 0, claims: [claim] }, 3);
        expect(summary).toMatch(/uncertain_cause\s+.*-> expect: low confidence -> needs_human_review/);
    });
});
