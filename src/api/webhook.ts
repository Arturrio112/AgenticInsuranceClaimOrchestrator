import express, { Request, Response } from "express";
import { app as graphApp } from "../agent/graph";
import { HumanMessage } from "@langchain/core/messages";

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

        const result = await graphApp.invoke(initialState);
        
        const messages = result.messages;
        const lastMessage = messages[messages.length - 1];
        
        res.json({
            content: lastMessage.content
        });
    } catch (error) {
        console.error("Error processing claim via webhook:", error);
        res.status(500).json({ error: "Internal server error while processing claim" });
    }
});

export { app };
