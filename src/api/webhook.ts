import express, { Request, Response } from "express";
import { app as graphApp } from "../agent/graph";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { messageText } from "../agent/decision";
import { ClaimRequest, ClaimResolutionResponse, ErrorResponse } from "./types";
import { CallbackHandler } from "langfuse-langchain";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { AuditCallbackHandler } from "../agent/callbacks/audit";
import { getAuditLogsForClaim } from "../db/audit_repository";
import { logger } from "../utils/logger";
import path from "path";
import { requireAuth } from "../auth/jwt";
import { authRouter } from "./routes/auth";

const app = express();
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "../../public")));

app.use(authRouter);

app.post("/claim", requireAuth, async (
    req: Request<Record<string, never>, ClaimResolutionResponse | ErrorResponse, ClaimRequest>,
    res: Response<ClaimResolutionResponse | ErrorResponse>
): Promise<void> => {
    try {
        const { claim_id } = req.body;

        if (!claim_id) {
            res.status(400).json({ error: "claim_id is required in the request body" });
            return;
        }

        const claimId = typeof claim_id === "string" ? Number(claim_id) : claim_id;
        if (!Number.isInteger(claimId) || claimId <= 0) {
            res.status(400).json({ error: "claim_id must be a positive integer" });
            return;
        }

        const initialState = {
            messages: [new HumanMessage(`Please investigate claim ${claimId}.`)],
            claim_id: claimId,
        };

        logger.info(`Processing claim request`, { claim_id: claimId });
        const auditTrail = new AuditCallbackHandler(claimId);
        const callbacks: BaseCallbackHandler[] = [auditTrail];
        if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
            callbacks.push(new CallbackHandler({
                publicKey: process.env.LANGFUSE_PUBLIC_KEY,
                secretKey: process.env.LANGFUSE_SECRET_KEY,
                baseUrl: process.env.LANGFUSE_BASEURL || "https://cloud.langfuse.com"
            }));
        }

        // Flush the audit trail (success or failure) so it is complete before we respond.
        const result = await graphApp.invoke(initialState, { callbacks }).finally(() => auditTrail.flush());

        if (!result.claim) {
            res.status(404).json({ error: `Claim ${claimId} not found` });
            return;
        }
        if (!result.decision || !result.claim_status) {
            throw new Error("Graph finished without a persisted decision");
        }

        const lastAgentMessage = [...result.messages].reverse().find((m) => AIMessage.isInstance(m));
        const response: ClaimResolutionResponse = {
            claim_id: claimId,
            status: result.claim_status,
            decision: result.decision,
            summary: lastAgentMessage ? messageText(lastAgentMessage.content) : "",
        };

        logger.info(`Claim processed successfully`, { claim_id: claimId, status: response.status });
        res.json(response);
    } catch (error) {
        logger.error("Error processing claim via webhook:", error);
        res.status(500).json({ error: "Internal server error while processing claim" });
    }
});

app.get("/claims/:id/audit", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const claimId = Number(req.params.id);
    if (!Number.isInteger(claimId) || claimId <= 0) {
        res.status(400).json({ error: "Claim id must be a positive integer" });
        return;
    }

    try {
        const entries = await getAuditLogsForClaim(claimId);
        res.json({ claim_id: claimId, count: entries.length, entries });
    } catch (error) {
        logger.error("Error fetching audit trail:", error);
        res.status(500).json({ error: "Internal server error while fetching audit trail" });
    }
});

export { app };
