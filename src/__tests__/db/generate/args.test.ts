import { DEFAULT_CLAIM_COUNT, MAX_CLAIM_COUNT, parseGenerateArgs } from "../../../db/generate/args";

describe("parseGenerateArgs", () => {
    it("uses the defaults when no arguments are given", () => {
        expect(parseGenerateArgs([])).toEqual({ kind: "ok", args: { claims: DEFAULT_CLAIM_COUNT, seed: undefined } });
    });

    it("parses --claims and --seed with separate values", () => {
        expect(parseGenerateArgs(["--claims", "20", "--seed", "7"])).toEqual({ kind: "ok", args: { claims: 20, seed: 7 } });
    });

    it("parses the --name=value form", () => {
        expect(parseGenerateArgs(["--seed=0", "--claims=3"])).toEqual({ kind: "ok", args: { claims: 3, seed: 0 } });
    });

    it("returns help for --help and -h", () => {
        expect(parseGenerateArgs(["--help"])).toEqual({ kind: "help" });
        expect(parseGenerateArgs(["--claims", "5", "-h"])).toEqual({ kind: "help" });
    });

    it.each<[string[], RegExp]>([
        [["--claims"], /needs a value/],
        [["--claims", "--seed", "1"], /--claims needs a value/],
        [["--claims", "abc"], /whole number/],
        [["--claims", "-5"], /whole number/],
        [["--claims", "2.5"], /whole number/],
        [["--claims", "0"], /between 1 and/],
        [["--claims", String(MAX_CLAIM_COUNT + 1)], /between 1 and/],
        [["--seed", "4294967296"], /between 0 and/],
        [["--seed", ""], /needs a value/],
        [["--count", "5"], /Unknown argument "--count"/],
        [["20"], /Unknown argument "20"/],
    ])("rejects %j", (argv, message) => {
        const result = parseGenerateArgs(argv);
        expect(result.kind).toBe("error");
        if (result.kind === "error") expect(result.message).toMatch(message);
    });
});
