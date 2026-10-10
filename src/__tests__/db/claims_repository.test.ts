import { query } from "../../db/client";
import { getClaimById, listClaims, toClaimSummary, ClaimSummaryRow } from "../../db/claims_repository";

jest.mock("../../db/client", () => ({
    query: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

function mockRows(rows: ClaimSummaryRow[]): void {
    mockQuery.mockResolvedValueOnce({ rows } as unknown as Awaited<ReturnType<typeof query>>);
}

const ROW: ClaimSummaryRow = {
    id: 1,
    policy_number: "POL-AUTO-12345",
    policy_type: "auto",
    claim_amount: "1500.50",
    damage_type: "collision",
    status: "pending",
    description: "Fender bender",
    created_at: new Date("2026-01-02T03:04:05.000Z"),
};

describe("claims_repository", () => {
    beforeEach(() => jest.clearAllMocks());

    describe("toClaimSummary", () => {
        it("converts DECIMAL strings to numbers and Dates to ISO strings", () => {
            expect(toClaimSummary(ROW)).toEqual({
                id: 1,
                policy_number: "POL-AUTO-12345",
                policy_type: "auto",
                claim_amount: 1500.5,
                damage_type: "collision",
                status: "pending",
                description: "Fender bender",
                created_at: "2026-01-02T03:04:05.000Z",
            });
        });

        it("keeps nulls for a claim without a policy or description", () => {
            const summary = toClaimSummary({
                ...ROW,
                policy_number: null,
                policy_type: null,
                description: null,
                claim_amount: 42,
                created_at: "2026-01-02T03:04:05Z",
            });
            expect(summary).toMatchObject({
                policy_number: null,
                policy_type: null,
                description: null,
                claim_amount: 42,
                created_at: "2026-01-02T03:04:05.000Z",
            });
        });
    });

    describe("listClaims", () => {
        it("joins policies, orders by id and converts every row", async () => {
            mockRows([ROW, { ...ROW, id: 2, claim_amount: "10.00" }]);

            const claims = await listClaims();

            expect(claims.map((c) => [c.id, c.claim_amount])).toEqual([[1, 1500.5], [2, 10]]);
            const [sql, params] = mockQuery.mock.calls[0];
            expect(sql).toMatch(/LEFT JOIN policies p ON p\.id = c\.policy_id/);
            expect(sql).toMatch(/ORDER BY c\.id ASC/);
            expect(params).toBeUndefined();
        });

        it("returns an empty list when there are no claims", async () => {
            mockRows([]);
            await expect(listClaims()).resolves.toEqual([]);
        });
    });

    describe("getClaimById", () => {
        it("uses a parameterized query and returns the converted claim", async () => {
            mockRows([ROW]);

            const claim = await getClaimById(1);

            expect(claim?.claim_amount).toBe(1500.5);
            expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/WHERE c\.id = \$1/), [1]);
        });

        it("returns null when the claim does not exist", async () => {
            mockRows([]);
            await expect(getClaimById(99)).resolves.toBeNull();
        });
    });
});
