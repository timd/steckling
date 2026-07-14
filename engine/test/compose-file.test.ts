/** Unit tests for compose-file introspection (no Docker involved). */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeFileHasServices, composeFileServiceNames } from "../src/compose";

function withFile(content: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "steck-compose-"));
  const path = join(dir, "c.yml");
  writeFileSync(path, content);
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a populated compose file lists its services", () => {
  withFile("services:\n  postgres:\n    image: postgres:16\n  redis:\n    image: redis:7\n", (p) => {
    expect(composeFileServiceNames(p)).toEqual(["postgres", "redis"]);
    expect(composeFileHasServices(p)).toBe(true);
  });
});

test("services: {} means no services (the init zero-preset case)", () => {
  withFile("services: {}\n", (p) => {
    expect(composeFileServiceNames(p)).toEqual([]);
    expect(composeFileHasServices(p)).toBe(false);
  });
});

test("a file with no services key has no services", () => {
  withFile("volumes: {}\n", (p) => {
    expect(composeFileHasServices(p)).toBe(false);
  });
});

test("an unreadable file fails open for hasServices (docker reports the real error)", () => {
  expect(composeFileHasServices("/nonexistent/nope.yml")).toBe(true);
  expect(composeFileServiceNames("/nonexistent/nope.yml")).toEqual([]);
});
