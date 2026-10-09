import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

/**
 * Single source of truth for JWT handling, shared by the Express API
 * (src/api) and the MCP server (src/mcp/auth.ts).
 *
 * Configuration is read lazily from the environment on every call so that
 * tests (and long-running processes) always see the current values.
 */

const JWT_ALGORITHM = "HS256";
const DEFAULT_EXPIRES_IN = "1h";
const EXPIRES_IN_PATTERN = /^\d+(ms|s|m|h|d|w|y)?$/;

/** Claims the application places in (and expects from) a token. */
export interface AuthTokenPayload {
    /** Subject: the authenticated principal (e.g. a username). */
    sub: string;
}

/** A successfully verified token, including the registered time claims. */
export interface VerifiedToken extends AuthTokenPayload {
    iat: number;
    exp: number;
}

/** Express request after `requireAuth` has run. */
export interface AuthenticatedRequest extends Request {
    auth?: VerifiedToken;
}

export class AuthConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AuthConfigError";
    }
}

/** Returns JWT_SECRET from the environment. There is deliberately no fallback. */
export function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.trim() === "") {
        throw new AuthConfigError(
            "JWT_SECRET environment variable is not set. Refusing to sign or verify tokens without a secret."
        );
    }
    return secret;
}

/** Returns the token lifetime (JWT_EXPIRES_IN, default "1h"). */
export function getJwtExpiresIn(): NonNullable<SignOptions["expiresIn"]> {
    const raw = (process.env.JWT_EXPIRES_IN ?? "").trim() || DEFAULT_EXPIRES_IN;
    if (!EXPIRES_IN_PATTERN.test(raw)) {
        throw new AuthConfigError(
            `JWT_EXPIRES_IN has an invalid value "${raw}". Use seconds (e.g. 3600) or a duration such as 15m, 1h, 7d.`
        );
    }
    if (/^\d+$/.test(raw)) {
        return Number(raw);
    }
    // Validated above against the `ms` duration format accepted by jsonwebtoken.
    return raw as NonNullable<SignOptions["expiresIn"]>;
}

export function signToken(payload: AuthTokenPayload): string {
    return jwt.sign({ sub: payload.sub }, getJwtSecret(), {
        algorithm: JWT_ALGORITHM,
        expiresIn: getJwtExpiresIn(),
    });
}

function isVerifiedToken(decoded: string | JwtPayload): decoded is JwtPayload & VerifiedToken {
    return (
        typeof decoded === "object" &&
        typeof decoded.sub === "string" &&
        typeof decoded.iat === "number" &&
        typeof decoded.exp === "number"
    );
}

/**
 * Verifies a token and returns its typed payload, or null if the token is
 * invalid, expired, signed with another secret, or missing required claims.
 * Throws AuthConfigError if JWT_SECRET is not configured.
 */
export function verifyToken(token: string): VerifiedToken | null {
    const secret = getJwtSecret();
    try {
        const decoded = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
        if (!isVerifiedToken(decoded)) {
            return null;
        }
        return { sub: decoded.sub, iat: decoded.iat, exp: decoded.exp };
    } catch {
        return null;
    }
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }
    const token = authHeader.slice("Bearer ".length).trim();
    return token === "" ? null : token;
}

/** Express middleware: rejects the request with 401 unless it carries a valid Bearer token. */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
        res.status(401).json({ error: "Missing or invalid Bearer token" });
        return;
    }

    let verified: VerifiedToken | null;
    try {
        verified = verifyToken(token);
    } catch (error) {
        next(error);
        return;
    }

    if (!verified) {
        res.status(401).json({ error: "Invalid token" });
        return;
    }

    req.auth = verified;
    next();
}
