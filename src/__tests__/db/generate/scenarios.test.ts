import { DescriptionTemplate, RULE_CATALOG, UNCOVERED_DAMAGE } from "../../../db/generate/catalog";
import {
    ExistingRule,
    MISMATCH_MAX_RATIO,
    MISMATCH_MIN_RATIO,
    GeneratedClaim,
    GeneratedDataset,
    GeneratedPolicy,
    SCENARIO_IDS,
    createRng,
    generateDataset,
} from "../../../db/generate/scenarios";

/** The three rules src/db/seed.ts inserts. */
const SEEDED_RULES: ExistingRule[] = [
    { policy_type: "auto", damage_type: "collision", max_coverage_amount: 50000, conditions: "Requires police report if over $1000" },
    { policy_type: "auto", damage_type: "glass", max_coverage_amount: 1000, conditions: "No deductible" },
    { policy_type: "home", damage_type: "water_damage", max_coverage_amount: 100000, conditions: "Not covered for floods, only internal leaks" },
];

function limitOf(claim: GeneratedClaim, existing: readonly ExistingRule[] = []): number {
    const db = existing.find((r) => r.policy_type === claim.policy_type && r.damage_type === claim.damage_type);
    if (db) return db.max_coverage_amount;
    const catalog = RULE_CATALOG.find((r) => r.policy_type === claim.policy_type && r.damage_type === claim.damage_type);
    if (!catalog) throw new Error(`No rule for ${claim.policy_type}/${claim.damage_type}`);
    return catalog.max_coverage_amount;
}

function catalogRuleOf(claim: GeneratedClaim) {
    const rule = RULE_CATALOG.find((r) => r.policy_type === claim.policy_type && r.damage_type === claim.damage_type);
    if (!rule) throw new Error(`No catalog rule for ${claim.policy_type}/${claim.damage_type}`);
    return rule;
}

/** The fixed text a template always starts with: the common prefix of many renderings. */
function staticPrefix(template: DescriptionTemplate): string {
    const renderings = Array.from({ length: 30 }, (_, seed) => template(createRng(seed)));
    let prefix = renderings[0];
    for (const text of renderings) {
        while (!text.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    return prefix;
}
function isFrom(description: string, templates: readonly DescriptionTemplate[]): boolean {
    return templates.some((t) => description.startsWith(staticPrefix(t)));
}

/** Every description template of one damage category (rule or uncovered damage type). */
function categoryTemplates(policyType: string, damageType: string): DescriptionTemplate[] {
    const rule = RULE_CATALOG.find((r) => r.policy_type === policyType && r.damage_type === damageType);
    if (rule) return [...rule.minor, ...rule.major, ...rule.exclusion, ...rule.uncertainEvidence, ...rule.uncertainCause];
    const uncovered = UNCOVERED_DAMAGE.find((d) => d.policy_type === policyType && d.damage_type === damageType);
    if (uncovered) return [...uncovered.descriptions];
    throw new Error(`Unknown damage category ${policyType}/${damageType}`);
}

const LOW_CONFIDENCE_SCENARIOS = ["contradictory_damage", "uncertain_evidence", "uncertain_cause", "amount_mismatch"] as const;

function claimsOf(scenario: string, count = 300, seeds: readonly number[] = [1, 2, 3]): GeneratedClaim[] {
    return seeds.flatMap((seed) =>
        generateDataset({ claimCount: count, seed, existingRules: SEEDED_RULES }).claims.filter((c) => c.scenario === scenario)
    );
}

function policyOf(dataset: GeneratedDataset, claim: GeneratedClaim): GeneratedPolicy {
    const policy = dataset.policies.find((p) => p.policy_number === claim.policy_number);
    if (!policy) throw new Error(`Missing policy ${claim.policy_number}`);
    return policy;
}

describe("createRng", () => {
    it("is deterministic per seed and stays in range", () => {
        const a = createRng(42);
        const b = createRng(42);
        const values = Array.from({ length: 100 }, () => a.next());
        expect(Array.from({ length: 100 }, () => b.next())).toEqual(values);
        expect(values.every((v) => v >= 0 && v < 1)).toBe(true);

        const r = createRng(1);
        for (let i = 0; i < 500; i++) {
            const n = r.int(3, 5);
            expect(n).toBeGreaterThanOrEqual(3);
            expect(n).toBeLessThanOrEqual(5);
        }
    });

    it("differs between seeds", () => {
        expect(createRng(1).next()).not.toEqual(createRng(2).next());
    });
});

describe("generateDataset", () => {
    it("returns the same dataset for the same seed", () => {
        const options = { claimCount: 30, seed: 7, existingRules: SEEDED_RULES, takenPolicyNumbers: ["POL-AUTO-12345"] };
        expect(generateDataset(options)).toEqual(generateDataset(options));
    });

    it("returns a different dataset for a different seed", () => {
        expect(generateDataset({ claimCount: 10, seed: 1 }).claims).not.toEqual(
            generateDataset({ claimCount: 10, seed: 2 }).claims
        );
    });

    it.each([SCENARIO_IDS.length, SCENARIO_IDS.length + 1, 20])("represents every scenario when n = %i >= the number of scenarios", (n) => {
        for (const seed of [1, 2, 3, 99]) {
            const scenarios = new Set(generateDataset({ claimCount: n, seed }).claims.map((c) => c.scenario));
            expect([...scenarios].sort()).toEqual([...SCENARIO_IDS].sort());
        }
    });

    it("generates exactly the requested number of claims, one new policy each", () => {
        const dataset = generateDataset({ claimCount: 25, seed: 3 });
        expect(dataset.claims).toHaveLength(25);
        expect(dataset.policies).toHaveLength(25);
        expect(new Set(dataset.policies.map((p) => p.policy_number)).size).toBe(25);
        for (const claim of dataset.claims) {
            expect(policyOf(dataset, claim).type).toBe(claim.policy_type);
        }
    });

    it("keeps amounts consistent with each scenario", () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            const dataset = generateDataset({ claimCount: 60, seed, existingRules: SEEDED_RULES });
            for (const claim of dataset.claims) {
                expect(claim.claim_amount).toBeGreaterThan(0);
                expect(Number(claim.claim_amount.toFixed(2))).toBe(claim.claim_amount);
                if (claim.scenario === "no_rule") {
                    expect(claim.max_coverage_amount).toBeNull();
                    continue;
                }
                const max = limitOf(claim, SEEDED_RULES);
                expect(claim.max_coverage_amount).toBe(max);
                if (claim.scenario === "over_limit") expect(claim.claim_amount).toBeGreaterThan(max);
                else if (claim.scenario === "at_limit") expect(claim.claim_amount).toBe(max);
                else expect(claim.claim_amount).toBeLessThan(max);
            }
        }
    });

    it("uses inactive policies for inactive_policy claims and active ones otherwise", () => {
        const dataset = generateDataset({ claimCount: 60, seed: 11 });
        for (const claim of dataset.claims) {
            const status = policyOf(dataset, claim).status;
            if (claim.scenario === "inactive_policy") expect(["inactive", "lapsed"]).toContain(status);
            else expect(status).toBe("active");
        }
    });

    it("uses damage types without a rule for no_rule claims", () => {
        const dataset = generateDataset({ claimCount: 60, seed: 5, existingRules: SEEDED_RULES });
        const ruleKeys = new Set(RULE_CATALOG.map((r) => `${r.policy_type}/${r.damage_type}`));
        const noRule = dataset.claims.filter((c) => c.scenario === "no_rule");
        expect(noRule.length).toBeGreaterThan(0);
        for (const claim of noRule) {
            expect(ruleKeys.has(`${claim.policy_type}/${claim.damage_type}`)).toBe(false);
        }
    });

    it("keeps collision exclusion claims above the $1000 police-report threshold", () => {
        const dataset = generateDataset({ claimCount: 200, seed: 8 });
        const collisions = dataset.claims.filter((c) => c.scenario === "exclusion" && c.damage_type === "collision");
        expect(collisions.length).toBeGreaterThan(0);
        for (const claim of collisions) expect(claim.claim_amount).toBeGreaterThan(1000);
    });

    it("never mentions scenario names or expected outcomes in descriptions", () => {
        const forbidden = [
            ...SCENARIO_IDS,
            ...SCENARIO_IDS.map((id) => id.replace(/_/g, " ")),
            "inactive",
            "lapsed",
            "exclusion",
            "excluded",
            "ambiguous",
            "uncertain",
            "contradict",
            "mismatch",
            "evidence",
            "approve",
            "reject",
            "scenario",
            "limit",
        ];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            for (const claim of generateDataset({ claimCount: 100, seed }).claims) {
                const text = claim.description.toLowerCase();
                for (const word of forbidden) expect(text).not.toContain(word);
            }
        }
    });

    it("can tell every description template apart by its fixed opening text", () => {
        const all = [
            ...RULE_CATALOG.flatMap((r) => [...r.minor, ...r.major, ...r.exclusion, ...r.uncertainEvidence, ...r.uncertainCause]),
            ...UNCOVERED_DAMAGE.flatMap((d) => d.descriptions),
        ].map(staticPrefix);
        for (const [i, a] of all.entries()) {
            expect(a.length).toBeGreaterThanOrEqual(15);
            for (const [j, b] of all.entries()) if (i !== j) expect(b.startsWith(a)).toBe(false);
        }
    });

    it.each(LOW_CONFIDENCE_SCENARIOS)("produces %s claims with an active policy, a rule and an amount under the limit", (scenario) => {
        for (const seed of [1, 2, 3]) {
            const dataset = generateDataset({ claimCount: 200, seed, existingRules: SEEDED_RULES });
            const claims = dataset.claims.filter((c) => c.scenario === scenario);
            expect(claims.length).toBeGreaterThan(0);
            for (const claim of claims) {
                expect(policyOf(dataset, claim).status).toBe("active");
                expect(claim.max_coverage_amount).toBe(limitOf(claim, SEEDED_RULES));
                expect(claim.claim_amount).toBeLessThan(limitOf(claim, SEEDED_RULES));
            }
        }
    });

    it("describes contradictory_damage claims with another damage category's templates", () => {
        const claims = claimsOf("contradictory_damage");
        expect(claims.length).toBeGreaterThan(0);
        const describedAs = new Set<string>();
        for (const claim of claims) {
            expect(claim.described_damage_type).not.toBe(claim.damage_type);
            describedAs.add(claim.described_damage_type);
            expect(isFrom(claim.description, categoryTemplates(claim.policy_type, claim.described_damage_type))).toBe(true);
            expect(isFrom(claim.description, categoryTemplates(claim.policy_type, claim.damage_type))).toBe(false);
        }
        expect(describedAs.size).toBeGreaterThan(2);
    });

    it("describes every other claim with its own damage category", () => {
        for (const claim of generateDataset({ claimCount: 300, seed: 4, existingRules: SEEDED_RULES }).claims) {
            if (claim.scenario === "contradictory_damage") continue;
            expect(claim.described_damage_type).toBe(claim.damage_type);
            expect(isFrom(claim.description, categoryTemplates(claim.policy_type, claim.damage_type))).toBe(true);
        }
    });

    it("uses evidence-unsure descriptions for uncertain_evidence, above the evidence threshold", () => {
        const claims = claimsOf("uncertain_evidence");
        expect(claims.length).toBeGreaterThan(0);
        for (const claim of claims) {
            const rule = catalogRuleOf(claim);
            expect(isFrom(claim.description, rule.uncertainEvidence)).toBe(true);
            expect(claim.claim_amount).toBeGreaterThanOrEqual(rule.uncertainEvidenceMinAmount ?? 0);
            if (claim.damage_type === "collision") expect(claim.claim_amount).toBeGreaterThan(1000);
        }
        expect(claims.some((c) => c.damage_type === "collision")).toBe(true);
    });

    it("uses cause-unsure descriptions for uncertain_cause", () => {
        const claims = claimsOf("uncertain_cause");
        expect(claims.length).toBeGreaterThan(0);
        for (const claim of claims) expect(isFrom(claim.description, catalogRuleOf(claim).uncertainCause)).toBe(true);
        expect(claims.some((c) => c.damage_type === "water_damage")).toBe(true);
    });

    it("states a figure clearly below claim_amount in amount_mismatch descriptions", () => {
        const claims = claimsOf("amount_mismatch");
        expect(claims.length).toBeGreaterThan(0);
        for (const claim of claims) {
            const figures = [...claim.description.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
            expect(figures).toHaveLength(1);
            const ratio = figures[0] / claim.claim_amount;
            expect(ratio).toBeGreaterThanOrEqual(MISMATCH_MIN_RATIO - 0.01);
            expect(ratio).toBeLessThanOrEqual(MISMATCH_MAX_RATIO + 0.01);
        }
    });

    it("skips the uncertain scenarios for a rule whose conditions were changed in the database", () => {
        const changed: ExistingRule[] = RULE_CATALOG.map((r) => ({
            policy_type: r.policy_type,
            damage_type: r.damage_type,
            max_coverage_amount: r.max_coverage_amount,
            conditions: "Changed",
        }));
        const scenarios = new Set(generateDataset({ claimCount: 200, seed: 3, existingRules: changed }).claims.map((c) => c.scenario));
        expect(scenarios.has("uncertain_evidence")).toBe(false);
        expect(scenarios.has("uncertain_cause")).toBe(false);
        expect(scenarios.has("exclusion")).toBe(false);
        expect(scenarios.has("contradictory_damage")).toBe(true);
        expect(scenarios.has("amount_mismatch")).toBe(true);
    });

    it("only returns catalog rules missing from the database", () => {
        const fresh = generateDataset({ claimCount: 1, seed: 1 });
        expect(fresh.rules).toHaveLength(RULE_CATALOG.length);

        const seeded = generateDataset({ claimCount: 1, seed: 1, existingRules: SEEDED_RULES });
        const keys = seeded.rules.map((r) => `${r.policy_type}/${r.damage_type}`);
        expect(keys).toHaveLength(RULE_CATALOG.length - SEEDED_RULES.length);
        expect(keys).not.toContain("auto/collision");
        expect(keys).toContain("home/fire");
    });

    it("never returns a rule for an uncovered damage type", () => {
        const keys = new Set(generateDataset({ claimCount: 5, seed: 1 }).rules.map((r) => `${r.policy_type}/${r.damage_type}`));
        for (const d of UNCOVERED_DAMAGE) expect(keys.has(`${d.policy_type}/${d.damage_type}`)).toBe(false);
    });

    it("uses the database limit when an existing rule differs from the catalog", () => {
        const custom: ExistingRule[] = [
            { policy_type: "auto", damage_type: "glass", max_coverage_amount: 2500, conditions: "No deductible" },
        ];
        const dataset = generateDataset({ claimCount: 200, seed: 4, existingRules: custom });
        const glass = dataset.claims.filter((c) => c.damage_type === "glass");
        expect(glass.length).toBeGreaterThan(0);
        for (const claim of glass) {
            expect(claim.max_coverage_amount).toBe(2500);
            if (claim.scenario === "at_limit") expect(claim.claim_amount).toBe(2500);
        }
    });

    it("skips exclusion texts for a rule whose conditions were changed in the database", () => {
        const changed: ExistingRule[] = [
            { policy_type: "home", damage_type: "water_damage", max_coverage_amount: 100000, conditions: "Floods are covered" },
        ];
        const dataset = generateDataset({ claimCount: 300, seed: 9, existingRules: changed });
        expect(dataset.claims.some((c) => c.scenario === "exclusion" && c.damage_type === "water_damage")).toBe(false);
    });

    it("skips no_rule when every uncovered damage type already has a rule", () => {
        const existing: ExistingRule[] = UNCOVERED_DAMAGE.map((d) => ({
            policy_type: d.policy_type,
            damage_type: d.damage_type,
            max_coverage_amount: 1000,
            conditions: null,
        }));
        const dataset = generateDataset({ claimCount: 50, seed: 2, existingRules: existing });
        expect(dataset.claims.some((c) => c.scenario === "no_rule")).toBe(false);
        expect(dataset.claims).toHaveLength(50);
    });

    it("avoids policy numbers that are already taken", () => {
        const first = generateDataset({ claimCount: 20, seed: 1 });
        const taken = first.policies.map((p) => p.policy_number);
        const second = generateDataset({ claimCount: 20, seed: 1, takenPolicyNumbers: taken });
        for (const policy of second.policies) {
            expect(taken).not.toContain(policy.policy_number);
            expect(policy.policy_number).toMatch(/^POL-(AUTO|HOME|TRAVEL)-\d{5}$/);
        }
    });

    it("rejects an invalid claim count", () => {
        expect(() => generateDataset({ claimCount: -1, seed: 1 })).toThrow(/claimCount/);
        expect(() => generateDataset({ claimCount: 1.5, seed: 1 })).toThrow(/claimCount/);
    });
});
