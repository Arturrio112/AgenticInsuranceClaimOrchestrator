import { persistNode, resolveFinalStatus } from "../../agent/nodes/persist_node";
import { getConfidenceThreshold } from "../../agent/config";
import { ClaimDecision } from "../../agent/decision";
import { GraphStateType } from "../../agent/state";
import { query } from "../../db/client";

jest.mock("../../db/client", () => ({ query: jest.fn() }));
jest.mock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function decision(overrides: Partial<ClaimDecision> = {}): ClaimDecision {
    return {
        decision: "approve",
        reasoning: "Covered.",
        confidence_score: 90,
        citations: { policy_id: 1, policy_number: "POL-AUTO-12345", coverage_rule_ids: [1] },
        fallback: false,
        ...overrides,
    };
}

function state(d: ClaimDecision | null): GraphStateType {
    return {
        messages: [],
        claim_id: 5,
        policy_number: "POL-AUTO-12345",
        claim: null,
        decision: d,
        claim_status: "pending",
    };
}

describe("getConfidenceThreshold", () => {
    it("defaults to 70", () => {
        expect(getConfidenceThreshold({})).toBe(70);
    });

    it("reads CONFIDENCE_THRESHOLD from env", () => {
        expect(getConfidenceThreshold({ CONFIDENCE_THRESHOLD: "85" })).toBe(85);
    });

    it("ignores invalid values", () => {
        expect(getConfidenceThreshold({ CONFIDENCE_THRESHOLD: "abc" })).toBe(70);
        expect(getConfidenceThreshold({ CONFIDENCE_THRESHOLD: "150" })).toBe(70);
    });
});

describe("resolveFinalStatus", () => {
    it.each([
        ["approve", "approved"],
        ["reject", "rejected"],
        ["flag", "flagged"],
    ] as const)("maps a confident %s to %s", (verdict, status) => {
        expect(resolveFinalStatus(decision({ decision: verdict, confidence_score: 80 }), 70)).toBe(status);
    });

    it("routes low confidence to needs_human_review regardless of verdict", () => {
        for (const verdict of ["approve", "reject", "flag"] as const) {
            expect(resolveFinalStatus(decision({ decision: verdict, confidence_score: 69 }), 70)).toBe("needs_human_review");
        }
    });

    it("treats a score equal to the threshold as confident", () => {
        expect(resolveFinalStatus(decision({ confidence_score: 70 }), 70)).toBe("approved");
    });
});

describe("persist node", () => {
    const originalThreshold = process.env.CONFIDENCE_THRESHOLD;

    beforeEach(() => {
        jest.clearAllMocks();
        (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
        delete process.env.CONFIDENCE_THRESHOLD;
    });

    afterAll(() => {
        if (originalThreshold === undefined) delete process.env.CONFIDENCE_THRESHOLD;
        else process.env.CONFIDENCE_THRESHOLD = originalThreshold;
    });

    it("writes the status and decision data to the claims row", async () => {
        const update = await persistNode(state(decision()));

        expect(update.claim_status).toBe("approved");
        const [sql, params] = (query as jest.Mock).mock.calls[0];
        expect(sql).toContain("UPDATE claims");
        expect(sql).toContain("decided_at = NOW()");
        expect(params).toEqual(["approved", "approve", "Covered.", 90, 1, [1], 5]);
    });

    it("uses CONFIDENCE_THRESHOLD from env", async () => {
        process.env.CONFIDENCE_THRESHOLD = "95";

        const update = await persistNode(state(decision({ confidence_score: 90 })));

        expect(update.claim_status).toBe("needs_human_review");
        expect((query as jest.Mock).mock.calls[0][1][0]).toBe("needs_human_review");
    });

    it("persists a safe fallback when no decision exists", async () => {
        const update = await persistNode(state(null));

        expect(update.claim_status).toBe("needs_human_review");
        expect(update.decision).toMatchObject({ decision: "flag", confidence_score: 0, fallback: true });
    });
});
