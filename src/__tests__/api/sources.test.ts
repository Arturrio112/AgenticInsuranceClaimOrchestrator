import { resolveDecisionSources } from "../../api/sources";
import type { CoverageRuleSource, PolicySource } from "../../api/types";
import { getCoverageRulesByIds, getPolicyById, getPolicyByNumber } from "../../db/sources_repository";

jest.mock("../../db/sources_repository", () => ({
    getPolicyById: jest.fn(),
    getPolicyByNumber: jest.fn(),
    getCoverageRulesByIds: jest.fn(),
}));

const mockGetPolicyById = getPolicyById as jest.MockedFunction<typeof getPolicyById>;
const mockGetPolicyByNumber = getPolicyByNumber as jest.MockedFunction<typeof getPolicyByNumber>;
const mockGetRules = getCoverageRulesByIds as jest.MockedFunction<typeof getCoverageRulesByIds>;

const POLICY: PolicySource = { id: 1, policy_number: "POL-AUTO-12345", status: "active", type: "auto" };
const RULE: CoverageRuleSource = {
    id: 1,
    policy_type: "auto",
    damage_type: "collision",
    max_coverage_amount: 50000,
    conditions: "Requires police report if over $1000",
};

describe("resolveDecisionSources", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetRules.mockResolvedValue([RULE]);
    });

    it("resolves the policy by id and the coverage rules", async () => {
        mockGetPolicyById.mockResolvedValue(POLICY);

        const sources = await resolveDecisionSources({
            policy_id: 1,
            policy_number: "POL-AUTO-12345",
            coverage_rule_ids: [1],
        });

        expect(sources).toEqual({ policy: POLICY, coverage_rules: [RULE] });
        expect(mockGetPolicyByNumber).not.toHaveBeenCalled();
        expect(mockGetRules).toHaveBeenCalledWith([1]);
    });

    it("falls back to the policy number when the id is unknown", async () => {
        mockGetPolicyById.mockResolvedValue(null);
        mockGetPolicyByNumber.mockResolvedValue(POLICY);

        const sources = await resolveDecisionSources({ policy_id: 77, policy_number: "POL-AUTO-12345", coverage_rule_ids: [] });

        expect(sources.policy).toEqual(POLICY);
        expect(mockGetPolicyByNumber).toHaveBeenCalledWith("POL-AUTO-12345");
    });

    it("falls back to the policy number when there is no id", async () => {
        mockGetPolicyByNumber.mockResolvedValue(POLICY);

        const sources = await resolveDecisionSources({ policy_id: null, policy_number: "POL-AUTO-12345", coverage_rule_ids: [] });

        expect(sources.policy).toEqual(POLICY);
        expect(mockGetPolicyById).not.toHaveBeenCalled();
    });

    it("returns a null policy when nothing is cited or nothing resolves", async () => {
        mockGetRules.mockResolvedValue([]);

        await expect(
            resolveDecisionSources({ policy_id: null, policy_number: null, coverage_rule_ids: [] })
        ).resolves.toEqual({ policy: null, coverage_rules: [] });

        mockGetPolicyById.mockResolvedValue(null);
        mockGetPolicyByNumber.mockResolvedValue(null);
        const sources = await resolveDecisionSources({ policy_id: 5, policy_number: "POL-GONE", coverage_rule_ids: [9] });
        expect(sources).toEqual({ policy: null, coverage_rules: [] });
    });
});
