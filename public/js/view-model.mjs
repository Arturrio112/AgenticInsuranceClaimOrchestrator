// @ts-check
/**
 * Pure, DOM-free presentation logic for the claims console.
 *
 * Everything here turns API data (see src/api/types.ts) into the words, tones
 * and numbers the UI shows. It has no side effects, so it is unit-tested
 * directly by src/__tests__/ui/viewModel.test.mjs.
 */

/** @typedef {"pending" | "approved" | "rejected" | "flagged" | "needs_human_review"} ClaimStatus */
/** @typedef {"approve" | "reject" | "flag"} DecisionVerdict */
/** @typedef {"positive" | "negative" | "caution" | "review" | "neutral"} Tone */

/**
 * @typedef {object} ClaimSummary
 * @property {number} id
 * @property {string | null} policy_number
 * @property {string | null} policy_type
 * @property {number | string} claim_amount  Postgres DECIMAL can arrive as a string.
 * @property {string} damage_type
 * @property {ClaimStatus} status
 * @property {string | null} description
 * @property {string} created_at
 */

/**
 * @typedef {object} PolicySource
 * @property {number} id
 * @property {string} policy_number
 * @property {string} status
 * @property {string} type
 */

/**
 * @typedef {object} CoverageRuleSource
 * @property {number} id
 * @property {string} policy_type
 * @property {string} damage_type
 * @property {number | string} max_coverage_amount
 * @property {string | null} conditions
 */

/**
 * @typedef {object} ClaimResolutionResponse
 * @property {number} claim_id
 * @property {ClaimStatus} status
 * @property {string} summary
 * @property {{ decision: DecisionVerdict, reasoning: string, confidence_score: number, fallback: boolean,
 *   citations: { policy_id: number | null, policy_number: string | null, coverage_rule_ids: number[] } }} decision
 * @property {ClaimSummary} [claim]
 * @property {{ policy: PolicySource | null, coverage_rules: CoverageRuleSource[] }} [sources]
 */

/**
 * Mirrors DEFAULT_CONFIDENCE_THRESHOLD in src/agent/config.ts. The API does not
 * expose the configured value, so the UI assumes the default.
 */
export const CONFIDENCE_THRESHOLD = 70;

/** @type {Record<ClaimStatus, { label: string, short: string, tone: Tone, icon: string, meaning: string }>} */
const STATUS_META = {
    pending: {
        label: "Pending",
        short: "Pending",
        tone: "neutral",
        icon: "clock",
        meaning: "Not investigated yet.",
    },
    approved: {
        label: "Approved",
        short: "Approved",
        tone: "positive",
        icon: "check",
        meaning: "The agent approved this claim for payout.",
    },
    rejected: {
        label: "Rejected",
        short: "Rejected",
        tone: "negative",
        icon: "cross",
        meaning: "The agent rejected this claim.",
    },
    flagged: {
        label: "Flagged",
        short: "Flagged",
        tone: "caution",
        icon: "flag",
        meaning: "The agent flagged this claim as needing a closer look.",
    },
    needs_human_review: {
        label: "Needs human review",
        short: "Needs review",
        tone: "review",
        icon: "person",
        meaning: "The agent was not confident enough to decide on its own, so a person must review it.",
    },
};

/** @type {Record<DecisionVerdict, { label: string, verb: string }>} */
const VERDICT_META = {
    approve: { label: "Approve", verb: "approving" },
    reject: { label: "Reject", verb: "rejecting" },
    flag: { label: "Flag", verb: "flagging" },
};

/** @param {unknown} status */
export function isClaimStatus(status) {
    return typeof status === "string" && Object.prototype.hasOwnProperty.call(STATUS_META, status);
}

/**
 * Label, tone and icon for a claim status. Unknown values fall back to a neutral badge.
 * @param {string} status
 */
export function statusMeta(status) {
    if (isClaimStatus(status)) return { status, ...STATUS_META[/** @type {ClaimStatus} */ (status)] };
    return { status, label: humanize(status) || "Unknown", short: humanize(status) || "Unknown", tone: /** @type {Tone} */ ("neutral"), icon: "clock", meaning: "Unknown status." };
}

/** @param {string} verdict */
export function verdictMeta(verdict) {
    if (verdict === "approve" || verdict === "reject" || verdict === "flag") return VERDICT_META[verdict];
    return { label: humanize(verdict), verb: `choosing "${verdict}"` };
}

/**
 * "water_damage" -> "Water damage".
 * @param {string | null | undefined} value
 */
export function humanize(value) {
    if (!value) return "";
    const text = String(value).replace(/[_-]+/g, " ").trim().toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * @param {number | string | null | undefined} value
 * @returns {number | null}
 */
export function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * Whole-dollar amounts drop the cents: 1500 -> "$1,500", 99.5 -> "$99.50".
 * @param {number | string | null | undefined} amount
 */
export function formatCurrency(amount) {
    const n = toNumber(amount);
    if (n === null) return "Unknown amount";
    const whole = Number.isInteger(n);
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
    }).format(n);
}

/**
 * "2026-10-01T09:30:00Z" -> "Oct 1, 2026". Invalid input returns "".
 * @param {string | null | undefined} iso
 */
export function formatDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

/**
 * Milliseconds -> "m:ss".
 * @param {number} ms
 */
export function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * One-line description of a claim for list rows and headers.
 * @param {ClaimSummary} claim
 */
export function claimLine(claim) {
    const damage = humanize(claim.damage_type) || "Unspecified damage";
    const policy = claim.policy_type ? `${humanize(claim.policy_type).toLowerCase()} policy` : "unknown policy";
    return `${damage} on ${policy}`;
}

/**
 * Newest claim first. The order depends only on the id, so rows never jump
 * around when an investigation changes a claim's status.
 * @param {ClaimSummary[]} claims
 * @returns {ClaimSummary[]}
 */
export function sortClaims(claims) {
    return [...claims].sort((a, b) => b.id - a.id);
}

/**
 * "2 pending, 1 needs review, 3 resolved" style summary for the list header.
 * @param {ClaimSummary[]} claims
 */
export function claimCounts(claims) {
    let pending = 0;
    let review = 0;
    let resolved = 0;
    for (const claim of claims) {
        if (claim.status === "pending") pending += 1;
        else if (claim.status === "needs_human_review") review += 1;
        else resolved += 1;
    }
    const parts = [];
    if (pending) parts.push(`${pending} pending`);
    if (review) parts.push(`${review} need${review === 1 ? "s" : ""} review`);
    if (resolved) parts.push(`${resolved} resolved`);
    return { pending, review, resolved, text: parts.join(", ") };
}

/**
 * Where a confidence score sits relative to the auto-resolve threshold.
 * @param {number | string | null | undefined} score
 * @param {number} [threshold]
 */
export function confidenceBand(score, threshold = CONFIDENCE_THRESHOLD) {
    const raw = toNumber(score);
    const value = raw === null ? 0 : Math.round(Math.min(100, Math.max(0, raw)));
    const below = value < threshold;
    /** @type {"low" | "moderate" | "high"} */
    let band;
    if (below) band = "low";
    else if (value < Math.min(100, threshold + 15)) band = "moderate";
    else band = "high";

    const label = { low: "Low confidence", moderate: "Moderate confidence", high: "High confidence" }[band];
    const explanation = below
        ? `Below the ${threshold} threshold, so the decision was not applied automatically. A person needs to review this claim.`
        : `At or above the ${threshold} threshold, so the decision was applied automatically.`;

    return { value, threshold, below, band, label, explanation };
}

/**
 * The headline for a finished investigation.
 * @param {ClaimResolutionResponse} result
 */
export function verdictSummary(result) {
    const meta = statusMeta(result.status);
    const verdict = verdictMeta(result.decision.decision);
    const confidence = confidenceBand(result.decision.confidence_score);

    let sentence;
    if (result.decision.fallback) {
        sentence = "The agent could not produce a usable decision, so this claim was routed to a person.";
    } else if (result.status === "needs_human_review") {
        sentence = `The agent leaned towards ${verdict.verb} this claim, but its confidence (${confidence.value}) is below ${confidence.threshold}, so a person needs to make the call.`;
    } else {
        sentence = meta.meaning;
    }
    return { ...meta, sentence, agentVerdict: verdict.label };
}

/**
 * @param {PolicySource} policy
 */
export function policyCard(policy) {
    const status = humanize(policy.status) || "Unknown status";
    const type = humanize(policy.type).toLowerCase() || "unknown";
    return {
        id: policy.id,
        title: `Policy ${policy.policy_number}`,
        body: `${status} ${type} policy.`,
        active: String(policy.status).toLowerCase() === "active",
    };
}

/**
 * "Rule #3: home policy, water damage, covered up to $10,000."
 * @param {CoverageRuleSource} rule
 * @param {boolean} [cited]
 */
export function coverageRuleCard(rule, cited = true) {
    const policyType = humanize(rule.policy_type).toLowerCase() || "any";
    const damage = humanize(rule.damage_type).toLowerCase() || "any damage";
    const conditions = rule.conditions && rule.conditions.trim() ? rule.conditions.trim() : null;
    return {
        id: rule.id,
        title: `Rule #${rule.id}`,
        body: `${humanize(policyType)} policy, ${damage}, covered up to ${formatCurrency(rule.max_coverage_amount)}.`,
        conditions: conditions ? `Conditions: ${conditions}` : "No extra conditions.",
        cited,
    };
}

/**
 * Builds the "Source of truth" section: the cited policy and coverage rules,
 * plus any cited IDs the server could not resolve.
 * @param {ClaimResolutionResponse} result
 */
export function sourceOfTruth(result) {
    const citations = result.decision.citations;
    const sources = result.sources ?? { policy: null, coverage_rules: [] };
    const citedIds = new Set(citations.coverage_rule_ids);

    const policy = sources.policy ? policyCard(sources.policy) : null;
    /** @type {string | null} */
    let policyNote = null;
    if (!policy) {
        policyNote = citations.policy_number || citations.policy_id !== null
            ? `The agent cited policy ${citations.policy_number ?? `#${citations.policy_id}`}, but its details are not available.`
            : "The agent did not cite a policy.";
    }

    const rules = sources.coverage_rules.map((rule) => coverageRuleCard(rule, citedIds.has(rule.id)));
    rules.sort((a, b) => Number(b.cited) - Number(a.cited) || a.id - b.id);

    const known = new Set(sources.coverage_rules.map((rule) => rule.id));
    const missingRuleIds = citations.coverage_rule_ids.filter((id) => !known.has(id));

    const empty = !policy && rules.length === 0 && missingRuleIds.length === 0;
    return {
        policy,
        policyNote,
        rules,
        missingRuleIds,
        empty,
        rulesNote: rules.length === 0 && missingRuleIds.length === 0 ? "The agent did not cite any coverage rules." : null,
    };
}

/**
 * The agent's pipeline, in order. `typicalMs` is when the stage usually ends,
 * used only to animate progress while waiting: the API answers once at the end.
 */
export const PIPELINE_STAGES = [
    { key: "load", label: "Load claim", detail: "Reads the claim and its policy number from the database.", typicalMs: 1500 },
    { key: "policy", label: "Check policy", detail: "Calls the get_policy tool to confirm the policy exists and is active.", typicalMs: 9000 },
    { key: "coverage", label: "Check coverage", detail: "Calls the check_coverage tool for the limit and conditions on this damage type.", typicalMs: 20000 },
    { key: "decide", label: "Decide", detail: "Writes a structured decision with reasoning, a 0-100 confidence score and citations.", typicalMs: Number.POSITIVE_INFINITY },
    { key: "save", label: "Save", detail: "Stores the result. Low confidence routes the claim to human review.", typicalMs: Number.POSITIVE_INFINITY },
];

/**
 * Index of the stage to show as active after `elapsedMs`. Never advances past
 * "Decide" on time alone: "Save" only completes when the server answers.
 * @param {number} elapsedMs
 */
export function activeStageIndex(elapsedMs) {
    const decide = PIPELINE_STAGES.findIndex((stage) => stage.key === "decide");
    for (let i = 0; i < decide; i += 1) {
        if (elapsedMs < PIPELINE_STAGES[i].typicalMs) return i;
    }
    return decide;
}

/**
 * Narrows an unknown JSON body to a ClaimResolutionResponse.
 * @param {unknown} data
 * @returns {data is ClaimResolutionResponse}
 */
export function isResolutionResponse(data) {
    if (typeof data !== "object" || data === null) return false;
    const d = /** @type {Record<string, any>} */ (data);
    return (
        typeof d.claim_id === "number" &&
        typeof d.status === "string" &&
        typeof d.decision === "object" &&
        d.decision !== null &&
        typeof d.decision.decision === "string" &&
        typeof d.decision.reasoning === "string" &&
        typeof d.decision.citations === "object" &&
        d.decision.citations !== null &&
        Array.isArray(d.decision.citations.coverage_rule_ids)
    );
}
