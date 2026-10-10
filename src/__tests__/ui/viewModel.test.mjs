/**
 * Unit tests for the web UI's pure presentation module (public/js/view-model.mjs).
 *
 * The UI ships as browser ES modules with no build step, so this test is plain
 * ESM too and runs under Jest's native ESM support (NODE_OPTIONS=--experimental-vm-modules
 * is already set by `npm test`). No transform is involved.
 */
import {
    CONFIDENCE_THRESHOLD,
    PIPELINE_STAGES,
    activeStageIndex,
    claimCounts,
    claimLine,
    confidenceBand,
    coverageRuleCard,
    formatCurrency,
    formatDate,
    formatElapsed,
    humanize,
    isResolutionResponse,
    policyCard,
    sortClaims,
    sourceOfTruth,
    statusMeta,
    thresholdOf,
    verdictSummary,
} from "../../../public/js/view-model.mjs";

/** @returns {import("../../../public/js/view-model.mjs").ClaimSummary} */
function claim(overrides = {}) {
    return {
        id: 1,
        policy_number: "POL-HOME-67890",
        policy_type: "home",
        claim_amount: 5000,
        damage_type: "water_damage",
        status: "pending",
        description: "Burst pipe in kitchen",
        created_at: "2026-10-01T09:30:00.000Z",
        ...overrides,
    };
}

function response(overrides = {}, decisionOverrides = {}) {
    return {
        claim_id: 2,
        status: "approved",
        summary: "Investigation complete.",
        decision: {
            decision: "approve",
            reasoning: "Policy is active and the amount is within the limit.",
            confidence_score: 92,
            fallback: false,
            citations: { policy_id: 2, policy_number: "POL-HOME-67890", coverage_rule_ids: [3] },
            ...decisionOverrides,
        },
        claim: claim({ id: 2, status: "approved" }),
        sources: {
            policy: { id: 2, policy_number: "POL-HOME-67890", status: "active", type: "home" },
            coverage_rules: [
                { id: 3, policy_type: "home", damage_type: "water_damage", max_coverage_amount: 100000, conditions: "Not covered for floods, only internal leaks" },
            ],
        },
        ...overrides,
    };
}

describe("statusMeta", () => {
    it.each([
        ["pending", "Pending", "neutral", "clock"],
        ["approved", "Approved", "positive", "check"],
        ["rejected", "Rejected", "negative", "cross"],
        ["flagged", "Flagged", "caution", "flag"],
        ["needs_human_review", "Needs human review", "review", "person"],
    ])("maps %s to a label, tone and icon", (status, label, tone, icon) => {
        const meta = statusMeta(status);
        expect(meta.label).toBe(label);
        expect(meta.tone).toBe(tone);
        expect(meta.icon).toBe(icon);
    });

    it("falls back to a neutral badge for unknown statuses", () => {
        expect(statusMeta("on_hold")).toMatchObject({ label: "On hold", tone: "neutral" });
    });
});

describe("formatting", () => {
    it("humanizes snake_case", () => {
        expect(humanize("water_damage")).toBe("Water damage");
        expect(humanize(null)).toBe("");
    });

    it("formats currency, dropping cents on whole amounts and accepting DECIMAL strings", () => {
        expect(formatCurrency(1500)).toBe("$1,500");
        expect(formatCurrency("100000.00")).toBe("$100,000");
        expect(formatCurrency(99.5)).toBe("$99.50");
        expect(formatCurrency("not a number")).toBe("Unknown amount");
    });

    it("formats dates in UTC and tolerates bad input", () => {
        expect(formatDate("2026-10-01T09:30:00.000Z")).toBe("Oct 1, 2026");
        expect(formatDate("nope")).toBe("");
    });

    it("formats elapsed time as m:ss", () => {
        expect(formatElapsed(0)).toBe("0:00");
        expect(formatElapsed(65_400)).toBe("1:05");
    });

    it("describes a claim in one line", () => {
        expect(claimLine(claim())).toBe("Water damage on home policy");
        expect(claimLine(claim({ policy_type: null }))).toBe("Water damage on unknown policy");
    });
});

describe("claim list helpers", () => {
    it("sorts newest first, ignoring status so rows stay put after a run", () => {
        const sorted = sortClaims([
            claim({ id: 1, status: "approved" }),
            claim({ id: 2, status: "pending" }),
            claim({ id: 3, status: "needs_human_review" }),
            claim({ id: 4, status: "pending" }),
        ]);
        expect(sorted.map((c) => c.id)).toEqual([4, 3, 2, 1]);
    });

    it("counts claims by what still needs attention", () => {
        const counts = claimCounts([
            claim({ status: "pending" }),
            claim({ status: "needs_human_review" }),
            claim({ status: "approved" }),
            claim({ status: "rejected" }),
        ]);
        expect(counts.text).toBe("1 pending, 1 needs review, 2 resolved");
    });
});

describe("confidenceBand", () => {
    it("uses the default threshold of 70", () => {
        expect(CONFIDENCE_THRESHOLD).toBe(70);
    });

    it("marks scores below the threshold as low and explains the consequence", () => {
        const band = confidenceBand(62);
        expect(band).toMatchObject({ value: 62, below: true, band: "low" });
        expect(band.explanation).toMatch(/person needs to review/);
    });

    it("treats a score equal to the threshold as auto-applied", () => {
        expect(confidenceBand(70)).toMatchObject({ below: false, band: "moderate" });
    });

    it("marks scores well above the threshold as high", () => {
        expect(confidenceBand(92).band).toBe("high");
    });

    it("clamps and rounds out-of-range input", () => {
        expect(confidenceBand(140).value).toBe(100);
        expect(confidenceBand(-5).value).toBe(0);
        expect(confidenceBand(71.6).value).toBe(72);
        expect(confidenceBand(null).value).toBe(0);
    });

    it("honours a custom threshold", () => {
        expect(confidenceBand(80, 85).below).toBe(true);
    });
});

describe("thresholdOf", () => {
    it("prefers the threshold returned by the API", () => {
        expect(thresholdOf(response({ confidence_threshold: 85 }))).toBe(85);
    });

    it("falls back to the default when the field is missing or invalid", () => {
        expect(thresholdOf(response())).toBe(CONFIDENCE_THRESHOLD);
        expect(thresholdOf(response({ confidence_threshold: "85" }))).toBe(CONFIDENCE_THRESHOLD);
    });
});

describe("verdictSummary", () => {
    it("explains an auto-applied decision", () => {
        const summary = verdictSummary(response());
        expect(summary.label).toBe("Approved");
        expect(summary.tone).toBe("positive");
    });

    it("explains why a confident-enough decision was not applied", () => {
        const summary = verdictSummary(response({ status: "needs_human_review" }, { decision: "reject", confidence_score: 55 }));
        expect(summary.label).toBe("Needs human review");
        expect(summary.sentence).toBe(
            "The agent leaned towards rejecting this claim, but its confidence (55) is below 70, so a person needs to make the call.",
        );
        expect(summary.agentVerdict).toBe("Reject");
    });

    it("uses the threshold the API reports", () => {
        const summary = verdictSummary(
            response({ status: "needs_human_review", confidence_threshold: 85 }, { decision: "approve", confidence_score: 80 }),
        );
        expect(summary.sentence).toBe(
            "The agent leaned towards approving this claim, but its confidence (80) is below 85, so a person needs to make the call.",
        );
    });

    it("explains the fallback path", () => {
        const summary = verdictSummary(response({ status: "needs_human_review" }, { decision: "flag", confidence_score: 0, fallback: true }));
        expect(summary.sentence).toMatch(/could not produce a usable decision/);
    });
});

describe("source of truth cards", () => {
    it("renders a coverage rule in plain language", () => {
        const card = coverageRuleCard({ id: 3, policy_type: "home", damage_type: "water_damage", max_coverage_amount: "10000.00", conditions: "Internal leaks only" });
        expect(`${card.title}: ${card.body}`).toBe("Rule #3: Home policy, water damage, covered up to $10,000.");
        expect(card.conditions).toBe("Conditions: Internal leaks only");
    });

    it("says when a rule has no conditions", () => {
        expect(coverageRuleCard({ id: 2, policy_type: "auto", damage_type: "glass", max_coverage_amount: 1000, conditions: null }).conditions).toBe(
            "No extra conditions.",
        );
    });

    it("renders a policy card", () => {
        expect(policyCard({ id: 2, policy_number: "POL-HOME-67890", status: "active", type: "home" })).toEqual({
            id: 2,
            title: "Policy POL-HOME-67890",
            body: "Active home policy.",
            active: true,
        });
    });

    it("lists cited rules first and reports cited IDs without details", () => {
        const sot = sourceOfTruth(
            response({
                sources: {
                    policy: null,
                    coverage_rules: [
                        { id: 1, policy_type: "auto", damage_type: "collision", max_coverage_amount: 50000, conditions: null },
                        { id: 3, policy_type: "home", damage_type: "water_damage", max_coverage_amount: 100000, conditions: null },
                    ],
                },
            }, { citations: { policy_id: 2, policy_number: "POL-HOME-67890", coverage_rule_ids: [3, 9] } }),
        );
        expect(sot.rules.map((r) => [r.id, r.cited])).toEqual([[3, true], [1, false]]);
        expect(sot.missingRuleIds).toEqual([9]);
        expect(sot.policyNote).toBe("The agent cited policy POL-HOME-67890, but its details are not available.");
        expect(sot.empty).toBe(false);
    });

    it("handles a response without sources (older API)", () => {
        const sot = sourceOfTruth(response({ sources: undefined }, { citations: { policy_id: null, policy_number: null, coverage_rule_ids: [] } }));
        expect(sot.empty).toBe(true);
        expect(sot.policyNote).toBe("The agent did not cite a policy.");
        expect(sot.rulesNote).toBe("The agent did not cite any coverage rules.");
    });
});

describe("pipeline progress", () => {
    it("has the five stages in order", () => {
        expect(PIPELINE_STAGES.map((s) => s.label)).toEqual(["Load claim", "Check policy", "Check coverage", "Decide", "Save"]);
    });

    it("advances with time but never past Decide on its own", () => {
        expect(activeStageIndex(0)).toBe(0);
        expect(activeStageIndex(5_000)).toBe(1);
        expect(activeStageIndex(15_000)).toBe(2);
        expect(activeStageIndex(10 * 60_000)).toBe(3);
    });
});

describe("isResolutionResponse", () => {
    it("accepts a valid response and rejects error bodies", () => {
        expect(isResolutionResponse(response())).toBe(true);
        expect(isResolutionResponse({ error: "Claim 9 not found" })).toBe(false);
        expect(isResolutionResponse(null)).toBe(false);
    });
});
