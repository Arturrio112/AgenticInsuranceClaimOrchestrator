import { Router, Request, Response } from "express";
import { signToken, AuthConfigError } from "../../auth/jwt";
import { verifyCredentials } from "../../auth/credentials";
import { logger } from "../../utils/logger";

interface LoginBody {
    username: string;
    password: string;
}

function isLoginBody(body: unknown): body is LoginBody {
    if (typeof body !== "object" || body === null) {
        return false;
    }
    const candidate = body as Record<string, unknown>;
    return (
        typeof candidate.username === "string" &&
        candidate.username !== "" &&
        typeof candidate.password === "string" &&
        candidate.password !== ""
    );
}

export const authRouter = Router();

authRouter.post("/login", (req: Request, res: Response): void => {
    if (!isLoginBody(req.body)) {
        res.status(400).json({ error: "Request body must include non-empty string fields 'username' and 'password'" });
        return;
    }

    const { username, password } = req.body;

    try {
        if (!verifyCredentials(username, password)) {
            res.status(401).json({ error: "Invalid credentials" });
            return;
        }
        res.json({ token: signToken({ sub: username }) });
    } catch (error) {
        if (error instanceof AuthConfigError) {
            logger.error("Login unavailable: authentication is not configured", { message: error.message });
            res.status(500).json({ error: "Authentication is not configured on the server" });
            return;
        }
        throw error;
    }
});
