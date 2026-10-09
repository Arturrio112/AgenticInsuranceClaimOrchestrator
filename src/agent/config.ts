export const DEFAULT_CONFIDENCE_THRESHOLD = 70;

/**
 * Minimum confidence (0-100) required for the agent's decision to be applied
 * automatically. Below it the claim is routed to `needs_human_review`.
 * Read on every call so tests and deployments can change it via env.
 */
export function getConfidenceThreshold(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.CONFIDENCE_THRESHOLD;
    if (raw === undefined || raw.trim() === "") return DEFAULT_CONFIDENCE_THRESHOLD;

    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
        return DEFAULT_CONFIDENCE_THRESHOLD;
    }
    return value;
}
