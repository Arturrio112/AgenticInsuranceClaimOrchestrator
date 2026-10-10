/** Command-line parsing for `src/db/generate.ts`. Pure; no I/O. */

export const DEFAULT_CLAIM_COUNT = 15;
export const MAX_CLAIM_COUNT = 500;
export const MAX_SEED = 0xffffffff;

export const USAGE = `Usage: npm run db:generate -- [--claims <n>] [--seed <n>]
       make db-generate [CLAIMS=<n>] [SEED=<n>]

Appends new policies, missing coverage rules and pending claims. Never deletes data.

Options:
  --claims <n>   Number of claims to generate, 1-${MAX_CLAIM_COUNT} (default ${DEFAULT_CLAIM_COUNT})
  --seed <n>     PRNG seed, 0-${MAX_SEED}, for reproducible output (default: random, printed)
  --help         Show this message`;

export interface GenerateArgs {
    claims: number;
    /** Undefined when no seed was given; the caller picks a random one. */
    seed: number | undefined;
}

export type ParseResult =
    | { kind: "ok"; args: GenerateArgs }
    | { kind: "help" }
    | { kind: "error"; message: string };

function parseInteger(name: string, raw: string | undefined, min: number, max: number): number | string {
    if (raw === undefined || raw.trim() === "") return `--${name} needs a value`;
    if (!/^\d+$/.test(raw.trim())) return `--${name} must be a whole number, got "${raw}"`;
    const value = Number(raw);
    if (value < min || value > max) return `--${name} must be between ${min} and ${max}, got ${value}`;
    return value;
}

/** Parses `--claims 20 --seed 7` (or `--claims=20`). Unknown flags and positional arguments are errors. */
export function parseGenerateArgs(argv: readonly string[]): ParseResult {
    const args: GenerateArgs = { claims: DEFAULT_CLAIM_COUNT, seed: undefined };
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === "--help" || token === "-h") return { kind: "help" };

        const match = /^--(claims|seed)(?:=(.*))?$/.exec(token);
        if (match === null) return { kind: "error", message: `Unknown argument "${token}"` };

        const name = match[1];
        let raw: string | undefined = match[2];
        if (raw === undefined) {
            raw = argv[i + 1];
            if (raw !== undefined && raw.startsWith("--")) raw = undefined;
            else i++;
        }

        const parsed =
            name === "claims" ? parseInteger(name, raw, 1, MAX_CLAIM_COUNT) : parseInteger(name, raw, 0, MAX_SEED);
        if (typeof parsed === "string") return { kind: "error", message: parsed };
        if (name === "claims") args.claims = parsed;
        else args.seed = parsed;
    }
    return { kind: "ok", args };
}
