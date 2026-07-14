/** Unit tests for the registry, isolated via the STECKLING_HOME seam. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistry, reservedPorts, updateRegistry, type WorktreeRecord } from "../src/registry";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "steck-reg-"));
  process.env["STECKLING_HOME"] = home;
});

afterEach(() => {
  delete process.env["STECKLING_HOME"];
  rmSync(home, { recursive: true, force: true });
});

function record(project: string, ports: WorktreeRecord["ports"]): WorktreeRecord {
  return {
    project,
    branch: project,
    repo: "/tmp/x",
    path: "/tmp/x",
    ports,
    createdAt: "2026-01-01T00:00:00Z",
    lastUsedAt: "2026-01-01T00:00:00Z",
  };
}

test("a missing registry loads as empty", () => {
  expect(loadRegistry()).toEqual({ version: 1, worktrees: {} });
});

test("updateRegistry persists and reloads", async () => {
  await updateRegistry((r) => {
    r.worktrees["p1"] = record("p1", { services: { pg: 20000 }, app: 20001 });
  });
  const reg = loadRegistry();
  expect(reg.worktrees["p1"]?.ports.app).toBe(20001);
});

test("a corrupt registry file degrades to empty instead of crashing", () => {
  writeFileSync(join(home, "registry.json"), "{ not json !!!");
  expect(loadRegistry()).toEqual({ version: 1, worktrees: {} });
});

test("reservedPorts collects all ports, honoring the exclusion", async () => {
  await updateRegistry((r) => {
    r.worktrees["a"] = record("a", { services: { pg: 20000 }, app: 20001 });
    r.worktrees["b"] = record("b", { services: { pg: 20010 } });
  });
  const reg = loadRegistry();
  expect([...reservedPorts(reg)].sort()).toEqual([20000, 20001, 20010]);
  expect(reservedPorts(reg, "a").has(20001)).toBe(false);
  expect(reservedPorts(reg, "a").has(20010)).toBe(true);
});

test("concurrent updates serialize under the lock", async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      updateRegistry((r) => {
        r.worktrees[`p${i}`] = record(`p${i}`, { services: {} });
      }),
    ),
  );
  expect(Object.keys(loadRegistry().worktrees).length).toBe(8);
});
