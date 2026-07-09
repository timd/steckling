/**
 * Unit tests for ticket parsing/URL rendering, the ticket config schema, and
 * the identity-var injection + env.extra precedence. Run with `bun test`.
 */
import { expect, test } from "bun:test";
import { StecklingConfigSchema, type StecklingConfig } from "../src/config";
import { metaVars, resolveEnv } from "../src/env";
import { parseTicket, ticketEnvName, ticketUrl } from "../src/ticket";

function config(overrides: Partial<StecklingConfig> = {}): StecklingConfig {
  return {
    version: 1,
    worktrees: { dir: "../x", base: "main", copyOnCreate: [] },
    services: { compose: "./c.yml", expose: {} },
    env: { mode: "dotenv", extra: {} },
    app: { run: "true" },
    hooks: { provision: "", postCreate: "", teardown: "" },
    ...overrides,
  };
}

const TICKETED = config({
  ticket: { pattern: "eng-\\d+", url: "https://t.example/i/{ticket}", env: "STECKLING_TICKET" },
});

// --- parseTicket -----------------------------------------------------------

test("parses the first pattern match out of the branch name", () => {
  expect(parseTicket(TICKETED, "tim/eng-123-fix-login")).toBe("eng-123");
});

test("matching is case-insensitive; the match is returned verbatim", () => {
  expect(parseTicket(TICKETED, "tim/ENG-42-thing")).toBe("ENG-42");
});

test("JS regexes have no inline (?i) — such a pattern is rejected by the schema", () => {
  const res = StecklingConfigSchema.safeParse({
    ...BASE_YAMLISH,
    ticket: { pattern: "(?i)eng-\\d+" },
  });
  expect(res.success).toBe(false);
});

test("no match → null", () => {
  expect(parseTicket(TICKETED, "fix-flaky-tests")).toBeNull();
});

test("no ticket block → null (strictly opt-in)", () => {
  expect(parseTicket(config(), "tim/eng-123-fix-login")).toBeNull();
});

// --- ticketUrl / ticketEnvName ----------------------------------------------

test("renders the {ticket} placeholder", () => {
  expect(ticketUrl(TICKETED, "eng-123")).toBe("https://t.example/i/eng-123");
});

test("no url template → null", () => {
  const cfg = config({ ticket: { pattern: "eng-\\d+", env: "STECKLING_TICKET" } });
  expect(ticketUrl(cfg, "eng-123")).toBeNull();
});

test("ticket.env overrides the injected var name", () => {
  const cfg = config({ ticket: { pattern: "eng-\\d+", env: "MY_TICKET" } });
  expect(ticketEnvName(cfg)).toBe("MY_TICKET");
  expect(ticketEnvName(config())).toBe("STECKLING_TICKET");
});

// --- config schema -----------------------------------------------------------

const BASE_YAMLISH = {
  version: 1,
  services: { compose: "./c.yml" },
  app: { run: "true" },
};

test("schema accepts a minimal ticket block and defaults env", () => {
  const parsed = StecklingConfigSchema.parse({
    ...BASE_YAMLISH,
    ticket: { pattern: "eng-\\d+" },
  });
  expect(parsed.ticket?.env).toBe("STECKLING_TICKET");
});

test("schema rejects an invalid ticket.pattern regex", () => {
  const res = StecklingConfigSchema.safeParse({
    ...BASE_YAMLISH,
    ticket: { pattern: "eng-(\\d+" },
  });
  expect(res.success).toBe(false);
});

test("schema rejects a ticket.url without the {ticket} placeholder", () => {
  const res = StecklingConfigSchema.safeParse({
    ...BASE_YAMLISH,
    ticket: { pattern: "eng-\\d+", url: "https://t.example/i/" },
  });
  expect(res.success).toBe(false);
});

test("schema accepts hooks.postCreate", () => {
  const parsed = StecklingConfigSchema.parse({
    ...BASE_YAMLISH,
    hooks: { postCreate: "echo hi" },
  });
  expect(parsed.hooks.postCreate).toBe("echo hi");
});

// --- env injection -----------------------------------------------------------

const PORTS = { services: {}, blockStart: 0 };
const META = { branch: "tim/eng-123-x", project: "steckling_x_abc123", ticket: "eng-123" };

test("resolveEnv injects the identity vars", () => {
  const { vars } = resolveEnv(TICKETED, PORTS, META);
  expect(vars["STECKLING_BRANCH"]).toBe("tim/eng-123-x");
  expect(vars["STECKLING_PROJECT"]).toBe("steckling_x_abc123");
  expect(vars["STECKLING_TICKET"]).toBe("eng-123");
  expect(vars["STECKLING_TICKET_URL"]).toBe("https://t.example/i/eng-123");
});

test("no ticket → no ticket vars, identity vars still present", () => {
  const { vars } = resolveEnv(config(), PORTS, { branch: "b", project: "p" });
  expect(vars["STECKLING_BRANCH"]).toBe("b");
  expect(vars["STECKLING_TICKET"]).toBeUndefined();
  expect(vars["STECKLING_TICKET_URL"]).toBeUndefined();
});

test("env.extra wins over injected vars and the collision is reported", () => {
  const cfg = {
    ...TICKETED,
    env: { mode: "dotenv" as const, extra: { STECKLING_TICKET: "OVERRIDDEN" } },
  };
  const { vars, collisions } = resolveEnv(cfg, PORTS, META);
  expect(vars["STECKLING_TICKET"]).toBe("OVERRIDDEN");
  expect(collisions).toEqual(["STECKLING_TICKET"]);
});

test("metaVars alone carries identity for pre/post-stack hooks", () => {
  const vars = metaVars(TICKETED, META);
  expect(vars).toEqual({
    STECKLING_BRANCH: "tim/eng-123-x",
    STECKLING_PROJECT: "steckling_x_abc123",
    STECKLING_TICKET: "eng-123",
    STECKLING_TICKET_URL: "https://t.example/i/eng-123",
  });
});
