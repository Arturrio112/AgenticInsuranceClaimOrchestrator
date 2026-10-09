import request from "supertest";
import { app } from "../../api/webhook";
import { verifyToken } from "../../auth/jwt";
import { app as graphApp } from "../../agent/graph";

// Keep the LLM and database out of these tests entirely.
jest.mock("../../agent/graph", () => ({
    app: { invoke: jest.fn() },
}));

const ORIGINAL_ENV = { ...process.env };
const USERNAME = "test-user";
const PASSWORD = "test-password";

describe("POST /login", () => {
    beforeEach(() => {
        process.env = {
            ...ORIGINAL_ENV,
            JWT_SECRET: "login-test-secret",
            AUTH_USERNAME: USERNAME,
            AUTH_PASSWORD: PASSWORD,
        };
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it("returns a verifiable token for valid credentials", async () => {
        const response = await request(app)
            .post("/login")
            .send({ username: USERNAME, password: PASSWORD })
            .expect(200);

        expect(typeof response.body.token).toBe("string");
        expect(verifyToken(response.body.token)?.sub).toBe(USERNAME);
    });

    it("returns 401 for a wrong password", async () => {
        const response = await request(app)
            .post("/login")
            .send({ username: USERNAME, password: "nope" })
            .expect(401);
        expect(response.body).toEqual({ error: "Invalid credentials" });
    });

    it("returns 401 for a wrong username", async () => {
        await request(app)
            .post("/login")
            .send({ username: "someone-else", password: PASSWORD })
            .expect(401);
    });

    it("no longer accepts the old hardcoded credentials", async () => {
        await request(app)
            .post("/login")
            .send({ username: "admin", password: "password123" })
            .expect(401);
    });

    it.each([
        ["an empty body", {}],
        ["a missing password", { username: USERNAME }],
        ["non-string fields", { username: 123, password: ["x"] }],
        ["empty strings", { username: "", password: "" }],
    ])("returns 400 for %s", async (_label, body) => {
        const response = await request(app).post("/login").send(body).expect(400);
        expect(response.body.error).toMatch(/username/);
    });

    it("returns 500 when credentials are not configured", async () => {
        delete process.env.AUTH_PASSWORD;
        const response = await request(app)
            .post("/login")
            .send({ username: USERNAME, password: PASSWORD })
            .expect(500);
        expect(response.body.error).toBe("Authentication is not configured on the server");
    });
});

describe("POST /claim authentication", () => {
    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV, JWT_SECRET: "login-test-secret" };
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it("rejects a request without a token before invoking the graph", async () => {
        await request(app).post("/claim").send({ claim_id: 1 }).expect(401);
        expect(graphApp.invoke).not.toHaveBeenCalled();
    });
});
