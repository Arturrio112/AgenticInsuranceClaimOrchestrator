import { EvalResult, formatEvalReport, meetsExpectation, rollup } from "../../evals/decision/report";

function result(overrides: Partial<EvalResult>): EvalResult {
    return {
        claim_id: 1,
        scenario: "covered",
        policy_type: "auto",
        damage_type: "glass",
        claim_amount: 300,
        max_coverage_amount: 1000,
        decision: "approve",
        confidence_score: 95,
        status: "approved",
        fallback: false,
        seconds: 12,
        ...overrides,
    };
}

describe("meetsExpectation", () => {
    it("wants clear-cut scenarios at or above the threshold", () => {
        expect(meetsExpectation(result({ scenario: "covered", confidence_score: 70 }), 70)).toBe(true);
        expect(meetsExpectation(result({ scenario: "inactive_policy", confidence_score: 69 }), 70)).toBe(false);
    });

    it("wants uncertain scenarios below the threshold", () => {
        expect(meetsExpectation(result({ scenario: "uncertain_cause", confidence_score: 45 }), 70)).toBe(true);
        expect(meetsExpectation(result({ scenario: "amount_mismatch", confidence_score: 70 }), 70)).toBe(false);
    });

    it("never counts a missing decision as a hit", () => {
        expect(meetsExpectation(result({ scenario: "uncertain_cause", confidence_score: null }), 70)).toBe(false);
    });
});

describe("rollup", () => {
    it("groups by scenario in catalog order and counts verdicts and hits", () => {
        const groups = rollup(
            [
                result({ claim_id: 1, scenario: "contradictory_damage", decision: "flag", confidence_score: 40 }),
                result({ claim_id: 2, scenario: "covered" }),
                result({ claim_id: 3, scenario: "contradictory_damage", decision: "approve", confidence_score: 90 }),
                result({ claim_id: 4, scenario: "contradictory_damage", decision: "flag", confidence_score: 0, fallback: true }),
            ],
            70
        );
        expect(groups.map((g) => g.scenario)).toEqual(["covered", "contradictory_damage"]);
        expect(groups[1]).toEqual({
            scenario: "contradictory_damage",
            claims: 3,
            expect: "low",
            verdicts: "flag x1, approve x1, flag(fallback) x1",
            scores: [40, 90, 0],
            hits: 2,
        });
    });
});

describe("formatEvalReport", () => {
    it("prints per-claim rows, the scenario roll-up and both pass rates", () => {
        const report = formatEvalReport(
            [
                result({ claim_id: 5, scenario: "covered" }),
                result({ claim_id: 6, scenario: "uncertain_evidence", decision: "flag", confidence_score: 85, status: "flagged" }),
                result({ claim_id: 7, scenario: "uncertain_evidence", decision: null, confidence_score: null, status: null, error: "boom" }),
            ],
            70
        );
        expect(report).toMatch(/5\s+covered\s+auto\/glass\s+300\.00\s+1000\.00\s+approve\s+95\s+approved\s+ok\s+12/);
        expect(report).toMatch(/6\s+uncertain_evidence\s+.*flag\s+85\s+flagged\s+MISS/);
        expect(report).toMatch(/uncertain_evidence\s+2\s+< 70\s+flag x1, error x1\s+85\s+0\/2/);
        expect(report).toContain("Uncertain scenarios below 70 (needs_human_review): 0/2");
        expect(report).toContain("Clear-cut scenarios at or above 70: 1/1");
        expect(report).toContain("claim 7: boom");
    });
});
