import { Router, Request, Response } from "express";
import { requireAuth } from "../../auth/jwt";
import { getClaimById, listClaims } from "../../db/claims_repository";
import { logger } from "../../utils/logger";
import type { ClaimListResponse, ClaimSummary, ErrorResponse } from "../types";

/** Parses a route id; returns `null` unless it is a positive integer. */
export function parseClaimId(raw: string): number | null {
    if (!/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export const claimsRouter = Router();

claimsRouter.get("/claims", requireAuth, async (
    _req: Request,
    res: Response<ClaimListResponse | ErrorResponse>
): Promise<void> => {
    try {
        res.json({ claims: await listClaims() });
    } catch (error) {
        logger.error("Error listing claims:", error);
        res.status(500).json({ error: "Internal server error while listing claims" });
    }
});

claimsRouter.get("/claims/:id", requireAuth, async (
    req: Request<{ id: string }>,
    res: Response<ClaimSummary | ErrorResponse>
): Promise<void> => {
    const claimId = parseClaimId(req.params.id);
    if (claimId === null) {
        res.status(400).json({ error: "Claim id must be a positive integer" });
        return;
    }

    try {
        const claim = await getClaimById(claimId);
        if (!claim) {
            res.status(404).json({ error: `Claim ${claimId} not found` });
            return;
        }
        res.json(claim);
    } catch (error) {
        logger.error("Error fetching claim:", error);
        res.status(500).json({ error: "Internal server error while fetching claim" });
    }
});
