/** Unit tests for the steckling.yml schema + config discovery. */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StecklingConfigSchema, findConfigPath } from "../src/config";

const MINIMAL = {
  version: 1,
  services: { compose: "./c.yml" },
  app: { run: "npm run dev" },
};

test("minimal config parses and defaults are filled", () => {
  const cfg = StecklingConfigSchema.parse(MINIMAL);
  expect(cfg.worktrees.dir).toBe("../{repo}-trees");
  expect(cfg.worktrees.base).toBe("main");
  expect(cfg.services.expose).toEqual({});
  expect(cfg.env.mode).toBe("dotenv");
  expect(cfg.hooks.provision).toBe("");
});

test("unknown keys are rejected (strict schema)", () => {
  expect(StecklingConfigSchema.safeParse({ ...MINIMAL, nope: true }).success).toBe(false);
  expect(
    StecklingConfigSchema.safeParse({ ...MINIMAL, app: { run: "x", typo: 1 } }).success,
  ).toBe(false);
});

test("expose url must contain {port}", () => {
  const bad = {
    ...MINIMAL,
    services: {
      compose: "./c.yml",
      expose: { pg: { container: 5432, env: "DATABASE_URL", url: "pg://localhost:5432" } },
    },
  };
  expect(StecklingConfigSchema.safeParse(bad).success).toBe(false);
});

test("deploy requires an agent block", () => {
  const bad = { ...MINIMAL, deploy: { target: "railway" } };
  expect(StecklingConfigSchema.safeParse(bad).success).toBe(false);
});

test("scheduled agents require a 5-field cron schedule", () => {
  const base = { ...MINIMAL, agent: { kind: "scheduled", start: "bun run agent.ts" } };
  expect(StecklingConfigSchema.safeParse(base).success).toBe(false);
  expect(
    StecklingConfigSchema.safeParse({
      ...base,
      agent: { ...base.agent, schedule: "0 9 * * *" },
    }).success,
  ).toBe(true);
  expect(
    StecklingConfigSchema.safeParse({
      ...base,
      agent: { ...base.agent, schedule: "hourly" },
    }).success,
  ).toBe(false);
});

test("findConfigPath walks up from a nested directory", () => {
  const root = mkdtempSync(join(tmpdir(), "steck-cfg-"));
  try {
    writeFileSync(join(root, "steckling.yml"), "version: 1\n");
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findConfigPath(nested)).toBe(join(root, "steckling.yml"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findConfigPath returns null when nothing is found", () => {
  const dir = mkdtempSync(join(tmpdir(), "steck-none-"));
  try {
    expect(findConfigPath(dir)).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
