import type { PoolConfig } from "pg";

/** Thrown when the database connection settings are missing or invalid. */
export class DbConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DbConfigError";
    }
}

/** DB_* variables that must be set when DATABASE_URL is not. They have no defaults. */
export const REQUIRED_DB_VARS = ["DB_USER", "DB_PASSWORD", "DB_NAME"] as const;

const DEFAULT_DB_HOST = "localhost";
const DEFAULT_DB_PORT = 5432;

function readNonEmpty(env: NodeJS.ProcessEnv, name: string): string | undefined {
    const value = env[name];
    return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * Builds the Postgres pool configuration from the environment.
 *
 * Requires either DATABASE_URL or the full DB_USER / DB_PASSWORD / DB_NAME set.
 * Only the non-secret DB_HOST and DB_PORT fall back to defaults (localhost:5432).
 * Throws a DbConfigError that names every missing variable.
 */
export function getDbConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
    const connectionString = readNonEmpty(env, "DATABASE_URL");
    if (connectionString !== undefined) {
        return { connectionString };
    }

    const missing = REQUIRED_DB_VARS.filter((name) => readNonEmpty(env, name) === undefined);
    if (missing.length > 0) {
        throw new DbConfigError(
            `Database configuration is incomplete: missing ${missing.join(", ")}. ` +
                "Set DATABASE_URL, or set DB_USER, DB_PASSWORD and DB_NAME in .env " +
                "(DB_HOST and DB_PORT are optional and default to localhost:5432)."
        );
    }

    const rawPort = readNonEmpty(env, "DB_PORT");
    const port = rawPort === undefined ? DEFAULT_DB_PORT : Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new DbConfigError(`DB_PORT must be an integer between 1 and 65535, got "${rawPort}".`);
    }

    return {
        host: readNonEmpty(env, "DB_HOST") ?? DEFAULT_DB_HOST,
        port,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
    };
}
