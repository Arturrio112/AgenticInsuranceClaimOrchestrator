/**
 * Decision eval against the real, configured LLM (not part of `npm test`).
 *
 *   make eval CLAIMS=20 SEED=7
 *   npx ts-node src/evals/decision/run.ts --claims 20 --seed 7
 *
 * Appends a fresh batch of generated claims (same generator as `make db-generate`),
 * runs the full agent graph on each one in turn, and prints every verdict and
 * confidence score next to the scenario the claim was generated for. Uncertain
 * scenarios should land below CONFIDENCE_THRESHOLD; clear-cut ones at or above it.
 *
 * It writes to the configured database (new policies/rules/claims, then the
 * decisions), so point DATABASE_URL at a dev or throwaway database.
 */
import { HumanMessage } from "@langchain/core/messages";
import { app } from "../../agent/graph";
import { getConfidenceThreshold } from "../../agent/config";
import { closeMcpClient } from "../../agent/mcp_client";
import { closePool, getPool } from "../../db/client";
import { parseGenerateArgs, USAGE } from "../../db/generate/args";
import { generateDataset } from "../../db/generate/scenarios";
import { InsertedClaim, ensureSchema, readSnapshot, writeDataset } from "../../db/generate/writer";
import { EvalResult, formatEvalReport } from "./report";

async function insertClaims(claimCount: number, seed: number): Promise<InsertedClaim[]> {
    const client = await getPool().connect();
    try {
        await ensureSchema(client);
        await client.query("BEGIN");
        const snapshot = await readSnapshot(client);
        const dataset = generateDataset({
            claimCount,
            seed,
            existingRules: snapshot.existingRules,
            takenPolicyNumbers: snapshot.takenPolicyNumbers,
        });
        const result = await writeDataset(client, dataset);
        await client.query("COMMIT");
        return result.claims;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
}

async function evaluate(claim: InsertedClaim): Promise<EvalResult> {
    const base = {
        claim_id: claim.id,
        scenario: claim.scenario,
        policy_type: claim.policy_type,
        damage_type: claim.damage_type,
        claim_amount: claim.claim_amount,
        max_coverage_amount: claim.max_coverage_amount,
    };
    const started = Date.now();
    try {
        const state = await app.invoke({
            messages: [new HumanMessage(`Please investigate claim ${claim.id}.`)],
            claim_id: claim.id,
        });
        return {
            ...base,
            decision: state.decision?.decision ?? null,
            confidence_score: state.decision?.confidence_score ?? null,
            status: state.claim_status ?? null,
            fallback: state.decision?.fallback ?? false,
            seconds: (Date.now() - started) / 1000,
        };
    } catch (err) {
        return {
            ...base,
            decision: null,
            confidence_score: null,
            status: null,
            fallback: false,
            seconds: (Date.now() - started) / 1000,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

async function main(): Promise<number> {
    const parsed = parseGenerateArgs(process.argv.slice(2));
    if (parsed.kind === "help") {
        console.log(USAGE.replace(/db:generate|db-generate/g, "eval"));
        return 0;
    }
    if (parsed.kind === "error") {
        console.error(`Error: ${parsed.message}`);
        return 2;
    }

    const seed = parsed.args.seed ?? Math.floor(Math.random() * 0x100000000);
    const threshold = getConfidenceThreshold();
    const claims = await insertClaims(parsed.args.claims, seed);
    console.error(
        `Evaluating ${claims.length} new claims (seed ${seed}, threshold ${threshold}) with ` +
            `${process.env.LLM_PROVIDER ?? "ollama"}/${process.env.LLM_MODEL ?? "llama3.1"}...`
    );

    const results: EvalResult[] = [];
    for (const [index, claim] of claims.entries()) {
        const result = await evaluate(claim);
        results.push(result);
        console.error(
            `[${index + 1}/${claims.length}] claim ${claim.id} ${claim.scenario}: ` +
                `${result.decision ?? "error"} ${result.confidence_score ?? "-"} (${result.seconds.toFixed(0)}s)`
        );
    }

    console.log(`\nDecision eval (seed ${seed}, threshold ${threshold})\n`);
    console.log(formatEvalReport(results, threshold));
    return results.some((r) => r.error !== undefined) ? 1 : 0;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((err: unknown) => {
        console.error("Decision eval failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeMcpClient();
        await closePool();
    });
