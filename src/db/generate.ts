/**
 * CLI: appends realistic test policies, coverage rules and pending claims.
 *
 *   npm run db:generate -- --claims 20 --seed 7
 *   make db-generate CLAIMS=20 SEED=7
 *
 * Unlike src/db/seed.ts it never truncates or deletes anything.
 */
import { closePool, getPool } from "./client";
import { parseGenerateArgs, USAGE } from "./generate/args";
import { generateDataset } from "./generate/scenarios";
import { formatSummary } from "./generate/summary";
import { ensureSchema, readSnapshot, writeDataset } from "./generate/writer";

async function main(): Promise<number> {
    const parsed = parseGenerateArgs(process.argv.slice(2));
    if (parsed.kind === "help") {
        console.log(USAGE);
        return 0;
    }
    if (parsed.kind === "error") {
        console.error(`Error: ${parsed.message}\n\n${USAGE}`);
        return 2;
    }

    const seed = parsed.args.seed ?? Math.floor(Math.random() * 0x100000000);
    const client = await getPool().connect();
    try {
        await ensureSchema(client);
        await client.query("BEGIN");
        const snapshot = await readSnapshot(client);
        const dataset = generateDataset({
            claimCount: parsed.args.claims,
            seed,
            existingRules: snapshot.existingRules,
            takenPolicyNumbers: snapshot.takenPolicyNumbers,
        });
        const result = await writeDataset(client, dataset);
        await client.query("COMMIT");
        console.log(formatSummary(result, seed));
        return 0;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((err: unknown) => {
        console.error("Error generating test data:", err);
        process.exitCode = 1;
    })
    .finally(() => closePool());
