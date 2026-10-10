/** Formats the generator's console summary. Pure string building. */
import { SCENARIO_IDS, SCENARIOS } from "./scenarios";
import type { WriteResult } from "./writer";

function formatAmount(value: number): string {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderTable(headers: readonly string[], rows: readonly string[][], rightAligned: ReadonlySet<number>): string {
    const widths = headers.map((h, col) => Math.max(h.length, ...rows.map((row) => row[col].length)));
    const line = (cells: readonly string[]): string =>
        cells
            .map((cell, col) => (rightAligned.has(col) ? cell.padStart(widths[col]) : cell.padEnd(widths[col])))
            .join("  ")
            .trimEnd();
    return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

/** Counts, a table of the new claims and a legend of the scenarios that appear in it. */
export function formatSummary(result: WriteResult, seed: number): string {
    const rows = result.claims.map((c) => [
        String(c.id),
        c.policy_number,
        c.policy_type,
        c.damage_type,
        formatAmount(c.claim_amount),
        c.max_coverage_amount === null ? "-" : formatAmount(c.max_coverage_amount),
        c.scenario,
    ]);
    const table = renderTable(["id", "policy", "type", "damage", "amount", "limit", "scenario"], rows, new Set([0, 4, 5]));

    const used = new Set(result.claims.map((c) => c.scenario));
    const idWidth = Math.max(...SCENARIO_IDS.map((id) => id.length));
    const legend = SCENARIO_IDS.filter((id) => used.has(id)).map((id) => {
        const info = SCENARIOS[id];
        return `  ${id.padEnd(idWidth)}  ${info.summary} -> expect: ${info.expected}`;
    });

    return [
        `Inserted ${result.policiesInserted} policies, ${result.rulesInserted} coverage rules, ` +
            `${result.claims.length} pending claims (seed ${seed}).`,
        "",
        table,
        "",
        "Scenarios (console only, not stored in the database):",
        ...legend,
    ].join("\n");
}
