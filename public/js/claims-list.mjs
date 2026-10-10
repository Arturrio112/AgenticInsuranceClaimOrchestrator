// @ts-check
/** The selectable claims list, with its loading, empty and error states. */
import { badge, clear, h, icon } from "./dom.mjs";
import { claimLine, formatCurrency, humanize, sortClaims, statusMeta } from "./view-model.mjs";

/** @typedef {import("./view-model.mjs").ClaimSummary} ClaimSummary */

/**
 * @typedef {object} ListState
 * @property {"loading" | "error" | "ready"} phase
 * @property {ClaimSummary[]} claims
 * @property {number | null} selectedId
 * @property {number | null} runningId
 * @property {string} [error]
 */

/**
 * @param {HTMLElement} container
 * @param {ListState} state
 * @param {{ onSelect: (id: number) => void, onRetry: () => void }} handlers
 */
export function renderClaimsList(container, state, handlers) {
    clear(container);
    container.setAttribute("aria-busy", String(state.phase === "loading"));

    if (state.phase === "loading" && state.claims.length === 0) {
        container.append(
            h("p", { class: "list-status" }, "Loading claims…"),
            h("ul", { class: "claim-list is-skeleton", "aria-hidden": "true" }, ...[0, 1, 2].map(() => h("li", { class: "claim-skeleton" }))),
        );
        return;
    }

    if (state.phase === "error") {
        container.append(
            h(
                "div",
                { class: "notice tone-negative", role: "alert" },
                icon("alert", "icon icon-small"),
                h(
                    "div",
                    null,
                    h("p", { class: "notice-title" }, "Claims could not be loaded"),
                    h("p", null, state.error ?? "Something went wrong."),
                    h("button", { type: "button", class: "btn btn-quiet btn-small", onclick: handlers.onRetry }, "Try again"),
                ),
            ),
        );
        return;
    }

    if (state.claims.length === 0) {
        container.append(
            h(
                "div",
                { class: "empty" },
                h("p", { class: "empty-title" }, "No claims yet"),
                h("p", null, "Load the demo data with ", h("code", null, "make db-seed"), ", then refresh this list."),
            ),
        );
        return;
    }

    const list = h("ul", { class: "claim-list" });
    for (const claim of sortClaims(state.claims)) {
        const selected = claim.id === state.selectedId;
        const running = claim.id === state.runningId;
        const meta = statusMeta(claim.status);
        const policy = claim.policy_number ? `Policy ${claim.policy_number}` : "No policy on file";

        list.append(
            h(
                "li",
                null,
                h(
                    "button",
                    {
                        type: "button",
                        class: `claim-row${selected ? " is-selected" : ""}`,
                        "aria-current": selected ? "true" : null,
                        "data-claim-id": claim.id,
                        onclick: () => handlers.onSelect(claim.id),
                    },
                    h("span", { class: "claim-id" }, `#${claim.id}`),
                    h(
                        "span",
                        { class: "claim-main" },
                        h("span", { class: "claim-title" }, claim.description || claimLine(claim)),
                        h("span", { class: "claim-meta" }, claim.description ? `${humanize(claim.damage_type)}, ${policy}` : policy),
                    ),
                    h("span", { class: "claim-amount" }, formatCurrency(claim.claim_amount)),
                    running
                        ? h("span", { class: "badge tone-active" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Investigating")
                        : badge(meta),
                ),
            ),
        );
    }
    container.append(list);
}
