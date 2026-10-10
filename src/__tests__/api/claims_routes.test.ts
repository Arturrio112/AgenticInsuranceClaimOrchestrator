import request from "supertest";
import { AIMessage } from "@langchain/core/messages";
import { app } from "../../api/webhook";
import { parseClaimId } from "../../api/routes/claims";
import { resolveDecisionSources } from "../../api/sources";
import type { ClaimDecision, ClaimSummary, DecisionSources } from "../../api/types";
import { app as graphApp } from "../../agent/graph";
import { signToken } from "../../auth/jwt";
import { getClaimById, listClaims } from "../../db/claims_repository";

// Keep the LLM and database out of these tests entirely.
jest.mock("../../agent/graph", () => ({
    app: { invoke: jest.fn() },
}));
jest.mock("../../db/claims_repository", () => ({
    listClaims: jest.fn(),
    getClaimById: jest.fn(),
}));
jest.mock("../../api/sources", () => ({
    resolveDecisionSources: jest.fn(),
}));

const mockListClaims = listClaims as jest.MockedFunction<typeof listClaims>;
const mockGetClaimById = getClaimById as jest.MockedFunction<typeof getClaimById>;
const mockResolveSources = resolveDecisionSources as jest.MockedFunction<typeof resolveDecisionSources>;
const mockInvoke = graphApp.invoke as jest.Mock;

const ORIGINAL_ENV = { ...process.env };

const CLAIM: ClaimSummary = {
    id: 1,
    policy_number: "POL-AUTO-12345",
    policy_type: "auto",
    claim_amount: 1500,
    damage_type: "collision",
    status: "approved",
    description: "Fender bender",
    created_at: "2026-01-02T03:04:05.000Z",
};

function authHeader(): string {
    return `Bearer ${signToken({ sub: "test-user" })}`;
}

describe("claims routes", () => {
    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV, JWT_SECRET: "claims-test-secret" };
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    describe("parseClaimId", () => {
        it.each([
            ["1", 1],
            ["42", 42],
            ["0", null],
            ["-1", null],
            ["1.5", null],
            ["abc", null],
            ["1e3", null],
            ["99999999999999999999", null],
        ])("parses %s as %s", (raw, expected) => {
            expect(parseClaimId(raw)).toBe(expected);
        });
    });

    describe("GET /claims", () => {
        it("requires a valid token", async () => {
            await request(app).get("/claims").expect(401);
            await request(app).get("/claims").set("Authorization", "Bearer not-a-token").expect(401);
            expect(mockListClaims).not.toHaveBeenCalled();
        });

        it("returns the claims list", async () => {
            mockListClaims.mockResolvedValue([CLAIM, { ...CLAIM, id: 2, status: "pending" }]);

            const response = await request(app).get("/claims").set("Authorization", authHeader()).expect(200);

            expect(response.body).toEqual({ claims: [CLAIM, { ...CLAIM, id: 2, status: "pending" }] });
        });

        it("returns 500 when the database fails", async () => {
            mockListClaims.mockRejectedValue(new Error("db down"));

            const response = await request(app).get("/claims").set("Authorization", authHeader()).expect(500);
            expect(response.body.error).toMatch(/listing claims/);
        });
    });

    describe("GET /claims/:id", () => {
        it("requires a valid token", async () => {
            await request(app).get("/claims/1").expect(401);
            expect(mockGetClaimById).not.toHaveBeenCalled();
        });

        it.each(["abc", "0", "-3", "1.5"])("returns 400 for id %s", async (id) => {
            const response = await request(app).get(`/claims/${id}`).set("Authorization", authHeader()).expect(400);
            expect(response.body).toEqual({ error: "Claim id must be a positive integer" });
            expect(mockGetClaimById).not.toHaveBeenCalled();
        });

        it("returns 404 for an unknown claim", async () => {
            mockGetClaimById.mockResolvedValue(null);

            const response = await request(app).get("/claims/99").set("Authorization", authHeader()).expect(404);
            expect(response.body).toEqual({ error: "Claim 99 not found" });
        });

        it("returns the claim", async () => {
            mockGetClaimById.mockResolvedValue(CLAIM);

            const response = await request(app).get("/claims/1").set("Authorization", authHeader()).expect(200);

            expect(response.body).toEqual(CLAIM);
            expect(mockGetClaimById).toHaveBeenCalledWith(1);
        });

        it("returns 500 when the database fails", async () => {
            mockGetClaimById.mockRejectedValue(new Error("db down"));
            await request(app).get("/claims/1").set("Authorization", authHeader()).expect(500);
        });
    });

    describe("POST /claim response", () => {
        const DECISION: ClaimDecision = {
            decision: "approve",
            reasoning: "Covered.",
            confidence_score: 92,
            citations: { policy_id: 1, policy_number: "POL-AUTO-12345", coverage_rule_ids: [1] },
            fallback: false,
        };
        const SOURCES: DecisionSources = {
            policy: { id: 1, policy_number: "POL-AUTO-12345", status: "active", type: "auto" },
            coverage_rules: [
                { id: 1, policy_type: "auto", damage_type: "collision", max_coverage_amount: 50000, conditions: null },
            ],
        };

        it("includes the persisted claim and the resolved sources", async () => {
            mockInvoke.mockResolvedValue({
                claim: { id: 1 },
                decision: DECISION,
                claim_status: "approved",
                confidence_threshold: 70,
                messages: [new AIMessage("Investigation complete.")],
            });
            mockGetClaimById.mockResolvedValue(CLAIM);
            mockResolveSources.mockResolvedValue(SOURCES);

            const response = await request(app)
                .post("/claim")
                .set("Authorization", authHeader())
                .send({ claim_id: 1 })
                .expect(200);

            expect(response.body).toEqual({
                claim_id: 1,
                status: "approved",
                decision: DECISION,
                summary: "Investigation complete.",
                claim: CLAIM,
                sources: SOURCES,
                confidence_threshold: 70,
            });
            expect(mockResolveSources).toHaveBeenCalledWith(DECISION.citations);
        });

        it("returns 500 if the claim cannot be re-read after persistence", async () => {
            mockInvoke.mockResolvedValue({
                claim: { id: 1 },
                decision: DECISION,
                claim_status: "approved",
                confidence_threshold: 70,
                messages: [],
            });
            mockGetClaimById.mockResolvedValue(null);
            mockResolveSources.mockResolvedValue(SOURCES);

            await request(app).post("/claim").set("Authorization", authHeader()).send({ claim_id: 1 }).expect(500);
        });
    });
});
