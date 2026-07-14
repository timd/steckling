/**
 * Lifecycle tests against real git repos and an isolated registry
 * (STECKLING_HOME). The compose file is empty (`services: {}`), so no
 * containers are ever created — docker is only consulted for (empty) label
 * queries. Every scenario here is a regression test for a bug found in the
 * 2026-07 QA sessions; container behaviour itself is covered by test/e2e.sh.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { newWorktree, prune, rm } from "../src/lifecycle";
import { computeNames } from "../src/naming";
import { loadRegistry, updateRegistry } from "../src/registry";
import { run } from "../src/sh";

let home: string;
let repo: string;
let treesDir: string;
const origCwd = process.cwd();

const CONFIG = `version: 1
services:
  compose: "./c.yml"
app:
  run: "echo app"
`;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "steck-lc-home-"));
  process.env["STECKLING_HOME"] = home;
  repo = mkdtempSync(join(tmpdir(), "steck-lc-repo-"));
  treesDir = join(repo, "..", `${basename(repo)}-trees`);
  await run(["git", "init", "-q", "-b", "main", repo]);
  await run(["git", "-C", repo, "config", "user.email", "t@t"]);
  await run(["git", "-C", repo, "config", "user.name", "t"]);
  writeFileSync(join(repo, "steckling.yml"), CONFIG);
  writeFileSync(join(repo, "c.yml"), "services: {}\n");
  await run(["git", "-C", repo, "add", "-A"]);
  await run(["git", "-C", repo, "commit", "-qm", "init"]);
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(origCwd);
  delete process.env["STECKLING_HOME"];
  for (const d of [home, repo, treesDir]) rmSync(d, { recursive: true, force: true });
});

async function commitIn(dir: string, msg = "work"): Promise<void> {
  await run(["git", "-C", dir, "commit", "-qm", msg, "--allow-empty"]);
}

test("new creates a worktree, copies files, registers ports; duplicates refused", async () => {
  writeFileSync(join(repo, ".env.local"), "SECRET=x\n");
  writeFileSync(
    join(repo, "steckling.yml"),
    CONFIG.replace("app:", 'worktrees:\n  copyOnCreate: [".env.local"]\napp:'),
  );
  expect(await newWorktree("feat/a", undefined, { up: false, noRun: false })).toBe(0);

  const wt = join(treesDir, "feat/a");
  expect(existsSync(wt)).toBe(true);
  expect(existsSync(join(wt, ".env.local"))).toBe(true);
  expect(loadRegistry().worktrees[computeNames("feat/a").project]?.branch).toBe("feat/a");

  expect(await newWorktree("feat/a", undefined, { up: false, noRun: false })).toBe(1);
});

test("new on a commit-less base fails with the friendly pre-flight error", async () => {
  const bare = mkdtempSync(join(tmpdir(), "steck-lc-unborn-"));
  try {
    await run(["git", "init", "-q", "-b", "main", bare]);
    writeFileSync(join(bare, "steckling.yml"), CONFIG);
    writeFileSync(join(bare, "c.yml"), "services: {}\n");
    process.chdir(bare);
    expect(await newWorktree("feat/x", undefined, { up: false, noRun: false })).toBe(1);
    expect(existsSync(join(bare, "..", `${basename(bare)}-trees`))).toBe(false);
  } finally {
    process.chdir(repo);
    rmSync(bare, { recursive: true, force: true });
  }
});

test("plain rm keeps folder + branch but drops the registry entry", async () => {
  await newWorktree("feat/keep", undefined, { up: false, noRun: false });
  expect(await rm("feat/keep", { yes: true, force: false, purge: false })).toBe(0);

  expect(existsSync(join(treesDir, "feat/keep"))).toBe(true);
  expect((await run(["git", "-C", repo, "show-ref", "refs/heads/feat/keep"])).ok).toBe(true);
  expect(loadRegistry().worktrees[computeNames("feat/keep").project]).toBeUndefined();
});

test("rm --purge refuses a dirty worktree and keeps the branch", async () => {
  await newWorktree("feat/dirty", undefined, { up: false, noRun: false });
  writeFileSync(join(treesDir, "feat/dirty", "wip.txt"), "uncommitted");

  expect(await rm("feat/dirty", { yes: true, force: false, purge: true })).toBe(0);
  expect(existsSync(join(treesDir, "feat/dirty"))).toBe(true);
  expect((await run(["git", "-C", repo, "show-ref", "refs/heads/feat/dirty"])).ok).toBe(true);
});

test("rm --purge removes a clean folder but keeps an unmerged branch", async () => {
  await newWorktree("feat/unmerged", undefined, { up: false, noRun: false });
  await commitIn(join(treesDir, "feat/unmerged"));

  expect(await rm("feat/unmerged", { yes: true, force: false, purge: true })).toBe(0);
  expect(existsSync(join(treesDir, "feat/unmerged"))).toBe(false);
  expect((await run(["git", "-C", repo, "show-ref", "refs/heads/feat/unmerged"])).ok).toBe(true);
});

test("rm --purge on a merged branch removes everything, sweeping empty parents", async () => {
  await newWorktree("feat/deep/merged", undefined, { up: false, noRun: false });
  await commitIn(join(treesDir, "feat/deep/merged"));
  await run(["git", "-C", repo, "merge", "-q", "feat/deep/merged"]);

  expect(await rm("feat/deep/merged", { yes: true, force: false, purge: true })).toBe(0);
  expect(existsSync(join(treesDir, "feat"))).toBe(false); // nested shells swept
  expect((await run(["git", "-C", repo, "show-ref", "refs/heads/feat/deep/merged"])).ok).toBe(false);
});

test("rm --purge works on an unregistered worktree (post plain-rm state)", async () => {
  await newWorktree("feat/unreg", undefined, { up: false, noRun: false });
  await rm("feat/unreg", { yes: true, force: false, purge: false }); // deregisters, keeps git state
  await run(["git", "-C", repo, "merge", "-q", "feat/unreg"]);

  expect(await rm("feat/unreg", { yes: true, force: false, purge: true })).toBe(0);
  expect(existsSync(join(treesDir, "feat/unreg"))).toBe(false);
  expect((await run(["git", "-C", repo, "show-ref", "refs/heads/feat/unreg"])).ok).toBe(false);
});

test("rm refuses the base branch without --force", async () => {
  expect(await rm("main", { yes: true, force: false, purge: false })).toBe(1);
});

test("prune reclaims merged branches; --purge takes folders and branches too", async () => {
  await newWorktree("feat/done", undefined, { up: false, noRun: false });
  await commitIn(join(treesDir, "feat/done"));
  await run(["git", "-C", repo, "merge", "-q", "feat/done"]);
  await newWorktree("feat/active", undefined, { up: false, noRun: false });
  await commitIn(join(treesDir, "feat/active")); // unmerged → not a candidate

  expect(await prune({ yes: true, purge: true })).toBe(0);

  expect(existsSync(join(treesDir, "feat/done"))).toBe(false);
  expect((await run(["git", "-C", repo, "show-ref", "refs/heads/feat/done"])).ok).toBe(false);
  expect(existsSync(join(treesDir, "feat/active"))).toBe(true);
  expect(loadRegistry().worktrees[computeNames("feat/active").project]).toBeDefined();
});

test("prune never judges another repo's records by this repo's branches", async () => {
  const otherRepo = mkdtempSync(join(tmpdir(), "steck-lc-other-"));
  try {
    await updateRegistry((r) => {
      r.worktrees["steckling_other_zzz999"] = {
        project: "steckling_other_zzz999",
        branch: "feat/only-in-other-repo", // doesn't exist HERE — must not read as "deleted"
        repo: otherRepo,
        path: join(otherRepo, "wt"),
        ports: { services: {} },
        createdAt: "2026-01-01T00:00:00Z",
        lastUsedAt: "2026-01-01T00:00:00Z",
      };
    });
    // mkdtemp path exists but record.path doesn't — still not a candidate (different repo)
    expect(await prune({ yes: true, purge: false })).toBe(0);
    expect(loadRegistry().worktrees["steckling_other_zzz999"]).toBeDefined();

    // once the other repo's folder is GONE, the record becomes reclaimable
    rmSync(otherRepo, { recursive: true, force: true });
    expect(await prune({ yes: true, purge: false })).toBe(0);
    expect(loadRegistry().worktrees["steckling_other_zzz999"]).toBeUndefined();
  } finally {
    rmSync(otherRepo, { recursive: true, force: true });
  }
});
