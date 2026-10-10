import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { collectKnownSources, filterCitations } from "../../agent/decision";
import { connectMcp, loadAgentTools, McpConnection } from "../../agent/mcp_client";
import { createToolNode } from "../../agent/nodes/tool_node";
import { query } from "../../db/client";

/**
 * Citation verification reads the ToolMessages produced by the MCP-backed tools.
 * These tests run the real MCP server (database mocked) through the agent's tool node,
 * so a change in the MCP tools' output format that breaks the verifier fails here.
 */
jest.mock("../../db/client", () => ({ query: jest.fn() }));
jest.mock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const queryMock = query as jest.Mock;

const policyRow = {
    id: 12,
    user_id: "user_1",
    policy_number: "POL-AUTO-12345",
    status: "active",
    type: "auto",
    created_at: new Date("2024-01-01T00:00:00Z"),
};
const coverageRow = {
    id: 5,
    policy_type: "auto",
    damage_type: "collision",
    max_coverage_amount: "50000.00",
    conditions: "Police report required",
    created_at: new Date("2024-01-01T00:00:00Z"),
};

describe("citation verification over MCP tool output", () => {
    let connection: McpConnection;
    let tools: StructuredToolInterface[];

    beforeAll(async () => {
        connection = await connectMcp("inmemory");
        tools = await loadAgentTools(connection);
    });

    afterAll(async () => {
        await connection.close();
    });

    beforeEach(() => jest.clearAllMocks());

    /** Runs the agent's tool node for the given calls and returns the resulting ToolMessages. */
    async function runTools(calls: { name: string; args: Record<string, unknown> }[]): Promise<ToolMessage[]> {
        const request = new AIMessage({
            content: "",
            tool_calls: calls.map((call, index) => ({ ...call, id: `call_${index}`, type: "tool_call" as const })),
        });
        const result: { messages: BaseMessage[] } = await createToolNode(tools).invoke({ messages: [request] });
        return result.messages.filter((message): message is ToolMessage => ToolMessage.isInstance(message));
    }

    it("collects policy and coverage-rule ids from get_policy and check_coverage", async () => {
        queryMock.mockImplementation(async (sql: string) =>
            sql.includes("FROM policies") ? { rows: [policyRow] } : { rows: [coverageRow] }
        );

        const messages = await runTools([
            { name: "get_policy", args: { policy_number: "POL-AUTO-12345" } },
            { name: "check_coverage", args: { policy_type: "auto", damage_type: "collision" } },
        ]);

        expect(messages.map((message) => message.name)).toEqual(["get_policy", "check_coverage"]);
        const sources = collectKnownSources(messages, null);
        expect([...sources.policyIds]).toEqual([12]);
        expect([...sources.policyNumbers]).toEqual(["POL-AUTO-12345"]);
        expect([...sources.coverageRuleIds]).toEqual([5]);
    });

    it("keeps cited ids that the MCP tools returned and drops invented ones", async () => {
        queryMock.mockImplementation(async (sql: string) =>
            sql.includes("FROM policies") ? { rows: [policyRow] } : { rows: [coverageRow] }
        );
        const messages = await runTools([
            { name: "get_policy", args: { policy_number: "POL-AUTO-12345" } },
            { name: "check_coverage", args: { policy_type: "auto", damage_type: "collision" } },
        ]);

        const check = filterCitations(
            { policy_id: 12, policy_number: "POL-AUTO-12345", coverage_rule_ids: [5, 999] },
            collectKnownSources(messages, null)
        );

        expect(check.citations).toEqual({ policy_id: 12, policy_number: "POL-AUTO-12345", coverage_rule_ids: [5] });
        expect(check.dropped).toEqual(["coverage_rule_id 999"]);
    });

    it("yields no ids for not-found results", async () => {
        queryMock.mockResolvedValue({ rows: [] });

        const messages = await runTools([
            { name: "get_policy", args: { policy_number: "NOPE" } },
            { name: "check_coverage", args: { policy_type: "boat", damage_type: "fire" } },
        ]);

        expect(messages[0].content).toBe("Policy not found.");
        expect(JSON.parse(messages[1].content as string)).toEqual({ error: "No coverage rule found" });
        const sources = collectKnownSources(messages, null);
        expect(sources.policyIds.size).toBe(0);
        expect(sources.coverageRuleIds.size).toBe(0);
    });

    it("turns a failing MCP tool into an error ToolMessage that cites nothing", async () => {
        queryMock.mockRejectedValue(new Error("connection refused"));

        const messages = await runTools([{ name: "get_policy", args: { policy_number: "POL-AUTO-12345" } }]);

        expect(messages).toHaveLength(1);
        expect(messages[0].status).toBe("error");
        expect(messages[0].content).toContain("connection refused");
        expect(collectKnownSources(messages, null).policyIds.size).toBe(0);
    });

    it("parses tool output delivered as text content blocks", () => {
        const message = new ToolMessage({
            name: "check_coverage",
            tool_call_id: "c1",
            content: [{ type: "text", text: JSON.stringify({ id: "7", policy_type: "auto" }) }],
        });

        expect([...collectKnownSources([message], null).coverageRuleIds]).toEqual([7]);
    });
});
