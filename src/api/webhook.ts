import express, { Request, Response } from "express";
import { app as graphApp } from "../agent/graph";
import { HumanMessage } from "@langchain/core/messages";
import { CallbackHandler } from "langfuse-langchain";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { AuditCallbackHandler } from "../agent/callbacks/audit_callback";
import { getAuditLogsForClaim } from "../db/audit_repository";
import { logger } from "../utils/logger";
import path from "path";
import { requireAuth } from "../auth/jwt";
import { authRouter } from "./routes/auth";

const app = express();
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "../../public")));

interface ClaimRequest {
    claim_id?: number | string;
}

app.use(authRouter);

app.post("/claim", requireAuth, async (req: Request<Record<string, never>, any, ClaimRequest>, res: Response): Promise<void> => {
    try {
        const { claim_id } = req.body;
        
        if (!claim_id) {
            res.status(400).json({ error: "claim_id is required in the request body" });
            return;
        }

        const initialState = {
            messages: [new HumanMessage(`Please process claim ${claim_id}.`)],
            claim_id: typeof claim_id === "string" ? parseInt(claim_id, 10) : claim_id
        };

        logger.info(`Processing claim request`, { claim_id });
        const auditTrail = new AuditCallbackHandler(initialState.claim_id);
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
        
        const messages = result.messages;
        const lastMessage = messages[messages.length - 1];
        
        logger.info(`Claim processed successfully`, { claim_id });
        res.json({
            content: lastMessage.content
        });
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
