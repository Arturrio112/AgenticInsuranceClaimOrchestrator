// @ts-check
/**
 * JWT storage. localStorage can throw (private mode, blocked storage), so every
 * access is guarded and an in-memory copy keeps the session alive until reload.
 */

const KEY = "authToken";

/** @type {string | null} */
let memoryToken = null;

/** @returns {string | null} */
export function getToken() {
    try {
        return localStorage.getItem(KEY) ?? memoryToken;
    } catch {
        return memoryToken;
    }
}

/** @param {string} token */
export function setToken(token) {
    memoryToken = token;
    try {
        localStorage.setItem(KEY, token);
    } catch {
        // Storage unavailable: memoryToken is used instead.
    }
}

export function clearToken() {
    memoryToken = null;
    try {
        localStorage.removeItem(KEY);
    } catch {
        // Nothing stored.
    }
}
