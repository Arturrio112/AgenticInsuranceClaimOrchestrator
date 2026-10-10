// @ts-check
/** Renders the outcome of an investigation into the case panel. */
import { append, clear, h, icon } from "./dom.mjs";
import { confidenceBand, sourceOfTruth, statusMeta, thresholdOf, verdictSummary } from "./view-model.mjs";

/** @typedef {import("./view-model.mjs").ClaimResolutionResponse} ClaimResolutionResponse */

/** @param {ClaimResolutionResponse} result */
function verdictBlock(result) {
    const summary = verdictSummary(result);
    return h(
        "div",
        { class: `verdict tone-${summary.tone}` },
        h(
            "p",
            { class: "stamp", "data-animate": "stamp" },
            icon(summary.icon, "icon stamp-icon"),
            h("span", { class: "stamp-text" }, summary.label),
        ),
        h(
            "div",
            { class: "verdict-copy" },
            h("p", { class: "verdict-sentence" }, summary.sentence),
            result.status === "needs_human_review" && !result.decision.fallback
                ? h("p", { class: "verdict-aside" }, "Agent's recommendation: ", h("strong", null, summary.agentVerdict))
                : null,
        ),
    );
}

/** @param {ClaimResolutionResponse} result */
function confidenceBlock(result) {
    const band = confidenceBand(result.decision.confidence_score, thresholdOf(result));
    return h(
        "div",
        { class: `confidence band-${band.band}` },
        h(
            "div",
            { class: "confidence-head" },
            h("h3", { class: "section-title" }, "Confidence"),
            h("p", { class: "confidence-value" }, h("strong", null, String(band.value)), " / 100", h("span", { class: "confidence-band" }, band.label)),
        ),
        h(
            "div",
            { class: "meter", "aria-hidden": "true", style: `--value: ${band.value}; --threshold: ${band.threshold}` },
            h("div", { class: "meter-fill" }),
            h("div", { class: "meter-threshold" }, h("span", { class: "meter-threshold-label" }, `Threshold ${band.threshold}`)),
        ),
        h("p", { class: "confidence-explainer" }, band.explanation),
    );
}

/** @param {ClaimResolutionResponse} result */
function sourcesBlock(result) {
    const sot = sourceOfTruth(result);
    const cards = [];

    if (sot.policy) {
        cards.push(
            h(
                "li",
                { class: "source-card source-policy" },
                h("p", { class: "source-kind" }, icon("doc", "icon icon-small"), "Policy"),
                h("p", { class: "source-title" }, sot.policy.title),
                h("p", { class: "source-body" }, sot.policy.body),
                sot.policy.active ? null : h("p", { class: "source-warning" }, icon("alert", "icon icon-small"), "This policy is not active."),
            ),
        );
    }

    for (const rule of sot.rules) {
        cards.push(
            h(
                "li",
                { class: `source-card source-rule${rule.cited ? "" : " is-uncited"}` },
                h("p", { class: "source-kind" }, icon("doc", "icon icon-small"), rule.cited ? "Coverage rule, cited" : "Coverage rule, checked but not cited"),
                h("p", { class: "source-title" }, rule.title),
                h("p", { class: "source-body" }, rule.body),
                h("p", { class: "source-conditions" }, rule.conditions),
            ),
        );
    }

    for (const id of sot.missingRuleIds) {
        cards.push(
            h(
                "li",
                { class: "source-card is-missing" },
                h("p", { class: "source-kind" }, icon("doc", "icon icon-small"), "Coverage rule, cited"),
                h("p", { class: "source-title" }, `Rule #${id}`),
                h("p", { class: "source-body" }, "Details for this rule were not returned by the server."),
            ),
        );
    }

    const notes = [sot.policyNote, sot.rulesNote].filter(Boolean);
    return h(
        "section",
        { class: "sources", "aria-labelledby": "sources-title" },
        h("h3", { class: "section-title", id: "sources-title" }, "Source of truth"),
        h("p", { class: "section-lede" }, "The policy and coverage rules the agent based its decision on, as stored in the database."),
        cards.length ? h("ul", { class: "source-list" }, ...cards) : null,
        ...notes.map((note) => h("p", { class: "source-note" }, note)),
    );
}

/**
 * @param {HTMLElement} container
 * @param {ClaimResolutionResponse} result
 */
export function renderResult(container, result) {
    clear(container);
    container.dataset.state = "result";
    append(container, [
        h("h2", { class: "sr-only" }, "Investigation result"),
        verdictBlock(result),
        result.decision.fallback
            ? h(
                  "p",
                  { class: "notice tone-caution" },
                  icon("alert", "icon icon-small"),
                  "The model's answer could not be read as a valid decision, so a safe default was used: flag the claim with confidence 0 and send it to a person.",
              )
            : null,
        confidenceBlock(result),
        h(
            "section",
            { class: "reasoning", "aria-labelledby": "reasoning-title" },
            h("h3", { class: "section-title", id: "reasoning-title" }, "Reasoning"),
            h("p", null, result.decision.reasoning),
        ),
        sourcesBlock(result),
        result.summary
            ? h(
                  "details",
                  { class: "agent-summary" },
                  h("summary", null, "Agent's investigation notes"),
                  h("p", { class: "agent-summary-text" }, result.summary),
              )
            : null,
    ]);
}

/**
 * For a claim already decided before this session: no decision details are available.
 * @param {HTMLElement} container
 * @param {string} status
 */
export function renderPreviousDecision(container, status) {
    const meta = statusMeta(status);
    clear(container);
    container.dataset.state = "previous";
    container.append(
        h(
            "p",
            { class: "notice tone-neutral" },
            icon(meta.icon, "icon icon-small"),
            `This claim was already decided: ${meta.label}. Run the investigation again to see the agent's reasoning and the rules it relied on.`,
        ),
    );
}

/**
 * @param {HTMLElement} container
 * @param {string} message
 */
export function renderError(container, message) {
    clear(container);
    container.dataset.state = "error";
    container.append(
        h(
            "div",
            { class: "notice tone-negative", role: "alert" },
            icon("alert", "icon icon-small"),
            h("div", null, h("p", { class: "notice-title" }, "The investigation did not finish"), h("p", null, message)),
        ),
    );
}

/** @param {HTMLElement} container */
export function clearResult(container) {
    clear(container);
    delete container.dataset.state;
}
