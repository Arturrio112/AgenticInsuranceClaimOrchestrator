import jwt from "jsonwebtoken";
import { Response, NextFunction } from "express";
import {
    signToken,
    verifyToken,
    requireAuth,
    getJwtSecret,
    getJwtExpiresIn,
    extractBearerToken,
    AuthConfigError,
    AuthenticatedRequest,
} from "../../auth/jwt";
import { validateToken } from "../../mcp/auth";

const TEST_SECRET = "unit-test-secret";
const ORIGINAL_ENV = { ...process.env };

interface MockResponse {
    res: Response;
    status: jest.Mock;
    json: jest.Mock;
}

function mockResponse(): MockResponse {
    const json = jest.fn();
    const status = jest.fn();
    const res = { status, json } as unknown as Response;
    status.mockReturnValue(res);
    json.mockReturnValue(res);
    return { res, status, json };
}

function mockRequest(authorization?: string): AuthenticatedRequest {
    return { headers: authorization === undefined ? {} : { authorization } } as unknown as AuthenticatedRequest;
}

describe("auth/jwt", () => {
    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV, JWT_SECRET: TEST_SECRET };
        delete process.env.JWT_EXPIRES_IN;
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    describe("configuration", () => {
        it("throws a clear error when JWT_SECRET is missing", () => {
            delete process.env.JWT_SECRET;
            expect(() => getJwtSecret()).toThrow(AuthConfigError);
            expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
            expect(() => signToken({ sub: "alice" })).toThrow(AuthConfigError);
            expect(() => verifyToken("anything")).toThrow(AuthConfigError);
        });

        it("treats an empty JWT_SECRET as missing", () => {
            process.env.JWT_SECRET = "   ";
            expect(() => getJwtSecret()).toThrow(AuthConfigError);
        });

        it("defaults JWT_EXPIRES_IN to 1h", () => {
            expect(getJwtExpiresIn()).toBe("1h");
        });

        it("accepts numeric seconds and duration strings, rejects garbage", () => {
            process.env.JWT_EXPIRES_IN = "900";
            expect(getJwtExpiresIn()).toBe(900);
            process.env.JWT_EXPIRES_IN = "15m";
            expect(getJwtExpiresIn()).toBe("15m");
            process.env.JWT_EXPIRES_IN = "forever";
            expect(() => getJwtExpiresIn()).toThrow(AuthConfigError);
        });
    });

    describe("signToken / verifyToken", () => {
        it("round-trips the subject and sets an expiry", () => {
            const token = signToken({ sub: "alice" });
            const verified = verifyToken(token);
            expect(verified).not.toBeNull();
            expect(verified?.sub).toBe("alice");
            expect(verified!.exp - verified!.iat).toBe(3600);
        });

        it("honours JWT_EXPIRES_IN", () => {
            process.env.JWT_EXPIRES_IN = "60";
            const verified = verifyToken(signToken({ sub: "alice" }));
            expect(verified!.exp - verified!.iat).toBe(60);
        });

        it("returns null for an expired token", () => {
            const nowSeconds = Math.floor(Date.now() / 1000);
            const expired = jwt.sign(
                { sub: "alice", iat: nowSeconds - 120, exp: nowSeconds - 60 },
                TEST_SECRET
            );
            expect(verifyToken(expired)).toBeNull();
        });

        it("returns null for a token signed with a different secret", () => {
            const forged = jwt.sign({ sub: "alice" }, "some-other-secret", { expiresIn: "1h" });
            expect(verifyToken(forged)).toBeNull();
        });

        it("returns null for a token without the required claims", () => {
            const noSub = jwt.sign({ user: "alice" }, TEST_SECRET, { expiresIn: "1h" });
            const noExp = jwt.sign({ sub: "alice" }, TEST_SECRET);
            expect(verifyToken(noSub)).toBeNull();
            expect(verifyToken(noExp)).toBeNull();
        });

        it("returns null for a token using the 'none' algorithm", () => {
            const unsigned = jwt.sign({ sub: "alice" }, "", { algorithm: "none", expiresIn: "1h" });
            expect(verifyToken(unsigned)).toBeNull();
        });

        it("returns null for malformed input", () => {
            expect(verifyToken("not-a-jwt")).toBeNull();
        });
    });

    describe("extractBearerToken", () => {
        it("extracts the token from a Bearer header", () => {
            expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
        });

        it("returns null for missing or non-Bearer headers", () => {
            expect(extractBearerToken(undefined)).toBeNull();
            expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
            expect(extractBearerToken("Bearer ")).toBeNull();
        });
    });

    describe("requireAuth middleware", () => {
        it("responds 401 when the Authorization header is missing", () => {
            const { res, status, json } = mockResponse();
            const next: NextFunction = jest.fn();
            requireAuth(mockRequest(), res, next);
            expect(status).toHaveBeenCalledWith(401);
            expect(json).toHaveBeenCalledWith({ error: "Missing or invalid Bearer token" });
            expect(next).not.toHaveBeenCalled();
        });

        it("responds 401 for an invalid token", () => {
            const { res, status, json } = mockResponse();
            const next: NextFunction = jest.fn();
            const forged = jwt.sign({ sub: "alice" }, "wrong-secret", { expiresIn: "1h" });
            requireAuth(mockRequest(`Bearer ${forged}`), res, next);
            expect(status).toHaveBeenCalledWith(401);
            expect(json).toHaveBeenCalledWith({ error: "Invalid token" });
            expect(next).not.toHaveBeenCalled();
        });

        it("calls next() and attaches the payload for a valid token", () => {
            const { res, status } = mockResponse();
            const next = jest.fn();
            const req = mockRequest(`Bearer ${signToken({ sub: "alice" })}`);
            requireAuth(req, res, next);
            expect(next).toHaveBeenCalledWith();
            expect(status).not.toHaveBeenCalled();
            expect(req.auth?.sub).toBe("alice");
        });

        it("forwards a configuration error to next() instead of accepting the request", () => {
            const token = signToken({ sub: "alice" });
            delete process.env.JWT_SECRET;
            const { res, status } = mockResponse();
            const next = jest.fn();
            requireAuth(mockRequest(`Bearer ${token}`), res, next);
            expect(next).toHaveBeenCalledWith(expect.any(AuthConfigError));
            expect(status).not.toHaveBeenCalled();
        });
    });

    describe("mcp/auth delegation", () => {
        it("accepts tokens issued by the shared module and rejects others", () => {
            expect(validateToken(signToken({ sub: "mcp-client" }))).toBe(true);
            expect(validateToken(jwt.sign({ sub: "x" }, "wrong", { expiresIn: "1h" }))).toBe(false);
        });
    });
});
