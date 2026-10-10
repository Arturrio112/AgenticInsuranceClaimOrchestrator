import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { getDbConfig } from './config';

process.env.DOTENV_QUIET = 'true';
dotenv.config();

let pool: Pool | undefined;

/**
 * Returns the shared connection pool, creating it on first use.
 * Creation is lazy so importing this module never throws: a missing
 * configuration surfaces as a DbConfigError on the first query, and
 * src/index.ts calls getDbConfig() at startup to fail fast.
 */
export function getPool(): Pool {
    if (!pool) {
        pool = new Pool(getDbConfig());
    }
    return pool;
}

/** Closes the shared pool if one was created. Safe to call more than once. */
export async function closePool(): Promise<void> {
    if (pool) {
        const current = pool;
        pool = undefined;
        await current.end();
    }
}

export const query = (text: string, params?: unknown[]) => {
    return getPool().query(text, params);
};
