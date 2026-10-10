import path from "path";
import { ToolMessage } from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import {
    AGENT_TOOL_ALLOW_LIST,
    closeMcpClient,
    connectMcp,
    getAgentTools,
    loadAgentTools,
    McpConnection,
    McpUnavailableError,
    resolveMcpTransport,
    resolveStdioServerPath,
    selectAgentTools,
} from "../../agent/mcp_client";
import { query } from "../../db/client";

jest.mock("../../db/client", () => ({ query: jest.fn() }));
jest.mock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const FIXTURES = path.join(__dirname, "../fixtures");

function fakeTool(name: string): StructuredToolInterface {
    return { name } as unknown as StructuredToolInterface;
}

async function callTool(tool: StructuredToolInterface, args: Record<string, unknown>): Promise<ToolMessage> {
    const result: unknown = await tool.invoke({ type: "tool_call", id: `call_${tool.name}`, name: tool.name, args });
    if (!ToolMessage.isInstance(result)) throw new Error("Expected a ToolMessage");
    return result;
}

describe("resolveMcpTransport", () => {
    it("defaults to the in-process transport", () => {
        expect(resolveMcpTransport({})).toBe("inmemory");
        expect(resolveMcpTransport({ MCP_TRANSPORT: "  " })).toBe("inmemory");
    });

    it("selects stdio (case-insensitive)", () => {
        expect(resolveMcpTransport({ MCP_TRANSPORT: "stdio" })).toBe("stdio");
        expect(resolveMcpTransport({ MCP_TRANSPORT: "STDIO" })).toBe("stdio");
        expect(resolveMcpTransport({ MCP_TRANSPORT: "inmemory" })).toBe("inmemory");
    });

    it("rejects an unknown transport instead of silently falling back", () => {
        expect(() => resolveMcpTransport({ MCP_TRANSPORT: "http" })).toThrow(/Invalid MCP_TRANSPORT "http"/);
    });
});

describe("resolveStdioServerPath", () => {
    it("defaults to the compiled server next to the agent module", () => {
        expect(resolveStdioServerPath({})).toBe(path.resolve(__dirname, "../../mcp/server.js"));
    });

    it("can be overridden with MCP_SERVER_PATH", () => {
        expect(resolveStdioServerPath({ MCP_SERVER_PATH: "/opt/mcp/server.js" })).toBe("/opt/mcp/server.js");
    });
});

describe("selectAgentTools (allow-list)", () => {
    it("keeps only get_policy and check_coverage, never flag_review", () => {
        const selected = selectAgentTools([fakeTool("flag_review"), fakeTool("check_coverage"), fakeTool("get_policy")]);
        expect(selected.map((tool) => tool.name)).toEqual(["get_policy", "check_coverage"]);
        expect(AGENT_TOOL_ALLOW_LIST).not.toContain("flag_review");
    });

    it("fails when the server does not provide a required tool", () => {
        expect(() => selectAgentTools([fakeTool("get_policy")])).toThrow(McpUnavailableError);
        expect(() => selectAgentTools([fakeTool("get_policy")])).toThrow(/check_coverage/);
    });
});

describe("in-memory transport against the project's MCP server", () => {
    let connection: McpConnection;

    beforeEach(async () => {
        jest.clearAllMocks();
        connection = await connectMcp("inmemory");
    });

    afterEach(async () => {
        await connection.close();
    });

    it("lists every server tool but binds only the allow-listed ones", async () => {
        const listed = await connection.client.listTools();
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["check_coverage", "flag_review", "get_policy"]);

        const tools = await loadAgentTools(connection);
        expect(tools.map((tool) => tool.name)).toEqual(["get_policy", "check_coverage"]);
        expect(tools.map((tool) => tool.name)).not.toContain("flag_review");
    });

    it("tags each tool with its MCP origin for the audit trail and tracing", async () => {
        const tools = await loadAgentTools(connection);
        for (const tool of tools) {
            expect(tool.metadata).toMatchObject({ mcp_server: "InsuranceClaimMCP", mcp_transport: "inmemory" });
        }
    });

    it("executes get_policy through the MCP server, which queries the database", async () => {
        const policy = { id: 4, user_id: "u1", policy_number: "POL-1", status: "active", type: "auto" };
        (query as jest.Mock).mockResolvedValueOnce({ rows: [policy] });
        const [getPolicy] = await loadAgentTools(connection);

        const message = await callTool(getPolicy, { policy_number: "POL-1" });

        expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM policies"), ["POL-1"]);
        expect(message.name).toBe("get_policy");
        expect(JSON.parse(message.content as string)).toEqual(policy);
    });

    it("validates tool arguments against the MCP input schema", async () => {
        const [getPolicy] = await loadAgentTools(connection);
        await expect(getPolicy.invoke({ policy_number: 42 })).rejects.toThrow();
        expect(query).not.toHaveBeenCalled();
    });
});

describe("stdio transport", () => {
    it("spawns the server, inherits the environment and exposes the allow-listed tools", async () => {
        const connection = await connectMcp("stdio", {
            ...process.env,
            MCP_SERVER_PATH: path.join(FIXTURES, "stdio_mcp_server.js"),
            FIXTURE_MARKER: "inherited",
        });
        try {
            expect(connection.transport).toBe("stdio");
            const tools = await loadAgentTools(connection);
            expect(tools.map((tool) => tool.name)).toEqual(["get_policy", "check_coverage"]);
            expect(tools[0].metadata).toMatchObject({ mcp_transport: "stdio" });

            const message = await callTool(tools[0], { policy_number: "POL-9" });
            expect(JSON.parse(message.content as string)).toEqual({ id: 7, policy_number: "POL-9", marker: "inherited" });
        } finally {
            await connection.close();
        }
    });

    it("reports the server as unavailable when the entry point does not exist", async () => {
        const attempt = connectMcp("stdio", { MCP_SERVER_PATH: path.join(FIXTURES, "missing_server.js") });
        await expect(attempt).rejects.toThrow(McpUnavailableError);
        await expect(attempt).rejects.toThrow(/transport=stdio.*not found/);
    });

    it("reports the server as unavailable when the process exits during start-up", async () => {
        const attempt = connectMcp("stdio", { ...process.env, MCP_SERVER_PATH: path.join(FIXTURES, "exiting_server.js") });
        await expect(attempt).rejects.toThrow(McpUnavailableError);
    });
});

describe("getAgentTools (shared connection)", () => {
    const originalTransport = process.env.MCP_TRANSPORT;

    afterEach(async () => {
        await closeMcpClient();
        if (originalTransport === undefined) delete process.env.MCP_TRANSPORT;
        else process.env.MCP_TRANSPORT = originalTransport;
    });

    it("connects once and reuses the tools until closed", async () => {
        delete process.env.MCP_TRANSPORT;
        const first = await getAgentTools();
        const second = await getAgentTools();
        expect(second).toBe(first);
        expect(first.map((tool) => tool.name)).toEqual(["get_policy", "check_coverage"]);

        await closeMcpClient();
        const reconnected = await getAgentTools();
        expect(reconnected).not.toBe(first);
    });

    it("does not cache a failed connection attempt", async () => {
        process.env.MCP_TRANSPORT = "carrier-pigeon";
        await expect(getAgentTools()).rejects.toThrow(/Invalid MCP_TRANSPORT/);

        delete process.env.MCP_TRANSPORT;
        await expect(getAgentTools()).resolves.toHaveLength(2);
    });

    it("closing without a connection is a no-op", async () => {
        await expect(closeMcpClient()).resolves.toBeUndefined();
    });
});
