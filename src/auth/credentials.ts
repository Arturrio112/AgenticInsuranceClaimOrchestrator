import crypto from "crypto";
import { AuthConfigError } from "./jwt";

interface ConfiguredCredentials {
    username: string;
    password: string;
}

/** Reads AUTH_USERNAME / AUTH_PASSWORD from the environment. There are no defaults. */
export function getConfiguredCredentials(): ConfiguredCredentials {
    const username = process.env.AUTH_USERNAME;
    const password = process.env.AUTH_PASSWORD;
    if (!username || !password) {
        throw new AuthConfigError(
            "AUTH_USERNAME and AUTH_PASSWORD environment variables must be set to enable /login."
        );
    }
    return { username, password };
}

/**
 * Constant-time string comparison. Both inputs are hashed first so the
 * buffers passed to timingSafeEqual always have equal length and the
 * comparison does not leak the expected value's length.
 */
function safeEqual(actual: string, expected: string): boolean {
    const a = crypto.createHash("sha256").update(actual, "utf8").digest();
    const b = crypto.createHash("sha256").update(expected, "utf8").digest();
    return crypto.timingSafeEqual(a, b);
}

/** Returns true when the supplied credentials match the configured ones. */
export function verifyCredentials(username: string, password: string): boolean {
    const expected = getConfiguredCredentials();
    // Evaluate both comparisons so timing does not reveal which field was wrong.
    const userOk = safeEqual(username, expected.username);
    const passOk = safeEqual(password, expected.password);
    return userOk && passOk;
}
