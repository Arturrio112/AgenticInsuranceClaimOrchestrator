// @ts-check
/**
 * The five-step pipeline. The same component explains how the agent works
 * (idle) and shows progress while an investigation runs.
 */
import { clear, h, icon } from "./dom.mjs";
import { PIPELINE_STAGES } from "./view-model.mjs";

/**
 * @typedef {{ mode: "idle" } | { mode: "running", active: number } | { mode: "done" } | { mode: "failed", at: number }} PipelineState
 */

/**
 * @param {number} index
 * @param {PipelineState} state
 * @returns {"idle" | "done" | "active" | "upcoming" | "failed"}
 */
function stepState(index, state) {
    switch (state.mode) {
        case "idle":
            return "idle";
        case "done":
            return "done";
        case "running":
            if (index < state.active) return "done";
            return index === state.active ? "active" : "upcoming";
        case "failed":
            if (index < state.at) return "done";
            return index === state.at ? "failed" : "upcoming";
    }
}

/** @type {Record<string, string>} */
const STATE_TEXT = {
    done: "Done",
    active: "In progress",
    upcoming: "Waiting",
    failed: "Stopped here",
};

/**
 * @param {HTMLOListElement | HTMLElement} list
 * @param {PipelineState} state
 * @param {{ details?: boolean }} [options]
 */
export function renderPipeline(list, state, options = {}) {
    const showDetails = options.details ?? true;
    list.dataset.mode = state.mode;
    clear(list);
    PIPELINE_STAGES.forEach((stage, index) => {
        const s = stepState(index, state);
        let marker;
        if (s === "done") marker = icon("check", "icon step-icon");
        else if (s === "failed") marker = icon("cross", "icon step-icon");
        else marker = h("span", { class: "step-number", "aria-hidden": "true" }, String(index + 1));

        list.append(
            h(
                "li",
                { class: `step step-${s}`, "aria-current": s === "active" ? "step" : null },
                h("span", { class: "step-marker" }, marker),
                h(
                    "span",
                    { class: "step-text" },
                    h("span", { class: "step-label" }, stage.label),
                    s in STATE_TEXT ? h("span", { class: "sr-only" }, `: ${STATE_TEXT[s]}`) : null,
                    showDetails ? h("span", { class: "step-detail" }, stage.detail) : null,
                ),
            ),
        );
    });
}
