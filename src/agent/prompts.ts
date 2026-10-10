import type { ClaimContext } from "./state";

export const SYSTEM_PROMPT = `You are an AI Insurance Claim Orchestrator.
Your job is to investigate an insurance claim by calling tools and collecting the facts needed for a decision.
You do NOT write to the database. A separate step will record the final decision.

You have access to these tools:
1. get_policy(policy_number): Get policy details (id, status, type).
2. check_coverage(policy_type, damage_type): Get the coverage rule (id, max_coverage_amount, conditions).

The claim details are given below under "CLAIM". Follow these steps:
1. Call get_policy with the claim's policy_number. Check that the policy status is 'active' and note its type.
2. Call check_coverage with the policy type and the claim's damage_type.
3. Compare the claim_amount against max_coverage_amount and read the conditions.
4. When you have the facts, stop calling tools and reply with a short plain-text summary of what you found.`;

/** Renders the claim loaded from the DB so the model never has to guess it. */
export function formatClaimContext(claim: ClaimContext): string {
    return `CLAIM:
- claim_id: ${claim.id}
- policy_id: ${claim.policy_id}
- policy_number: ${claim.policy_number ?? "unknown"}
- claim_amount: ${claim.claim_amount}
- damage_type: ${claim.damage_type}
- description: ${claim.description ?? "none"}`;
}

/**
 * Points the confidence checklist subtracts for each conflicting or unconfirmed fact.
 * Chosen so that a single such problem is enough to land below `threshold`
 * (100 - penalty < threshold); 40 for the default threshold of 70.
 */
export function confidencePenalty(threshold: number): number {
    return Math.min(100, Math.max(10, Math.round(110 - threshold)));
}

/**
 * System prompt for the decide step. The confidence part is a checklist with
 * fixed deductions because small local models ignore a one-line "use below 50
 * when unclear" hint and answer 100 every time.
 */
export function buildDecisionSystemPrompt(threshold: number): string {
    const penalty = confidencePenalty(threshold);
    const vaguePenalty = Math.round(penalty / 2);
    return `You are an insurance claim adjudicator. Read the CLAIM and the TOOL RESULTS below and return ONE decision.

Decision rules (apply in order):
1. "reject"  - the policy was not found, the policy status is not 'active', or no coverage rule exists for the damage type.
2. "flag"    - the claim_amount is greater than max_coverage_amount, a condition requires evidence that is not available, or the facts are unclear.
3. "approve" - the policy is active, a coverage rule exists, and claim_amount is less than or equal to max_coverage_amount.

Fields to return:
- decision: exactly one of "approve", "reject", "flag".
- reasoning: 2 to 4 sentences. Mention the policy status, the coverage rule and the amount comparison. End with the checklist result and the score, e.g. "Checklist: none -> 100." or "Checklist: B (no confirmed police report) -> ${100 - penalty}."
- confidence_score: an integer from 0 to 100 (NOT a fraction), worked out with the CONFIDENCE CHECKLIST below.
- citations.policy_id: the "id" number from the get_policy result, or null.
- citations.policy_number: the "policy_number" from the get_policy result, or null.
- citations.coverage_rule_ids: the "id" numbers from the check_coverage results. Use [] if there were none.

CONFIDENCE CHECKLIST
confidence_score says how sure you are that the facts support your decision. Start at 100.
Compare the description with damage_type, claim_amount and the coverage rule's conditions, then subtract points for EVERY problem that applies:
A. -${penalty}: the description describes a different kind of damage or event than damage_type (example: damage_type "glass" but the description is about an engine failure or a burglary).
B. -${penalty}: a condition of the coverage rule requires evidence (a police report, an airline report, signs of forced entry) and the description does not clearly confirm it. Words like "I think", "I believe", "maybe", "may have", "not sure" or "can't tell" mean it is NOT confirmed.
C. -${penalty}: the cause could fall under an exclusion in the conditions and the description does not make clear which side it is on (example: "not sure if it was the river or the roof" when floods are not covered).
D. -${penalty}: the description states a money figure (quote, invoice, bill, receipts) that is clearly different from claim_amount.
E. -${vaguePenalty}: the description is too vague to tell what happened.
The score cannot go below 0. Use this table; do not invent other numbers:
- no problems: 100
- only E: ${100 - vaguePenalty}
- one of A, B, C, D: ${100 - penalty}
- one of A, B, C, D plus E: ${Math.max(0, 100 - penalty - vaguePenalty)}
- two or more of A, B, C, D: ${Math.max(0, 100 - 2 * penalty)}

These cases are clear, so they are NOT checklist problems. Keep confidence_score at 90-100 for them:
- the policy is not active (reject).
- no coverage rule exists for the damage type (reject).
- claim_amount is clearly greater than max_coverage_amount (flag).
- an exclusion clearly applies (reject or flag).
- every fact matches and claim_amount is within the limit (approve).
Being certain that a claim must be rejected or flagged is still high confidence.

If the result is below ${threshold}, the claim goes to a human reviewer. That is the correct outcome when facts conflict or are not confirmed, so do not round the score up.

IMPORTANT: Only cite IDs that appear in the TOOL RESULTS. Never invent IDs.`;
}
