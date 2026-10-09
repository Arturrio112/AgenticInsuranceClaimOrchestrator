import { verifyToken, VerifiedToken } from "../auth/jwt";

/**
 * MCP-side token validation. Delegates to the shared auth module so the
 * MCP server and the HTTP API accept exactly the same tokens.
 */
export function validateToken(token: string): boolean {
  return verifyToken(token) !== null;
}

/** Returns the verified token payload, or null if the token is not valid. */
export function authenticateToken(token: string): VerifiedToken | null {
  return verifyToken(token);
}
