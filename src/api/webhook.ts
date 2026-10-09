import express, { Request, Response, NextFunction } from "express";
import { app as graphApp } from "../agent/graph";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { messageText } from "../agent/decision";
import { ClaimRequest, ClaimResolutionResponse, ErrorResponse } from "./types";
import jwt from "jsonwebtoken";
import { CallbackHandler } from "langfuse-langchain";
import { logger } from "../utils/logger";
import path from "path";

const app = express();
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "../../public")));

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const validateJWT = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid Bearer token" });
        return;
    }

    const token = authHeader.split(" ")[1];

    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: "Invalid token" });
    }
};

app.post("/login", (req: Request, res: Response): void => {
    const { username, password } = req.body;

    if (username === "admin" && password === "password123") {
        const token = jwt.sign({ username }, JWT_SECRET);
        res.json({ token });
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

app.post("/claim", validateJWT, async (
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
        const callbacks = [];
        if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
            callbacks.push(new CallbackHandler({
                publicKey: process.env.LANGFUSE_PUBLIC_KEY,
                secretKey: process.env.LANGFUSE_SECRET_KEY,
                baseUrl: process.env.LANGFUSE_BASEURL || "https://cloud.langfuse.com"
            }));
        }

        const result = await graphApp.invoke(initialState, { callbacks });

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

export { app };
