import { buildDecisionSystemPrompt, confidencePenalty } from "../../agent/prompts";

describe("confidencePenalty", () => {
    it("is 40 points for the default threshold of 70", () => {
        expect(confidencePenalty(70)).toBe(40);
    });

    it("always puts a claim with one problem below the threshold", () => {
        for (let threshold = 11; threshold <= 100; threshold++) {
            expect(100 - confidencePenalty(threshold)).toBeLessThan(threshold);
        }
    });

    it("stays within 10-100 points", () => {
        expect(confidencePenalty(0)).toBe(100);
        expect(confidencePenalty(100)).toBe(10);
    });
});

describe("buildDecisionSystemPrompt", () => {
    const prompt = buildDecisionSystemPrompt(70);

    it("keeps the decision rules and the citation guard", () => {
        expect(prompt).toContain('1. "reject"');
        expect(prompt).toContain('2. "flag"');
        expect(prompt).toContain('3. "approve"');
        expect(prompt).toContain("Never invent IDs");
    });

    it("gives a start-at-100 checklist with a fixed deduction per problem", () => {
        expect(prompt).toContain("Start at 100");
        for (const problem of [
            "A. -40: the description describes a different kind of damage",
            "B. -40: a condition of the coverage rule requires evidence",
            "C. -40: the cause could fall under an exclusion",
            "D. -40: the description states a money figure",
            "E. -20: the description is too vague",
        ]) {
            expect(prompt).toContain(problem);
        }
    });

    it("spells out the resulting scores so the model does not have to do arithmetic", () => {
        expect(prompt).toContain("- no problems: 100");
        expect(prompt).toContain("- only E: 80");
        expect(prompt).toContain("- one of A, B, C, D: 60");
        expect(prompt).toContain("- one of A, B, C, D plus E: 40");
        expect(prompt).toContain("- two or more of A, B, C, D: 20");
    });

    it("keeps clear-cut decisions, including rejections, at high confidence", () => {
        expect(prompt).toContain("Keep confidence_score at 90-100");
        expect(prompt).toContain("the policy is not active (reject)");
        expect(prompt).toContain("no coverage rule exists for the damage type (reject)");
        expect(prompt).toContain("Being certain that a claim must be rejected or flagged is still high confidence");
    });

    it("states the configured threshold and scales the deduction with it", () => {
        expect(prompt).toContain("If the result is below 70, the claim goes to a human reviewer");
        const strict = buildDecisionSystemPrompt(85);
        expect(strict).toContain("If the result is below 85, the claim goes to a human reviewer");
        expect(strict).toContain("A. -25:");
    });
});
