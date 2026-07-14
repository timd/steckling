/** Unit tests for env resolution + the .steckling/env dotenv round-trip. */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StecklingConfigSchema, type StecklingConfig } from "../src/config";
import { portEnvName, portPlaceholders, readDotenv, resolveEnv, writeDotenv } from "../src/env";

function config(raw: Record<string, unknown>): StecklingConfig {
  return StecklingConfigSchema.parse({
    version: 1,
    services: { compose: "./c.yml", ...((raw["services"] as object) ?? {}) },
    app: { run: "true", ...((raw["app"] as object) ?? {}) },
    ...raw,
  });
}

const IDENTITY = { branch: "feat/a", project: "steckling_feat_a_123456" };

test("portEnvName upper-cases and sanitizes service names", () => {
  expect(portEnvName("postgres")).toBe("STECKLING_PORT_POSTGRES");
  expect(portEnvName("my-cache.2")).toBe("STECKLING_PORT_MY_CACHE_2");
});

test("portPlaceholders emits a zero for every service", () => {
  expect(portPlaceholders(["a", "b"])).toEqual({
    STECKLING_PORT_A: "0",
    STECKLING_PORT_B: "0",
  });
});

test("resolveEnv renders {port} URLs and compose port vars", () => {
  const cfg = config({
    services: {
      compose: "./c.yml",
      expose: { postgres: { container: 5432, env: "DATABASE_URL", url: "pg://x:{port}/db" } },
    },
  });
  const { vars, composeEnv } = resolveEnv(cfg, { services: { postgres: 41000 }, blockStart: 41000 }, IDENTITY);
  expect(vars["DATABASE_URL"]).toBe("pg://x:41000/db");
  expect(composeEnv["STECKLING_PORT_POSTGRES"]).toBe("41000");
});

test("resolveEnv injects the app port under the configured name", () => {
  const cfg = config({ app: { run: "true", port: { env: "PORT", base: 3000 } } });
  const { vars } = resolveEnv(cfg, { services: {}, app: 41001, blockStart: 41000 }, IDENTITY);
  expect(vars["PORT"]).toBe("41001");
});

test("env.extra interpolates {app_port} and reports collisions", () => {
  const cfg = config({
    app: { run: "true", port: { env: "PORT", base: 3000 } },
    env: { extra: { APP_URL: "http://localhost:{app_port}", PORT: "override" } },
  });
  const { vars, collisions } = resolveEnv(cfg, { services: {}, app: 41002, blockStart: 41000 }, IDENTITY);
  expect(vars["APP_URL"]).toBe("http://localhost:41002");
  expect(vars["PORT"]).toBe("override"); // explicit config wins…
  expect(collisions).toContain("PORT"); // …but the collision is surfaced
});

test("dotenv write/read round-trips awkward values", () => {
  const dir = mkdtempSync(join(tmpdir(), "steck-env-"));
  try {
    const vars = {
      PLAIN: "simple",
      SPACED: "two words",
      QUOTED: 'say "hi" #notcomment',
      URL: "postgres://a:b@localhost:5432/db",
    };
    writeDotenv(dir, vars);
    expect(readDotenv(dir)).toEqual(vars);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readDotenv returns null when never written", () => {
  const dir = mkdtempSync(join(tmpdir(), "steck-env-"));
  try {
    expect(readDotenv(dir)).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
