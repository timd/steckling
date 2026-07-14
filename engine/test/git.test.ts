/** Unit tests for git helpers against real throwaway repos (fast; no Docker). */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  currentBranch,
  deleteBranch,
  isMerged,
  listWorktrees,
  localBranchExists,
  refHasCommit,
  removeWorktree,
  repoRoot,
} from "../src/git";
import { run } from "../src/sh";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function repo(withCommit = true): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "steck-git-"));
  dirs.push(dir);
  await run(["git", "init", "-q", "-b", "main", dir]);
  await run(["git", "-C", dir, "config", "user.email", "t@t"]);
  await run(["git", "-C", dir, "config", "user.name", "t"]);
  if (withCommit) await run(["git", "-C", dir, "commit", "-qm", "init", "--allow-empty"]);
  return dir;
}

test("currentBranch reports an unborn branch by name (fresh git init)", async () => {
  const dir = await repo(false);
  expect(await currentBranch(dir)).toBe("main");
});

test("currentBranch is null on detached HEAD and outside a repo", async () => {
  const dir = await repo();
  await run(["git", "-C", dir, "checkout", "-q", "--detach"]);
  expect(await currentBranch(dir)).toBeNull();
  expect(await currentBranch(tmpdir())).toBeNull();
});

test("refHasCommit distinguishes commit-less refs from real ones", async () => {
  const unborn = await repo(false);
  const born = await repo();
  expect(await refHasCommit(unborn, "main")).toBe(false);
  expect(await refHasCommit(born, "main")).toBe(true);
  expect(await refHasCommit(born, "no-such-branch")).toBe(false);
});

test("worktree add/list/remove round-trip, including branch state", async () => {
  const dir = await repo();
  const wt = join(dir, "..", `${dir.split("/").pop()}-wt`);
  dirs.push(wt);
  await run(["git", "-C", dir, "worktree", "add", "-q", "-b", "feat/x", wt, "main"]);

  const listed = await listWorktrees(dir);
  expect(listed.map((w) => w.branch)).toEqual(["main", "feat/x"]);
  expect(await localBranchExists(dir, "feat/x")).toBe(true);

  const rm = await removeWorktree(dir, wt);
  expect(rm.ok).toBe(true);
  expect((await listWorktrees(dir)).length).toBe(1);
});

test("removeWorktree refuses a dirty worktree without force", async () => {
  const dir = await repo();
  const wt = join(dir, "..", `${dir.split("/").pop()}-dirty`);
  dirs.push(wt);
  await run(["git", "-C", dir, "worktree", "add", "-q", "-b", "feat/d", wt, "main"]);
  await Bun.write(join(wt, "uncommitted.txt"), "wip");

  expect((await removeWorktree(dir, wt)).ok).toBe(false);
  expect((await removeWorktree(dir, wt, true)).ok).toBe(true);
});

test("deleteBranch: -d refuses unmerged, -D forces; merged deletes cleanly", async () => {
  const dir = await repo();
  await run(["git", "-C", dir, "branch", "merged-b"]);
  expect((await deleteBranch(dir, "merged-b")).ok).toBe(true);

  await run(["git", "-C", dir, "checkout", "-qb", "feat/u"]);
  await run(["git", "-C", dir, "commit", "-qm", "work", "--allow-empty"]);
  await run(["git", "-C", dir, "checkout", "-q", "main"]);
  expect(await isMerged(dir, "feat/u", "main")).toBe(false);
  expect((await deleteBranch(dir, "feat/u")).ok).toBe(false);
  expect((await deleteBranch(dir, "feat/u", true)).ok).toBe(true);
});

test("repoRoot resolves the main checkout from inside a linked worktree", async () => {
  const dir = await repo();
  const wt = join(dir, "..", `${dir.split("/").pop()}-root`);
  dirs.push(wt);
  await run(["git", "-C", dir, "worktree", "add", "-q", "-b", "feat/r", wt, "main"]);
  const { realpathSync } = await import("node:fs");
  expect(realpathSync((await repoRoot(wt))!)).toBe(realpathSync(dir));
});
