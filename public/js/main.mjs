// @ts-check
/**
 * Entry point: wires the sign-in view, the claims list and the case panel
 * together. All state lives in `state`; render functions read from it.
 */
import { ApiError, UnauthorizedError, investigateClaim, listClaims, login } from "./api.mjs";
import { renderClaimsList } from "./claims-list.mjs";
import { append, badge, clear, h } from "./dom.mjs";
import { renderPipeline } from "./pipeline.mjs";
import { clearResult, renderError, renderPreviousDecision, renderResult } from "./result.mjs";
import { clearToken, getToken, setToken } from "./session.mjs";
import {
    activeStageIndex,
    claimCounts,
    confidenceBand,
    formatCurrency,
    formatDate,
    formatElapsed,
    humanize,
    statusMeta,
    thresholdOf,
} from "./view-model.mjs";

/** @typedef {import("./view-model.mjs").ClaimSummary} ClaimSummary */
/** @typedef {import("./view-model.mjs").ClaimResolutionResponse} ClaimResolutionResponse */

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id}`);
    return /** @type {T} */ (el);
}

const els = {
    signinView: byId("signin-view"),
    signinForm: /** @type {HTMLFormElement} */ (byId("signin-form")),
    signinError: byId("signin-error"),
    signinSubmit: /** @type {HTMLButtonElement} */ (byId("signin-submit")),
    username: /** @type {HTMLInputElement} */ (byId("username")),
    password: /** @type {HTMLInputElement} */ (byId("password")),
    signOut: /** @type {HTMLButtonElement} */ (byId("sign-out")),
    consoleView: byId("console-view"),
    claimsBody: byId("claims-body"),
    claimsCounts: byId("claims-counts"),
    refresh: /** @type {HTMLButtonElement} */ (byId("refresh-claims")),
    caseSection: byId("case"),
    caseIntro: byId("case-intro"),
    caseClaim: byId("case-claim"),
    pipeline: byId("pipeline"),
    runBar: byId("run-bar"),
    runButton: /** @type {HTMLButtonElement} */ (byId("run-button")),
    runNote: byId("run-note"),
    result: byId("result"),
    announcer: byId("announcer"),
};

const state = {
    /** @type {"loading" | "error" | "ready"} */
    phase: "loading",
    /** @type {ClaimSummary[]} */
    claims: [],
    /** @type {string | undefined} */
    listError: undefined,
    /** @type {number | null} */
    selectedId: null,
    /** @type {{ claimId: number, startedAt: number, active: number, timer: number } | null} */
    running: null,
    /** @type {Map<number, ClaimResolutionResponse>} */
    results: new Map(),
    /** @type {Map<number, { message: string, failedAt: number }>} */
    errors: new Map(),
};

const narrow = window.matchMedia("(max-width: 959px)");

/** @param {string} message */
function announce(message) {
    els.announcer.textContent = "";
    // A fresh text node makes screen readers announce repeated messages too.
    window.setTimeout(() => {
        els.announcer.textContent = message;
    }, 50);
}

/* ---------- Sign-in ---------- */

/** @param {string} [message] */
function showSignIn(message) {
    stopRunning();
    state.results.clear();
    state.errors.clear();
    state.selectedId = null;
    els.consoleView.hidden = true;
    els.signOut.hidden = true;
    els.signinView.hidden = false;
    els.signinError.hidden = !message;
    els.signinError.textContent = message ?? "";
    els.password.value = "";
    els.username.focus();
}

function showConsole() {
    els.signinView.hidden = true;
    els.consoleView.hidden = false;
    els.signOut.hidden = false;
    renderCase();
    void loadClaims();
}

els.signinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = els.username.value.trim();
    const password = els.password.value;
    if (!username || !password) {
        els.signinError.textContent = "Enter both a username and a password.";
        els.signinError.hidden = false;
        (username ? els.password : els.username).focus();
        return;
    }

    els.signinSubmit.disabled = true;
    els.signinSubmit.textContent = "Signing in…";
    els.signinError.hidden = true;
    try {
        setToken(await login(username, password));
        els.password.value = "";
        showConsole();
    } catch (error) {
        els.signinError.textContent = error instanceof ApiError ? error.message : "Sign-in failed. Try again.";
        els.signinError.hidden = false;
    } finally {
        els.signinSubmit.disabled = false;
        els.signinSubmit.textContent = "Sign in";
    }
});

els.signOut.addEventListener("click", () => {
    clearToken();
    showSignIn();
});

/** @param {unknown} error */
function handleAuthError(error) {
    if (error instanceof UnauthorizedError) {
        showSignIn(error.message);
        return true;
    }
    return false;
}

/* ---------- Claims list ---------- */

async function loadClaims() {
    state.phase = "loading";
    renderList();
    try {
        state.claims = await listClaims();
        state.phase = "ready";
    } catch (error) {
        if (handleAuthError(error)) return;
        state.phase = "error";
        state.listError = error instanceof Error ? error.message : String(error);
    }
    renderList();
    renderCase();
}

function renderList() {
    renderClaimsList(
        els.claimsBody,
        {
            phase: state.phase,
            claims: state.claims,
            selectedId: state.selectedId,
            runningId: state.running?.claimId ?? null,
            error: state.listError,
        },
        { onSelect: selectClaim, onRetry: () => void loadClaims() },
    );
    els.claimsCounts.textContent = state.phase === "ready" && state.claims.length ? claimCounts(state.claims).text : "";
    els.refresh.disabled = state.phase === "loading";
}

/** @param {number} id */
function selectClaim(id) {
    state.selectedId = id;
    renderList();
    renderCase();
    if (narrow.matches) {
        els.caseSection.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
        els.caseSection.focus({ preventScroll: true });
    }
}

els.refresh.addEventListener("click", () => void loadClaims());

/** @param {ClaimSummary} updated */
function upsertClaim(updated) {
    const index = state.claims.findIndex((c) => c.id === updated.id);
    if (index === -1) state.claims.push(updated);
    else state.claims[index] = { ...state.claims[index], ...updated };
}

/* ---------- Case panel ---------- */

function selectedClaim() {
    return state.claims.find((c) => c.id === state.selectedId) ?? null;
}

/** @param {ClaimSummary} claim */
function renderClaimHeader(claim) {
    clear(els.caseClaim);
    const meta = statusMeta(claim.status);
    const facts = [
        ["Amount claimed", formatCurrency(claim.claim_amount)],
        ["Damage type", humanize(claim.damage_type) || "Not specified"],
        ["Policy", claim.policy_number ? `${claim.policy_number}${claim.policy_type ? ` (${humanize(claim.policy_type).toLowerCase()})` : ""}` : "No policy on file"],
        ["Filed", formatDate(claim.created_at) || "Unknown"],
    ];
    append(els.caseClaim, [
        h("button", { type: "button", class: "back-link", onclick: backToList }, "Back to claims"),
        h(
            "div",
            { class: "case-head" },
            h("h2", { class: "case-title", id: "case-claim-title" }, `Claim #${claim.id}`),
            badge(meta),
        ),
        claim.description ? h("p", { class: "case-description" }, claim.description) : null,
        h("dl", { class: "facts" }, ...facts.map(([term, value]) => h("div", { class: "fact" }, h("dt", null, term), h("dd", null, value)))),
    ]);
}

function backToList() {
    const row = els.claimsBody.querySelector(`[data-claim-id="${state.selectedId}"]`);
    els.claimsBody.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    if (row instanceof HTMLElement) row.focus({ preventScroll: true });
}

function renderCase() {
    const claim = selectedClaim();

    if (!claim) {
        els.caseIntro.hidden = false;
        els.caseClaim.hidden = true;
        els.runBar.hidden = true;
        els.caseSection.setAttribute("aria-labelledby", "case-intro-title");
        renderPipeline(els.pipeline, { mode: "idle" });
        clearResult(els.result);
        return;
    }

    els.caseIntro.hidden = true;
    els.caseClaim.hidden = false;
    els.runBar.hidden = false;
    renderClaimHeader(claim);
    els.caseSection.setAttribute("aria-labelledby", "case-claim-title");

    const running = state.running;
    const isRunningHere = running?.claimId === claim.id;
    const result = state.results.get(claim.id);
    const error = state.errors.get(claim.id);

    if (isRunningHere && running) renderPipeline(els.pipeline, { mode: "running", active: running.active });
    else if (result) renderPipeline(els.pipeline, { mode: "done" });
    else if (error) renderPipeline(els.pipeline, { mode: "failed", at: error.failedAt });
    else renderPipeline(els.pipeline, { mode: "idle" });

    updateRunBar();

    if (isRunningHere) clearResult(els.result);
    else if (result) renderResult(els.result, result);
    else if (error) renderError(els.result, error.message);
    else if (claim.status !== "pending") renderPreviousDecision(els.result, claim.status);
    else clearResult(els.result);
}

function updateRunBar() {
    const claim = selectedClaim();
    if (!claim) return;
    const running = state.running;
    const busy = running !== null;
    const decided = claim.status !== "pending" || state.results.has(claim.id);

    els.runButton.disabled = busy;
    els.runButton.setAttribute("aria-busy", String(running?.claimId === claim.id));

    if (running && running.claimId === claim.id) {
        els.runButton.textContent = "Investigating…";
        els.runNote.textContent = `Running for ${formatElapsed(Date.now() - running.startedAt)}. A local model usually needs 30 to 90 seconds.`;
    } else if (running) {
        els.runButton.textContent = "Run AI investigation";
        els.runNote.textContent = `Claim #${running.claimId} is being investigated. You can run this one when it finishes.`;
    } else {
        els.runButton.textContent = decided ? "Run investigation again" : "Run AI investigation";
        els.runNote.textContent = "Takes 30 to 90 seconds on a local model.";
    }
}

/* ---------- Investigation ---------- */

function stopRunning() {
    if (state.running) window.clearInterval(state.running.timer);
    state.running = null;
}

function tick() {
    const running = state.running;
    if (!running) return;
    const active = activeStageIndex(Date.now() - running.startedAt);
    const changed = active !== running.active;
    running.active = active;
    if (running.claimId !== state.selectedId) return;
    if (changed) renderPipeline(els.pipeline, { mode: "running", active });
    updateRunBar();
}

async function runInvestigation() {
    const claim = selectedClaim();
    if (!claim || state.running) return; // Guards against double submits.

    const claimId = claim.id;
    state.errors.delete(claimId);
    state.results.delete(claimId);
    state.running = { claimId, startedAt: Date.now(), active: 0, timer: window.setInterval(tick, 500) };
    announce(`Investigating claim ${claimId}. This can take up to a minute and a half.`);
    renderList();
    renderCase();

    try {
        const result = await investigateClaim(claimId);
        stopRunning();
        state.results.set(claimId, result);
        upsertClaim(result.claim ? { ...result.claim, status: result.status } : { ...claim, status: result.status });
        const label = statusMeta(result.status).label;
        announce(`Claim ${claimId} investigated: ${label}. Confidence ${confidenceBand(result.decision.confidence_score, thresholdOf(result)).value} out of 100.`);
        renderList();
        renderCase();
        if (state.selectedId === claimId) els.result.focus({ preventScroll: false });
    } catch (error) {
        const failedAt = state.running?.active ?? 0;
        stopRunning();
        if (handleAuthError(error)) return;
        const message =
            error instanceof ApiError && error.status === 404
                ? `${error.message}. It may have been removed; refresh the list.`
                : error instanceof Error
                  ? error.message
                  : String(error);
        state.errors.set(claimId, { message, failedAt });
        announce(`Investigation of claim ${claimId} did not finish. ${message}`);
        renderList();
        renderCase();
    }
}

els.runButton.addEventListener("click", () => void runInvestigation());

/* ---------- Boot ---------- */

function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

for (const list of document.querySelectorAll('[data-pipeline="static"]')) {
    if (list instanceof HTMLElement) renderPipeline(list, { mode: "idle" });
}

if (getToken()) showConsole();
else showSignIn();
