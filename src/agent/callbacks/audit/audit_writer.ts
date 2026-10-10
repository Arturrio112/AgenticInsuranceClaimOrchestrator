import { insertAuditLog, NewAuditLog } from "../../../db/audit_repository";
import { AuditEventType } from "../../../db/schema";
import { logger } from "../../../utils/logger";
import { toJsonSafe } from "./json_safe";
import { AuditPayload } from "./types";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Persists the audit events of one claim run into `audit_logs`.
 *
 * - Entries get a gapless `step_index` and are written sequentially in event order.
 * - Never throws: failures are logged and swallowed so auditing cannot break claim processing.
 * - Is a no-op for an invalid claim id.
 */
export class AuditWriter {
    private stepIndex = 0;
    private queue: Promise<void> = Promise.resolve();
    private readonly enabled: boolean;

    constructor(readonly claimId: number, readonly runId: string) {
        this.enabled = Number.isInteger(claimId) && claimId > 0;
        if (!this.enabled) {
            logger.warn("Audit trail disabled: invalid claim_id", { claim_id: claimId });
        }
    }

    record(eventType: AuditEventType, nodeName: string | null, payload: AuditPayload): void {
        if (!this.enabled) return;
        try {
            const entry: NewAuditLog = {
                claim_id: this.claimId,
                run_id: this.runId,
                step_index: this.stepIndex++,
                event_type: eventType,
                node_name: nodeName,
                payload: toJsonSafe(payload),
            };
            this.queue = this.queue.then(() => this.write(entry));
        } catch (error) {
            logger.error("Failed to build audit log entry", {
                claim_id: this.claimId,
                event_type: eventType,
                error: errorMessage(error),
            });
        }
    }

    /** Resolves once every queued entry has been written (or has failed and been logged). */
    async flush(): Promise<void> {
        await this.queue;
    }

    private async write(entry: NewAuditLog): Promise<void> {
        try {
            await insertAuditLog(entry);
        } catch (error) {
            logger.error("Failed to write audit log entry", {
                claim_id: entry.claim_id,
                run_id: entry.run_id,
                event_type: entry.event_type,
                error: errorMessage(error),
            });
        }
    }
}
