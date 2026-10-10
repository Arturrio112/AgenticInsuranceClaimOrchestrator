/**
 * Pure formatting for the decision eval (`make eval`): one row per claim, then a
 * per-scenario roll-up that checks the confidence score against the threshold.
 */
import type { ClaimStatus } from "../../db/schema";
import type { DecisionVerdict } from "../../agent/decision";
import { SCENARIO_IDS, SCENARIOS, ScenarioId } from "../../db/generate/scenarios";

export interface EvalResult {
    claim_id: number;
    scenario: ScenarioId;
    policy_type: string;
    damage_type: string;
    claim_amount: number;
    max_coverage_amount: number | null;
    /** Null when the graph threw before producing a decision. */
    decision: DecisionVerdict | null;
    confidence_score: number | null;
    status: ClaimStatus | null;
    /** True when decide_node used its safe fallback (unparseable model output). */
    fallback: boolean;
    seconds: number;
    error?: string;
}

export interface ScenarioRollup {
    scenario: ScenarioId;
    claims: number;
    /** "low" = confidence should be below the threshold; "high" = at or above it. */
    expect: "low" | "high";
    verdicts: string;
    scores: number[];
    /** Claims whose confidence landed on the expected side of the threshold. */
    hits: number;
}

/** True when the result's confidence is on the side of the threshold its scenario expects. */
export function meetsExpectation(result: EvalResult, threshold: number): boolean {
    if (result.confidence_score === null) return false;
    const low = result.confidence_score < threshold;
    return SCENARIOS[result.scenario].lowConfidence ? low : !low;
}

function countVerdicts(results: readonly EvalResult[]): string {
    const counts = new Map<string, number>();
    for (const r of results) {
        const key = r.decision === null ? "error" : r.fallback ? `${r.decision}(fallback)` : r.decision;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([verdict, n]) => `${verdict} x${n}`).join(", ");
}

/** Groups results by scenario, in SCENARIO_IDS order, skipping scenarios with no claims. */
export function rollup(results: readonly EvalResult[], threshold: number): ScenarioRollup[] {
    return SCENARIO_IDS.flatMap((scenario) => {
        const group = results.filter((r) => r.scenario === scenario);
        if (group.length === 0) return [];
        return [
            {
                scenario,
                claims: group.length,
                expect: SCENARIOS[scenario].lowConfidence ? "low" : "high",
                verdicts: countVerdicts(group),
                scores: group.flatMap((r) => (r.confidence_score === null ? [] : [r.confidence_score])),
                hits: group.filter((r) => meetsExpectation(r, threshold)).length,
            },
        ];
    });
}

function renderTable(headers: readonly string[], rows: readonly string[][]): string {
    const widths = headers.map((h, col) => Math.max(h.length, ...rows.map((row) => row[col].length)));
    const line = (cells: readonly string[]): string =>
        cells
            .map((cell, col) => cell.padEnd(widths[col]))
            .join("  ")
            .trimEnd();
    return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

const money = (value: number | null): string => (value === null ? "-" : value.toFixed(2));

/** The full console report: per-claim table, per-scenario table and the two pass rates. */
export function formatEvalReport(results: readonly EvalResult[], threshold: number): string {
    const claimRows = results.map((r) => [
        String(r.claim_id),
        r.scenario,
        `${r.policy_type}/${r.damage_type}`,
        money(r.claim_amount),
        money(r.max_coverage_amount),
        r.decision === null ? "error" : r.fallback ? `${r.decision}(fallback)` : r.decision,
        r.confidence_score === null ? "-" : String(r.confidence_score),
        r.status ?? "-",
        meetsExpectation(r, threshold) ? "ok" : "MISS",
        r.seconds.toFixed(0),
    ]);
    const groups = rollup(results, threshold);
    const scenarioRows = groups.map((g) => [
        g.scenario,
        String(g.claims),
        g.expect === "low" ? `< ${threshold}` : `>= ${threshold}`,
        g.verdicts,
        g.scores.join(", "),
        `${g.hits}/${g.claims}`,
    ]);

    const rate = (expect: "low" | "high"): string => {
        const selected = groups.filter((g) => g.expect === expect);
        const hits = selected.reduce((sum, g) => sum + g.hits, 0);
        const total = selected.reduce((sum, g) => sum + g.claims, 0);
        return `${hits}/${total}`;
    };

    const errors = results.filter((r) => r.error !== undefined).map((r) => `  claim ${r.claim_id}: ${r.error}`);

    return [
        renderTable(
            ["claim", "scenario", "damage", "amount", "limit", "decision", "confidence", "status", "check", "secs"],
            claimRows
        ),
        "",
        renderTable(["scenario", "n", "expect", "verdicts", "confidence scores", "hits"], scenarioRows),
        "",
        `Uncertain scenarios below ${threshold} (needs_human_review): ${rate("low")}`,
        `Clear-cut scenarios at or above ${threshold}: ${rate("high")}`,
        ...(errors.length > 0 ? ["", "Errors:", ...errors] : []),
    ].join("\n");
}
