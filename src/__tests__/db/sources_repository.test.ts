import { query } from "../../db/client";
import {
    CoverageRuleSourceRow,
    PolicySourceRow,
    getCoverageRulesByIds,
    getPolicyById,
    getPolicyByNumber,
    toCoverageRuleSource,
} from "../../db/sources_repository";

jest.mock("../../db/client", () => ({
    query: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

function mockRows(rows: Array<PolicySourceRow | CoverageRuleSourceRow>): void {
    mockQuery.mockResolvedValueOnce({ rows } as unknown as Awaited<ReturnType<typeof query>>);
}

const POLICY: PolicySourceRow = { id: 1, policy_number: "POL-AUTO-12345", status: "active", type: "auto" };

function rule(id: number, amount: string): CoverageRuleSourceRow {
    return { id, policy_type: "auto", damage_type: "collision", max_coverage_amount: amount, conditions: null };
}

describe("sources_repository", () => {
    beforeEach(() => jest.clearAllMocks());

    it("converts max_coverage_amount from DECIMAL string to number", () => {
        expect(toCoverageRuleSource(rule(3, "50000.00"))).toEqual({
            id: 3,
            policy_type: "auto",
            damage_type: "collision",
            max_coverage_amount: 50000,
            conditions: null,
        });
    });

    it("getPolicyById returns only the public policy fields", async () => {
        mockRows([{ ...POLICY, user_id: "secret-user" } as PolicySourceRow]);

        await expect(getPolicyById(1)).resolves.toEqual(POLICY);
        expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/WHERE id = \$1/), [1]);
    });

    it("getPolicyById returns null for an unknown id", async () => {
        mockRows([]);
        await expect(getPolicyById(42)).resolves.toBeNull();
    });

    it("getPolicyByNumber uses a parameterized query", async () => {
        mockRows([POLICY]);

        await expect(getPolicyByNumber("POL-AUTO-12345")).resolves.toEqual(POLICY);
        expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/WHERE policy_number = \$1/), ["POL-AUTO-12345"]);
    });

    it("getCoverageRulesByIds keeps citation order, dedupes and drops unknown ids", async () => {
        mockRows([rule(1, "100.00"), rule(3, "300.50")]);

        const rules = await getCoverageRulesByIds([3, 999, 1, 3]);

        expect(rules.map((r) => [r.id, r.max_coverage_amount])).toEqual([[3, 300.5], [1, 100]]);
        expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/ANY\(\$1::int\[\]\)/), [[3, 999, 1]]);
    });

    it("getCoverageRulesByIds skips the query for an empty list", async () => {
        await expect(getCoverageRulesByIds([])).resolves.toEqual([]);
        expect(mockQuery).not.toHaveBeenCalled();
    });
});
