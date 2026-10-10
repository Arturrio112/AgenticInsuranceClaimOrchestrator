import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import {
    createDecideNode,
    buildDecisionPrompt,
    buildDecisionTranscript,
    DecisionModel,
} from "../../agent/nodes/decide_node";
import { GraphStateType } from "../../agent/state";

jest.mock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function makeState(overrides: Partial<GraphStateType> = {}): GraphStateType {
    return {
        claim_id: 1,
        policy_number: "POL-AUTO-12345",
        claim: {
            id: 1,
            policy_id: 1,
            policy_number: "POL-AUTO-12345",
            claim_amount: 1500,
            damage_type: "collision",
            status: "pending",
            description: "Fender bender",
        },
        decision: null,
        claim_status: "pending",
        confidence_threshold: 70,
        messages: [
            new HumanMessage("Please investigate claim 1."),
            new AIMessage({
                content: "",
                tool_calls: [
                    { name: "get_policy", args: { policy_number: "POL-AUTO-12345" }, id: "c1" },
                    { name: "check_coverage", args: { policy_type: "auto", damage_type: "collision" }, id: "c2" },
                ],
            }),
            new ToolMessage({
                name: "get_policy",
                tool_call_id: "c1",
                content: JSON.stringify({ id: 1, policy_number: "POL-AUTO-12345", status: "active", type: "auto" }),
            }),
            new ToolMessage({
                name: "check_coverage",
                tool_call_id: "c2",
                content: JSON.stringify({ id: 7, policy_type: "auto", damage_type: "collision", max_coverage_amount: "50000.00" }),
            }),
            new AIMessage("Policy active, collision covered up to 50000."),
        ],
        ...overrides,
    };
}

function modelReturning(output: unknown): DecisionModel & { invoke: jest.Mock } {
    return { invoke: jest.fn().mockResolvedValue(output) };
}

describe("decide node", () => {
    it("returns a validated decision for well-formed model output", async () => {
        const model = modelReturning({
            decision: "approve",
            reasoning: "Policy is active and the amount is within coverage.",
            confidence_score: 92.4,
            citations: { policy_id: 1, policy_number: "POL-AUTO-12345", coverage_rule_ids: [7] },
        });

        const update = await createDecideNode(() => model)(makeState());

        expect(update.decision).toEqual({
            decision: "approve",
            reasoning: "Policy is active and the amount is within coverage.",
            confidence_score: 92,
            citations: { policy_id: 1, policy_number: "POL-AUTO-12345", coverage_rule_ids: [7] },
            fallback: false,
        });
    });

    it("sends the claim details and tool results to the model", async () => {
        const model = modelReturning({
            decision: "approve",
            reasoning: "ok",
            confidence_score: 90,
            citations: { policy_id: null, policy_number: null, coverage_rule_ids: [] },
        });

        await createDecideNode(() => model)(makeState());

        const prompt = model.invoke.mock.calls[0][0] as Array<{ content: unknown }>;
        const userText = String(prompt[1].content);
        expect(userText).toContain("claim_amount: 1500");
        expect(userText).toContain("damage_type: collision");
        expect(userText).toContain('[check_coverage result] {"id":7');
    });

    it("falls back to flag with confidence 0 when output fails validation", async () => {
        const model = modelReturning({ decision: "maybe", reasoning: "", confidence_score: 150 });

        const update = await createDecideNode(() => model)(makeState());

        expect(update.decision).toMatchObject({
            decision: "flag",
            confidence_score: 0,
            fallback: true,
            citations: { policy_id: null, policy_number: null, coverage_rule_ids: [] },
        });
        expect(update.decision?.reasoning).toContain("failed validation");
    });

    it("falls back instead of throwing when the model call itself fails", async () => {
        const model: DecisionModel = { invoke: jest.fn().mockRejectedValue(new Error("Failed to parse JSON")) };

        const update = await createDecideNode(() => model)(makeState());

        expect(update.decision).toMatchObject({ decision: "flag", confidence_score: 0, fallback: true });
        expect(update.decision?.reasoning).toContain("Failed to parse JSON");
    });

    it("drops citation IDs that no tool returned", async () => {
        const model = modelReturning({
            decision: "approve",
            reasoning: "Covered.",
            confidence_score: 85,
            citations: { policy_id: 42, policy_number: "POL-FAKE-1", coverage_rule_ids: [7, 99, 7] },
        });

        const update = await createDecideNode(() => model)(makeState());

        expect(update.decision?.citations).toEqual({
            policy_id: null,
            policy_number: null,
            coverage_rule_ids: [7],
        });
        expect(update.decision?.decision).toBe("approve");
    });

    it("accepts the claim's own policy even if get_policy was not called", async () => {
        const model = modelReturning({
            decision: "flag",
            reasoning: "No coverage data.",
            confidence_score: 40,
            citations: { policy_id: 1, policy_number: "POL-AUTO-12345", coverage_rule_ids: [7] },
        });

        const update = await createDecideNode(() => model)(makeState({ messages: [new HumanMessage("x")] }));

        expect(update.decision?.citations).toEqual({
            policy_id: 1,
            policy_number: "POL-AUTO-12345",
            coverage_rule_ids: [],
        });
    });
});

describe("buildDecisionPrompt", () => {
    const original = process.env.CONFIDENCE_THRESHOLD;
    afterEach(() => {
        if (original === undefined) delete process.env.CONFIDENCE_THRESHOLD;
        else process.env.CONFIDENCE_THRESHOLD = original;
    });

    it("puts the confidence checklist with the configured threshold in the system message", () => {
        process.env.CONFIDENCE_THRESHOLD = "80";
        const [system, human] = buildDecisionPrompt(makeState());
        expect(SystemMessage.isInstance(system)).toBe(true);
        expect(system.content).toContain("CONFIDENCE CHECKLIST");
        expect(system.content).toContain("If the result is below 80, the claim goes to a human reviewer");
        expect(human.content).toContain("- description: Fender bender");
    });

    it("uses the default threshold of 70 when none is configured", () => {
        delete process.env.CONFIDENCE_THRESHOLD;
        const [system] = buildDecisionPrompt(makeState());
        expect(system.content).toContain("If the result is below 70");
    });
});

describe("buildDecisionTranscript", () => {
    it("reports when there are no tool results", () => {
        expect(buildDecisionTranscript([new HumanMessage("hi")])).toBe("(no tool results)");
    });
});
