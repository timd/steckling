/**
 * Unit tests for the Railway deploy backend + the agent/deploy config schema.
 * Run with `bun test`.
 */
import { expect, test } from "bun:test";
import { buildRailwayJson, cronTooFrequent } from "../src/backends/railway";
import { StecklingConfigSchema, type StecklingConfig } from "../src/config";

function withAgent(agent: NonNullable<StecklingConfig["agent"]>): StecklingConfig {
  return {
    version: 1,
    worktrees: { dir: "../x", base: "main", copyOnCreate: [] },
    services: { compose: "./c.yml", expose: {} },
    env: { mode: "dotenv", extra: {} },
    app: { run: "true" },
    hooks: { provision: "", postCreate: "", teardown: "" },
    agent,
    deploy: { target: "railway", needs: [], env: {} },
  };
}

test("service agent → ALWAYS restart, Dockerfile builder, no cron", () => {
  const j = buildRailwayJson(
    withAgent({ kind: "service", start: "bun run agent.ts", build: { dockerfile: "./Dockerfile" } }),
  );
  expect(j.build.builder).toBe("DOCKERFILE");
  expect(j.build.dockerfilePath).toBe("Dockerfile"); // leading ./ stripped
  expect(j.deploy.startCommand).toBe("bun run agent.ts");
  expect(j.deploy.restartPolicyType).toBe("ALWAYS");
  expect(j.deploy.cronSchedule).toBeUndefined();
});

test("scheduled agent → NEVER restart + cronSchedule + preDeployCommand", () => {
  const j = buildRailwayJson(
    withAgent({
      kind: "scheduled",
      start: "bun run agent.ts",
      schedule: "0 9 * * *",
      preDeploy: "bun run migrate.ts",
      build: { dockerfile: "Dockerfile" },
    }),
  );
  expect(j.deploy.restartPolicyType).toBe("NEVER");
  expect(j.deploy.cronSchedule).toBe("0 9 * * *");
  expect(j.deploy.preDeployCommand).toEqual(["bun run migrate.ts"]);
});

test("cronTooFrequent flags sub-5-minute schedules only", () => {
  expect(cronTooFrequent("* * * * *")).toBe(true);
  expect(cronTooFrequent("*/1 * * * *")).toBe(true);
  expect(cronTooFrequent("*/4 * * * *")).toBe(true);
  expect(cronTooFrequent("*/5 * * * *")).toBe(false);
  expect(cronTooFrequent("0 9 * * *")).toBe(false);
});

test("service agent parses with sensible defaults", () => {
  const r = StecklingConfigSchema.safeParse({
    version: 1,
    services: { compose: "./c.yml" },
    app: { run: "true" },
    agent: { start: "bun run agent.ts" },
    deploy: { target: "railway" },
  });
  expect(r.success).toBe(true);
  if (r.success) {
    expect(r.data.agent?.kind).toBe("service");
    expect(r.data.agent?.build.dockerfile).toBe("./Dockerfile");
  }
});

test("kind: scheduled without a schedule is rejected", () => {
  const r = StecklingConfigSchema.safeParse({
    version: 1,
    services: { compose: "./c.yml" },
    app: { run: "true" },
    agent: { kind: "scheduled", start: "x" },
    deploy: { target: "railway" },
  });
  expect(r.success).toBe(false);
});

test("deploy without an agent block is rejected", () => {
  const r = StecklingConfigSchema.safeParse({
    version: 1,
    services: { compose: "./c.yml" },
    app: { run: "true" },
    deploy: { target: "railway" },
  });
  expect(r.success).toBe(false);
});

test("a config with neither agent nor deploy is unchanged (still valid)", () => {
  const r = StecklingConfigSchema.safeParse({
    version: 1,
    services: { compose: "./c.yml" },
    app: { run: "true" },
  });
  expect(r.success).toBe(true);
});
