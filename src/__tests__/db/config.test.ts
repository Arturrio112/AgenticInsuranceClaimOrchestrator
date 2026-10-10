import { DbConfigError, getDbConfig } from "../../db/config";

// Test-only values; real deployments inject these via .env.
const FULL_DB_ENV: NodeJS.ProcessEnv = {
    DB_HOST: "db.internal",
    DB_PORT: "6543",
    DB_USER: "unit-test-user",
    DB_PASSWORD: "unit-test-password",
    DB_NAME: "unit_test_db",
};

function captureError(env: NodeJS.ProcessEnv): Error {
    try {
        getDbConfig(env);
    } catch (error) {
        if (error instanceof Error) return error;
        throw error;
    }
    throw new Error("Expected getDbConfig to throw");
}

describe("db/config getDbConfig", () => {
    it("uses DATABASE_URL on its own", () => {
        const url = "postgresql://u:p@localhost:5432/db";
        expect(getDbConfig({ DATABASE_URL: url })).toEqual({ connectionString: url });
    });

    it("prefers DATABASE_URL over the DB_* values", () => {
        const url = "postgresql://u:p@localhost:5432/db";
        expect(getDbConfig({ ...FULL_DB_ENV, DATABASE_URL: url })).toEqual({ connectionString: url });
    });

    it("builds the config from the full DB_* set", () => {
        expect(getDbConfig(FULL_DB_ENV)).toEqual({
            host: "db.internal",
            port: 6543,
            user: "unit-test-user",
            password: "unit-test-password",
            database: "unit_test_db",
        });
    });

    it("defaults only DB_HOST and DB_PORT", () => {
        const { DB_USER, DB_PASSWORD, DB_NAME } = FULL_DB_ENV;
        expect(getDbConfig({ DB_USER, DB_PASSWORD, DB_NAME })).toEqual({
            host: "localhost",
            port: 5432,
            user: "unit-test-user",
            password: "unit-test-password",
            database: "unit_test_db",
        });
    });

    it("throws when DB_PASSWORD is missing", () => {
        const env = { ...FULL_DB_ENV };
        delete env.DB_PASSWORD;
        const error = captureError(env);
        expect(error).toBeInstanceOf(DbConfigError);
        // Only the missing variable is listed, not the ones that are set.
        expect(error.message).toContain("missing DB_PASSWORD.");
    });

    it("treats empty or whitespace values as missing", () => {
        const error = captureError({ ...FULL_DB_ENV, DB_PASSWORD: "  ", DATABASE_URL: "" });
        expect(error.message).toContain("missing DB_PASSWORD");
    });

    it("names every missing variable and how to fix it", () => {
        const error = captureError({});
        expect(error).toBeInstanceOf(DbConfigError);
        expect(error.name).toBe("DbConfigError");
        expect(error.message).toContain("missing DB_USER, DB_PASSWORD, DB_NAME");
        expect(error.message).toContain("DATABASE_URL");
        expect(error.message).toContain(".env");
    });

    it("rejects a non-numeric DB_PORT", () => {
        const error = captureError({ ...FULL_DB_ENV, DB_PORT: "not-a-port" });
        expect(error).toBeInstanceOf(DbConfigError);
        expect(error.message).toContain("DB_PORT");
    });

    it("never falls back to built-in credentials", () => {
        expect(() => getDbConfig({ DB_NAME: "unit_test_db" })).toThrow(/missing DB_USER, DB_PASSWORD/);
    });
});
