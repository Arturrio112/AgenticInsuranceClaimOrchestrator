/**
 * Pure, DB-free generation of test policies, coverage rules and claims.
 *
 * Every claim belongs to one scenario that targets a different agent outcome.
 * The scenario is returned alongside the claim for the console summary only;
 * it is never written to the database or into the description.
 *
 * Generation is deterministic: the same options (seed, claim count, existing
 * rules and taken policy numbers) always produce the same dataset.
 */
import {
    CatalogRule,
    DescriptionTemplate,
    PolicyType,
    Rng,
    RULE_CATALOG,
    RuleSpec,
    UNCOVERED_DAMAGE,
    QUOTE_SENTENCES,
    UncoveredDamage,
} from "./catalog";

export interface ScenarioInfo {
    id: ScenarioId;
    /** Human-readable explanation for the console summary and README. */
    summary: string;
    /** What the agent is expected to do. Informational only. */
    expected: string;
    /**
     * True when the facts conflict or are uncertain, so the decision should land
     * below the confidence threshold (needs_human_review). Used by the decision eval.
     */
    lowConfidence: boolean;
}

export const SCENARIO_IDS = [
    "covered",
    "over_limit",
    "inactive_policy",
    "no_rule",
    "exclusion",
    "at_limit",
    "contradictory_damage",
    "uncertain_evidence",
    "uncertain_cause",
    "amount_mismatch",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

const LOW_CONFIDENCE = "low confidence -> needs_human_review (any verdict)";

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioInfo>> = {
    covered: {
        id: "covered",
        summary: "Active policy, matching rule, amount well under the limit",
        expected: "approve",
        lowConfidence: false,
    },
    over_limit: {
        id: "over_limit",
        summary: "Amount above the rule's max_coverage_amount",
        expected: "reject or flag",
        lowConfidence: false,
    },
    inactive_policy: {
        id: "inactive_policy",
        summary: "Policy status is inactive or lapsed",
        expected: "reject",
        lowConfidence: false,
    },
    no_rule: {
        id: "no_rule",
        summary: "No coverage rule for the policy type and damage type",
        expected: "reject or flag",
        lowConfidence: false,
    },
    exclusion: {
        id: "exclusion",
        summary: "The description triggers an exclusion in the rule's conditions",
        expected: "reject or flag",
        lowConfidence: false,
    },
    at_limit: {
        id: "at_limit",
        summary: "Amount exactly equal to the limit",
        expected: "approve",
        lowConfidence: false,
    },
    contradictory_damage: {
        id: "contradictory_damage",
        summary: "The description describes a different kind of damage than damage_type",
        expected: LOW_CONFIDENCE,
        lowConfidence: true,
    },
    uncertain_evidence: {
        id: "uncertain_evidence",
        summary: "A rule condition requires evidence the claimant is unsure exists",
        expected: LOW_CONFIDENCE,
        lowConfidence: true,
    },
    uncertain_cause: {
        id: "uncertain_cause",
        summary: "The cause could fall on either side of a rule exclusion",
        expected: LOW_CONFIDENCE,
        lowConfidence: true,
    },
    amount_mismatch: {
        id: "amount_mismatch",
        summary: "The description states a quote or invoice far below claim_amount",
        expected: LOW_CONFIDENCE,
        lowConfidence: true,
    },
};

export const INACTIVE_STATUSES = ["inactive", "lapsed"] as const;
export type PolicyStatus = "active" | (typeof INACTIVE_STATUSES)[number];

/** A coverage rule already in the database. Pass them ordered by id, as `check_coverage` uses the first match. */
export interface ExistingRule {
    policy_type: string;
    damage_type: string;
    max_coverage_amount: number;
    conditions: string | null;
}

export interface GenerateOptions {
    claimCount: number;
    seed: number;
    /** Rules already in the database. Their limits win over the catalog's so amounts stay consistent. */
    existingRules?: readonly ExistingRule[];
    /** Policy numbers already in the database; generated numbers avoid them. */
    takenPolicyNumbers?: Iterable<string>;
}

export interface GeneratedPolicy {
    user_id: string;
    policy_number: string;
    status: PolicyStatus;
    type: PolicyType;
}

export interface GeneratedClaim {
    policy_number: string;
    policy_type: PolicyType;
    damage_type: string;
    claim_amount: number;
    description: string;
    /**
     * Damage type whose description templates wrote `description`. Equal to
     * `damage_type` except for contradictory_damage. For tests and the console only; never persisted.
     */
    described_damage_type: string;
    /** For the console summary only; never persisted. */
    scenario: ScenarioId;
    /** The limit the amount was derived from, or null when no rule applies. */
    max_coverage_amount: number | null;
}

export interface GeneratedDataset {
    seed: number;
    policies: GeneratedPolicy[];
    /** Catalog rules missing from the database. */
    rules: RuleSpec[];
    claims: GeneratedClaim[];
}

/** mulberry32: small, fast, seedable PRNG. Good enough for test data, not for cryptography. */
export function createRng(seed: number): Rng {
    let state = seed >>> 0;
    const next = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        between: (min, max) => min + next() * (max - min),
        pick: <T>(items: readonly T[]): T => {
            if (items.length === 0) throw new Error("Cannot pick from an empty list");
            return items[Math.floor(next() * items.length)];
        },
    };
}

/** Rounds to cents. */
export function toMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

/** A catalog rule merged with the database's copy of it, if any. */
interface EffectiveRule {
    catalog: CatalogRule;
    max: number;
    existsInDb: boolean;
    /** False when the DB copy's conditions differ, since condition-specific texts would no longer apply. */
    conditionsMatch: boolean;
}

interface ClaimDraft {
    policy_type: PolicyType;
    damage_type: string;
    claim_amount: number;
    description: string;
    described_damage_type: string;
    status: PolicyStatus;
    max_coverage_amount: number | null;
}

const ruleKey = (policyType: string, damageType: string): string => `${policyType}/${damageType}`;

function resolveRules(existing: readonly ExistingRule[]): EffectiveRule[] {
    const firstByKey = new Map<string, ExistingRule>();
    for (const rule of existing) {
        const key = ruleKey(rule.policy_type, rule.damage_type);
        if (!firstByKey.has(key)) firstByKey.set(key, rule);
    }
    return RULE_CATALOG.map((catalog) => {
        const db = firstByKey.get(ruleKey(catalog.policy_type, catalog.damage_type));
        const conditionsMatch = db === undefined || (db.conditions ?? "").trim() === catalog.conditions.trim();
        return {
            catalog,
            max: db === undefined ? catalog.max_coverage_amount : Number(db.max_coverage_amount),
            existsInDb: db !== undefined,
            conditionsMatch,
        };
    });
}

function describe(rng: Rng, rule: EffectiveRule, amount: number): string {
    const templates: readonly DescriptionTemplate[] =
        amount > rule.max * 0.5 && rule.catalog.major.length > 0 ? rule.catalog.major : rule.catalog.minor;
    return rng.pick(templates)(rng);
}

function draftFor(
    rule: EffectiveRule,
    amount: number,
    description: string,
    status: PolicyStatus,
    describedDamageType: string = rule.catalog.damage_type
): ClaimDraft {
    return {
        policy_type: rule.catalog.policy_type,
        damage_type: rule.catalog.damage_type,
        claim_amount: amount,
        description,
        described_damage_type: describedDamageType,
        status,
        max_coverage_amount: rule.max,
    };
}

type ScenarioBuilder = (rng: Rng) => ClaimDraft;

/** amount_mismatch: the figure stated in the description is this fraction of claim_amount. */
export const MISMATCH_MIN_RATIO = 0.2;
export const MISMATCH_MAX_RATIO = 0.45;

/** "$1,234" (whole dollars), the way a claimant would write a quote. */
export function formatDollars(value: number): string {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** An amount in [3%, 30%] of the limit, but at least `min` (e.g. a $1000 evidence threshold) and at most the limit. */
function amountAbove(rng: Rng, rule: EffectiveRule, min: number): number {
    const low = Math.max(min, rule.max * 0.03);
    const high = Math.max(low, rule.max * 0.3);
    return Math.min(toMoney(rng.between(low, high)), rule.max);
}

interface DescriptionSource {
    damage_type: string;
    templates: readonly DescriptionTemplate[];
}

/**
 * Description templates of every *other* damage category of the same policy type
 * (other catalog rules and uncovered damage types). A claim filed as `rule`'s
 * damage type but described with one of these contradicts itself.
 */
function contradictionSources(
    rule: EffectiveRule,
    rules: readonly EffectiveRule[],
    uncovered: readonly UncoveredDamage[]
): DescriptionSource[] {
    const { policy_type, damage_type } = rule.catalog;
    const fromRules = rules
        .filter((r) => r.catalog.policy_type === policy_type && r.catalog.damage_type !== damage_type)
        .map((r) => ({ damage_type: r.catalog.damage_type, templates: [...r.catalog.minor, ...r.catalog.major] }));
    const fromUncovered = uncovered
        .filter((d) => d.policy_type === policy_type && d.damage_type !== damage_type)
        .map((d) => ({ damage_type: d.damage_type, templates: d.descriptions }));
    return [...fromRules, ...fromUncovered].filter((s) => s.templates.length > 0);
}

/**
 * Returns a builder per scenario that can be produced with the current rules.
 * A scenario is missing when no rule or damage type supports it (e.g. every
 * uncovered damage type already has a rule in the database).
 */
function scenarioBuilders(rules: readonly EffectiveRule[], uncovered: readonly UncoveredDamage[]): Map<ScenarioId, ScenarioBuilder> {
    const usable = rules.filter((r) => r.max > 0);
    const withExclusion = usable.filter((r) => r.conditionsMatch && r.catalog.exclusion.length > 0);
    const withUncertainEvidence = usable.filter((r) => r.conditionsMatch && r.catalog.uncertainEvidence.length > 0);
    const withUncertainCause = usable.filter((r) => r.conditionsMatch && r.catalog.uncertainCause.length > 0);
    const builders = new Map<ScenarioId, ScenarioBuilder>();
    if (usable.length === 0) return builders;

    builders.set("covered", (rng) => {
        const rule = rng.pick(usable);
        const amount = Math.max(0.01, toMoney(rule.max * rng.between(0.15, 0.6)));
        return draftFor(rule, amount, describe(rng, rule, amount), "active");
    });

    builders.set("over_limit", (rng) => {
        const rule = rng.pick(usable);
        const amount = Math.max(toMoney(rule.max + 0.01), toMoney(rule.max * rng.between(1.15, 1.8)));
        return draftFor(rule, amount, rng.pick(rule.catalog.major)(rng), "active");
    });

    builders.set("inactive_policy", (rng) => {
        const rule = rng.pick(usable);
        const amount = Math.max(0.01, toMoney(rule.max * rng.between(0.1, 0.5)));
        return draftFor(rule, amount, describe(rng, rule, amount), rng.pick(INACTIVE_STATUSES));
    });

    if (uncovered.length > 0) {
        builders.set("no_rule", (rng) => {
            const damage = rng.pick(uncovered);
            return {
                policy_type: damage.policy_type,
                damage_type: damage.damage_type,
                claim_amount: toMoney(rng.between(damage.minAmount, damage.maxAmount)),
                description: rng.pick(damage.descriptions)(rng),
                described_damage_type: damage.damage_type,
                status: "active",
                max_coverage_amount: null,
            };
        });
    }

    if (withExclusion.length > 0) {
        builders.set("exclusion", (rng) => {
            const rule = rng.pick(withExclusion);
            const amount = amountAbove(rng, rule, rule.catalog.exclusionMinAmount ?? 0);
            return draftFor(rule, amount, rng.pick(rule.catalog.exclusion)(rng), "active");
        });
    }

    builders.set("at_limit", (rng) => {
        const rule = rng.pick(usable);
        return draftFor(rule, rule.max, rng.pick(rule.catalog.major)(rng), "active");
    });

    const contradictions = usable
        .map((rule) => ({ rule, sources: contradictionSources(rule, rules, uncovered) }))
        .filter((c) => c.sources.length > 0);
    if (contradictions.length > 0) {
        builders.set("contradictory_damage", (rng) => {
            const { rule, sources } = rng.pick(contradictions);
            const source = rng.pick(sources);
            const amount = Math.max(0.01, toMoney(rule.max * rng.between(0.1, 0.5)));
            return draftFor(rule, amount, rng.pick(source.templates)(rng), "active", source.damage_type);
        });
    }

    if (withUncertainEvidence.length > 0) {
        builders.set("uncertain_evidence", (rng) => {
            const rule = rng.pick(withUncertainEvidence);
            const amount = amountAbove(rng, rule, rule.catalog.uncertainEvidenceMinAmount ?? 0);
            return draftFor(rule, amount, rng.pick(rule.catalog.uncertainEvidence)(rng), "active");
        });
    }

    if (withUncertainCause.length > 0) {
        builders.set("uncertain_cause", (rng) => {
            const rule = rng.pick(withUncertainCause);
            const amount = amountAbove(rng, rule, 0);
            return draftFor(rule, amount, rng.pick(rule.catalog.uncertainCause)(rng), "active");
        });
    }

    builders.set("amount_mismatch", (rng) => {
        const rule = rng.pick(usable);
        const amount = Math.max(0.01, toMoney(rule.max * rng.between(0.3, 0.8)));
        const quoted = Math.max(1, Math.round(amount * rng.between(MISMATCH_MIN_RATIO, MISMATCH_MAX_RATIO)));
        const quote = rng.pick(QUOTE_SENTENCES[rule.catalog.policy_type])(formatDollars(quoted));
        return draftFor(rule, amount, `${describe(rng, rule, amount)} ${quote}`, "active");
    });

    return builders;
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * Picks the scenario of every claim. The first claims cover each available
 * scenario once (in shuffled order); the rest are drawn at random.
 */
function planScenarios(rng: Rng, available: readonly ScenarioId[], count: number): ScenarioId[] {
    const firstRound = shuffle(rng, available);
    const plan: ScenarioId[] = [];
    for (let i = 0; i < count; i++) {
        plan.push(i < firstRound.length ? firstRound[i] : rng.pick(available));
    }
    return plan;
}

const MAX_POLICY_NUMBER_ATTEMPTS = 10000;

function newPolicyNumber(rng: Rng, type: PolicyType, taken: Set<string>): string {
    for (let attempt = 0; attempt < MAX_POLICY_NUMBER_ATTEMPTS; attempt++) {
        const candidate = `POL-${type.toUpperCase()}-${rng.int(10000, 99999)}`;
        if (!taken.has(candidate)) {
            taken.add(candidate);
            return candidate;
        }
    }
    throw new Error(`Could not find a free ${type} policy number after ${MAX_POLICY_NUMBER_ATTEMPTS} attempts`);
}

/** Generates one new policy per claim, the missing catalog rules and the claims themselves. */
export function generateDataset(options: GenerateOptions): GeneratedDataset {
    const { claimCount, seed } = options;
    if (!Number.isInteger(claimCount) || claimCount < 0) {
        throw new Error(`claimCount must be a non-negative integer, got ${claimCount}`);
    }
    const existing = options.existingRules ?? [];
    const rng = createRng(seed);
    const taken = new Set(options.takenPolicyNumbers ?? []);

    const rules = resolveRules(existing);
    const existingKeys = new Set(existing.map((r) => ruleKey(r.policy_type, r.damage_type)));
    const uncovered = UNCOVERED_DAMAGE.filter((d) => !existingKeys.has(ruleKey(d.policy_type, d.damage_type)));
    const builders = scenarioBuilders(rules, uncovered);
    const available = SCENARIO_IDS.filter((id) => builders.has(id));
    if (available.length === 0 && claimCount > 0) {
        throw new Error("No scenario can be generated: every coverage rule has a non-positive limit");
    }

    const policies: GeneratedPolicy[] = [];
    const claims: GeneratedClaim[] = [];
    for (const scenario of planScenarios(rng, available, claimCount)) {
        const build = builders.get(scenario);
        if (build === undefined) continue; // unreachable: plan only contains available scenarios
        const draft = build(rng);
        const policy: GeneratedPolicy = {
            user_id: `user_${rng.int(1000, 99999)}`,
            policy_number: newPolicyNumber(rng, draft.policy_type, taken),
            status: draft.status,
            type: draft.policy_type,
        };
        policies.push(policy);
        claims.push({
            policy_number: policy.policy_number,
            policy_type: draft.policy_type,
            damage_type: draft.damage_type,
            claim_amount: draft.claim_amount,
            description: draft.description,
            described_damage_type: draft.described_damage_type,
            scenario,
            max_coverage_amount: draft.max_coverage_amount,
        });
    }

    return {
        seed,
        policies,
        rules: rules
            .filter((r) => !r.existsInDb)
            .map(({ catalog }) => ({
                policy_type: catalog.policy_type,
                damage_type: catalog.damage_type,
                max_coverage_amount: catalog.max_coverage_amount,
                conditions: catalog.conditions,
            })),
        claims,
    };
}
