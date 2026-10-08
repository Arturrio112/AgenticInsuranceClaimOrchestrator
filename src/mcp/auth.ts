export function validateToken(token: string): boolean {
  // Mock JWT validation for our internal MCP server
  return token === "valid-mock-token";
}
