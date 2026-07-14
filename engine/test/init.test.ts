/** Unit tests for the init wizard's detection + file generation (no TTY needed). */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { StecklingConfigSchema } from "../src/config";
import { buildComposeYaml, buildStecklingYaml, detectRunCommand } from "../src/init";

function scratch(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "steck-init-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

test("detectRunCommand prefers package.json scripts.dev with the right PM", () => {
  const dir = scratch({
    "package.json": JSON.stringify({ scripts: { dev: "x", start: "y" } }),
    "pnpm-lock.yaml": "",
  });
  try {
    expect(detectRunCommand(dir)).toEqual({ cmd: "pnpm run dev", source: "package.json scripts.dev" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectRunCommand falls back through ecosystems and to null", () => {
  const cargo = scratch({ "Cargo.toml": "[package]" });
  const empty = scratch({});
  try {
    expect(detectRunCommand(cargo)?.cmd).toBe("cargo run");
    expect(detectRunCommand(empty)).toBeNull();
  } finally {
    rmSync(cargo, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

const ANSWERS = {
  composePath: "./compose.steckling.yml",
  expose: [
    { service: "postgres", container: 5432, env: "DATABASE_URL", url: "pg://x:{port}/db" },
  ],
  base: "main",
  copyOnCreate: [".env.local"],
  run: 'echo "quoted \\"run\\" cmd"',
  port: { env: "PORT", base: 4000 },
  provision: "npm run migrate",
};

test("generated steckling.yml validates against the real schema", () => {
  const yml = buildStecklingYaml(ANSWERS);
  const parsed = StecklingConfigSchema.safeParse(parseYaml(yml));
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.app.run).toBe(ANSWERS.run); // quoting survived
    expect(parsed.data.services.expose["postgres"]?.container).toBe(5432);
    expect(parsed.data.worktrees.copyOnCreate).toEqual([".env.local"]);
    expect(parsed.data.hooks.provision).toBe("npm run migrate");
  }
});

test("generated steckling.yml omits optional blocks when skipped", () => {
  const yml = buildStecklingYaml({ ...ANSWERS, expose: [], port: null, provision: "", copyOnCreate: [] });
  const parsed = StecklingConfigSchema.safeParse(parseYaml(yml));
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.app.port).toBeUndefined();
    expect(parsed.data.services.expose).toEqual({});
  }
});

test("generated compose file is valid YAML with the injected port vars", () => {
  const presets = [
    {
      service: "postgres",
      label: "Postgres",
      hint: "",
      container: 5432,
      env: "DATABASE_URL",
      url: "pg://x:{port}/db",
      volume: "pgdata",
      compose: "  postgres:\n    image: postgres:16\n    ports:\n      - \"${STECKLING_PORT_POSTGRES:?x}:5432\"",
    },
  ];
  const doc = parseYaml(buildComposeYaml(presets)) as Record<string, unknown>;
  expect(Object.keys(doc["services"] as object)).toEqual(["postgres"]);
  expect(Object.keys(doc["volumes"] as object)).toEqual(["pgdata"]);
});

test("zero presets produce an explicitly empty services map", () => {
  const doc = parseYaml(buildComposeYaml([])) as Record<string, unknown>;
  expect(doc["services"]).toEqual({});
});
