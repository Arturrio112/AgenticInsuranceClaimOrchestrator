import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { createLlmNode, ToolCallingModel } from "../../agent/nodes/llm_node";
import { loadClaimNode } from "../../agent/nodes/load_claim_node";
import { routeAfterAgent, routeAfterLoad } from "../../agent/graph";
import { ClaimContext, GraphStateType } from "../../agent/state";
import { query } from "../../db/client";

jest.mock("../../db/client", () => ({ query: jest.fn() }));
jest.mock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const claim: ClaimContext = {
    id: 3,
    policy_id: 2,
    policy_number: "POL-HOME-67890",
    claim_amount: 5000,
    damage_type: "water_damage",
    status: "pending",
    description: "Burst pipe",
};

function baseState(overrides: Partial<GraphStateType> = {}): GraphStateType {
    return {
        messages: [new HumanMessage("Please investigate claim 3.")],
        claim_id: 3,
        policy_number: "POL-HOME-67890",
        claim,
        decision: null,
        claim_status: "pending",
        ...overrides,
    };
}

describe("load_claim node", () => {
    beforeEach(() => jest.clearAllMocks());

    it("loads the claim with its policy number and numeric amount", async () => {
        (query as jest.Mock).mockResolvedValueOnce({
            rows: [{ ...claim, claim_amount: "5000.00" }],
        });

        const update = await loadClaimNode(baseState({ claim: null }));

        expect(update.claim).toEqual(claim);
        expect(update.policy_number).toBe("POL-HOME-67890");
        expect((query as jest.Mock).mock.calls[0][1]).toEqual([3]);
    });

    it("sets claim to null when the claim does not exist", async () => {
        (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

        const update = await loadClaimNode(baseState({ claim: null }));

        expect(update.claim).toBeNull();
    });
});

describe("llm (agent) node", () => {
    it("puts the claim details in the system prompt and returns the model response", async () => {
        const response = new AIMessageChunk("done");
        const invoke = jest.fn().mockResolvedValue(response);
        const model = { invoke } as unknown as ToolCallingModel;

        const update = await createLlmNode(() => model)(baseState());

        expect(update.messages).toEqual([response]);
        const [system] = invoke.mock.calls[0][0] as SystemMessage[];
        expect(system.content).toContain("claim_amount: 5000");
        expect(system.content).toContain("policy_number: POL-HOME-67890");
        expect(system.content).toContain("damage_type: water_damage");
    });
});

describe("graph routing", () => {
    it("ends early when the claim was not found", () => {
        expect(routeAfterLoad(baseState({ claim: null }))).toBe(END);
        expect(routeAfterLoad(baseState())).toBe("agent");
    });

    it("loops to tools while the agent requests them, then decides", () => {
        const withTools = new AIMessage({
            content: "",
            tool_calls: [{ name: "get_policy", args: { policy_number: "x" }, id: "1" }],
        });
        expect(routeAfterAgent(baseState({ messages: [withTools] }))).toBe("tools");
        expect(routeAfterAgent(baseState({ messages: [new AIMessage("summary")] }))).toBe("decide");
    });
});
