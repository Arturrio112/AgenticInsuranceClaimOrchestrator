import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetPolicyTool } from "../../mcp/tools/get_policy";
import { query } from "../../db/client";

jest.mock("../../db/client", () => ({
  query: jest.fn(),
}));


describe("get_policy tool", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({
      name: "test-server",
      version: "1.0.0",
    });
    jest.clearAllMocks();
  });

  it("should register and execute get_policy tool", async () => {
    const mockTool = jest.spyOn(server, "tool");
    registerGetPolicyTool(server);
    
    expect(mockTool).toHaveBeenCalledWith(
      "get_policy",
      "Get insurance policy details by policy number",
      expect.any(Object),
      expect.any(Function)
    );

    const callback = mockTool.mock.calls[0][3] as any;
    
    const mockPolicy = {
      id: 1,
      user_id: 1,
      policy_number: "POL123",
      status: "active",
      type: "auto",
      created_at: "2023-01-01"
    };

    (query as jest.Mock).mockResolvedValueOnce({ rows: [mockPolicy] });

    const result = await callback({ policy_number: "POL123", _meta: {} });
    
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT"),
      ["POL123"]
    );
    
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(mockPolicy, null, 2) }]
    });
  });

  it("should return not found when policy is not found", async () => {
    const mockTool = jest.spyOn(server, "tool");
    registerGetPolicyTool(server);
    
    const callback = mockTool.mock.calls[0][3] as any;

    (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const result = await callback({ policy_number: "UNKNOWN", _meta: {} });
    
    expect(result).toEqual({
      content: [{ type: "text", text: "Policy not found." }]
    });
  });
});
