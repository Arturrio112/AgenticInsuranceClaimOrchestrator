import { existsSync } from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { DynamicStructuredTool, StructuredToolInterface } from "@langchain/core/tools";
import { createMcpServer, MCP_SERVER_NAME } from "../mcp/server";
import { logger } from "../utils/logger";

/**
 * MCP client for the LangGraph agent (Ticket 11.1).
 *
 * The agent has no tool code of its own: it connects to the project's MCP server
 * (src/mcp/server.ts) and exposes the server's tools as LangChain tools, so Postgres
 * is only ever reached through the MCP tool implementations.
 */

/**
 * Tools the investigation may call. Only read-only tools: `flag_review` writes to the
 * claims table, and claim status is written exclusively by the `persist` node from the
 * structured decision, so it must never be bound to the model.
 */
export const AGENT_TOOL_ALLOW_LIST: readonly string[] = ["get_policy", "check_coverage"];

export const MCP_TRANSPORTS = ["inmemory", "stdio"] as const;
export type McpTransportKind = (typeof MCP_TRANSPORTS)[number];

export const DEFAULT_MCP_TRANSPORT: McpTransportKind = "inmemory";

const CLIENT_INFO = { name: "insurance-claim-agent", version: "1.0.0" };

/** Raised when the MCP server cannot be reached or does not offer the agent's tools. */
export class McpUnavailableError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "McpUnavailableError";
    }
}

function isTransportKind(value: string): value is McpTransportKind {
    return (MCP_TRANSPORTS as readonly string[]).includes(value);
}

/** Reads MCP_TRANSPORT (default "inmemory"). An unknown value is a configuration error. */
export function resolveMcpTransport(env: NodeJS.ProcessEnv = process.env): McpTransportKind {
    const raw = env.MCP_TRANSPORT?.trim().toLowerCase();
    if (!raw) return DEFAULT_MCP_TRANSPORT;
    if (!isTransportKind(raw)) {
        throw new Error(`Invalid MCP_TRANSPORT "${env.MCP_TRANSPORT}". Expected one of: ${MCP_TRANSPORTS.join(", ")}.`);
    }
    return raw;
}

/**
 * Compiled MCP server entry point spawned in stdio mode. Defaults to the server next to
 * this module in the build output (dist/mcp/server.js); MCP_SERVER_PATH overrides it.
 */
export function resolveStdioServerPath(env: NodeJS.ProcessEnv = process.env): string {
    const configured = env.MCP_SERVER_PATH?.trim();
    return configured ? path.resolve(configured) : path.resolve(__dirname, "../mcp/server.js");
}

/** The child process gets the parent's environment so the server sees the same DB settings. */
function inheritedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) result[key] = value;
    }
    return result;
}

export interface McpConnection {
    client: Client;
    transport: McpTransportKind;
    close(): Promise<void>;
}

async function connectInMemory(): Promise<McpConnection> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    await server.connect(serverTransport);

    const client = new Client(CLIENT_INFO);
    try {
        await client.connect(clientTransport);
    } catch (error) {
        await server.close();
        throw error;
    }

    return {
        client,
        transport: "inmemory",
        close: async () => {
            await client.close();
            await server.close();
        },
    };
}

async function connectStdio(env: NodeJS.ProcessEnv): Promise<McpConnection> {
    const serverPath = resolveStdioServerPath(env);
    if (!existsSync(serverPath)) {
        throw new Error(`MCP server entry point not found at ${serverPath}. Run "npm run build" or set MCP_SERVER_PATH.`);
    }

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: inheritedEnv(env),
        stderr: "inherit",
    });
    const client = new Client(CLIENT_INFO);
    await client.connect(transport);

    return {
        client,
        transport: "stdio",
        close: () => client.close(),
    };
}

/** Opens a new connection to the project's MCP server over the given transport. */
export async function connectMcp(
    transport: McpTransportKind = resolveMcpTransport(),
    env: NodeJS.ProcessEnv = process.env
): Promise<McpConnection> {
    try {
        return transport === "stdio" ? await connectStdio(env) : await connectInMemory();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new McpUnavailableError(`MCP server unavailable (transport=${transport}): ${reason}`, { cause: error });
    }
}

/**
 * Keeps only the allow-listed tools, in allow-list order. Fails if the server does not
 * offer one of them, rather than letting the agent run with a partial tool set.
 */
export function selectAgentTools<T extends StructuredToolInterface>(tools: T[]): T[] {
    return AGENT_TOOL_ALLOW_LIST.map((name) => {
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) {
            throw new McpUnavailableError(`MCP server "${MCP_SERVER_NAME}" does not provide the required tool "${name}".`);
        }
        return tool;
    });
}

/**
 * Lists the server's tools, converts them to LangChain tools and applies the allow-list.
 * Each tool is tagged with its MCP origin; LangChain passes tool metadata to callbacks,
 * so the audit trail and Langfuse record that the call went through MCP.
 */
export async function loadAgentTools(connection: McpConnection): Promise<DynamicStructuredTool[]> {
    const tools = selectAgentTools(await loadMcpTools(MCP_SERVER_NAME, connection.client, { throwOnLoadError: true }));
    for (const tool of tools) {
        tool.metadata = { ...tool.metadata, mcp_server: MCP_SERVER_NAME, mcp_transport: connection.transport };
    }
    return tools;
}

interface AgentToolset {
    connection: McpConnection;
    tools: StructuredToolInterface[];
}

let toolset: Promise<AgentToolset> | undefined;

async function openToolset(): Promise<AgentToolset> {
    const connection = await connectMcp();
    try {
        const tools = await loadAgentTools(connection);
        logger.info("Agent connected to MCP server", {
            transport: connection.transport,
            tools: tools.map((tool) => tool.name),
        });
        return { connection, tools };
    } catch (error) {
        await connection.close().catch(() => undefined);
        throw error;
    }
}

/**
 * The agent's tools, served by the MCP server. Connects on first use and reuses the
 * connection afterwards. A failed attempt is not cached, so the next call retries.
 */
export function getAgentTools(): Promise<StructuredToolInterface[]> {
    if (!toolset) {
        const attempt = openToolset();
        toolset = attempt;
        attempt.catch(() => {
            if (toolset === attempt) toolset = undefined;
        });
    }
    return toolset.then(({ tools }) => tools);
}

/** Closes the shared MCP connection (and stops the stdio child process, if any). */
export async function closeMcpClient(): Promise<void> {
    const current = toolset;
    toolset = undefined;
    if (!current) return;
    try {
        const { connection } = await current;
        await connection.close();
    } catch {
        // Never connected, so there is nothing to close.
    }
}
