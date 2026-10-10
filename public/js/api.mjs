// @ts-check
/**
 * HTTP client for the Express API. Every call except login sends the JWT;
 * a 401 clears the stored token and throws UnauthorizedError so the app can
 * return to the sign-in screen.
 */
import { clearToken, getToken } from "./session.mjs";
import { isResolutionResponse } from "./view-model.mjs";

/** @typedef {import("./view-model.mjs").ClaimSummary} ClaimSummary */
/** @typedef {import("./view-model.mjs").ClaimResolutionResponse} ClaimResolutionResponse */

export class ApiError extends Error {
    /**
     * @param {string} message
     * @param {number} status  HTTP status, or 0 when the server could not be reached.
     */
    constructor(message, status) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

export class UnauthorizedError extends ApiError {
    constructor() {
        super("Your session has expired. Sign in again to continue.", 401);
        this.name = "UnauthorizedError";
    }
}

/**
 * @param {Response} res
 * @returns {Promise<unknown>}
 */
async function readJson(res) {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

/** @param {unknown} body */
function errorMessage(body) {
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
    return null;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function request(path, init = {}) {
    const token = getToken();
    /** @type {Record<string, string>} */
    const headers = { Accept: "application/json" };
    if (init.body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
        res = await fetch(path, { ...init, headers });
    } catch {
        throw new ApiError("Could not reach the server. Check that the API is running, then try again.", 0);
    }

    if (res.status === 401) {
        clearToken();
        throw new UnauthorizedError();
    }

    const body = await readJson(res);
    if (!res.ok) {
        throw new ApiError(errorMessage(body) ?? `The server responded with ${res.status}.`, res.status);
    }
    return body;
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<string>} the JWT
 */
export async function login(username, password) {
    let res;
    try {
        res = await fetch("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ username, password }),
        });
    } catch {
        throw new ApiError("Could not reach the server. Check that the API is running, then try again.", 0);
    }
    const body = await readJson(res);
    if (res.status === 401) throw new ApiError("That username and password don't match. Check them and try again.", 401);
    if (!res.ok) throw new ApiError(errorMessage(body) ?? `Sign-in failed with status ${res.status}.`, res.status);
    if (!body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string") {
        throw new ApiError("The server did not return a session token.", res.status);
    }
    return body.token;
}

/** @returns {Promise<ClaimSummary[]>} */
export async function listClaims() {
    const body = await request("/claims");
    if (!body || typeof body !== "object" || !("claims" in body) || !Array.isArray(body.claims)) {
        throw new ApiError("The claims list came back in an unexpected format.", 200);
    }
    return /** @type {ClaimSummary[]} */ (body.claims);
}

/**
 * Runs the agent on one claim. Resolves when the whole graph has finished.
 * @param {number} claimId
 * @returns {Promise<ClaimResolutionResponse>}
 */
export async function investigateClaim(claimId) {
    const body = await request("/claim", { method: "POST", body: JSON.stringify({ claim_id: claimId }) });
    if (!isResolutionResponse(body)) {
        throw new ApiError("The investigation finished, but the response was in an unexpected format.", 200);
    }
    return body;
}
