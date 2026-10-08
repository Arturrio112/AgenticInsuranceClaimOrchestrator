import express, { Request, Response } from "express";
import { app as graphApp } from "../agent/graph";
import { HumanMessage } from "@langchain/core/messages";
import { CallbackHandler } from "langfuse-langchain";
import { logger } from "../utils/logger";

const app = express();
app.use(express.json());

interface ClaimRequest {
    claim_id?: number | string;
}

app.post("/claim", async (req: Request<Record<string, never>, any, ClaimRequest>, res: Response): Promise<void> => {
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
        const langfuseHandler = new CallbackHandler({
            publicKey: process.env.LANGFUSE_PUBLIC_KEY,
            secretKey: process.env.LANGFUSE_SECRET_KEY,
            baseUrl: process.env.LANGFUSE_BASEURL || "https://cloud.langfuse.com"
        });

        const result = await graphApp.invoke(initialState, { callbacks: [langfuseHandler] });
        
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

export { app };
