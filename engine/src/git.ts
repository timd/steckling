/** Minimal git helpers. */

import { dirname } from "node:path";
import { run, type RunResult } from "./sh";

/**
 * The current branch name, or null on detached HEAD / not a repo.
 * `symbolic-ref` (not `rev-parse --abbrev-ref`) so an unborn branch — a fresh
 * `git init` before the first commit — still reports its name.
 */
export async function currentBranch(cwd: string): Promise<string | null> {
  const r = await run(["git", "symbolic-ref", "--short", "-q", "HEAD"], { cwd });
  if (!r.ok) return null;
  const b = r.stdout.trim();
  return b === "" ? null : b;
}

/**
 * The primary checkout root. From any linked worktree this still resolves to
 * the main repo (via the shared common git dir), which is where new worktrees
 * are anchored.
 */
export async function repoRoot(cwd: string): Promise<string | null> {
  const r = await run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  if (!r.ok) return null;
  return dirname(r.stdout.trim());
}

/** True if `ref` resolves to a commit — an unborn branch (fresh repo, no commits) or a typo does not. */
export async function refHasCommit(root: string, ref: string): Promise<boolean> {
  const r = await run(["git", "-C", root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return r.ok;
}

export async function localBranchExists(root: string, branch: string): Promise<boolean> {
  const r = await run(["git", "-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  return r.ok;
}

export async function remoteRefExists(root: string, base: string): Promise<boolean> {
  const r = await run(["git", "-C", root, "show-ref", "--verify", "--quiet", `refs/remotes/origin/${base}`]);
  return r.ok;
}

/** Best-effort fetch of the base branch (ignores failure — may be offline / no remote). */
export async function fetchBase(root: string, base: string): Promise<void> {
  await run(["git", "-C", root, "fetch", "origin", base]);
}

export function addWorktree(
  root: string,
  branch: string,
  path: string,
  startPoint: string,
): Promise<RunResult> {
  return run(["git", "-C", root, "worktree", "add", "-b", branch, path, startPoint]);
}

/** True if `branch` is fully merged into `baseRef` (its tip is an ancestor). */
export async function isMerged(root: string, branch: string, baseRef: string): Promise<boolean> {
  const r = await run(["git", "-C", root, "merge-base", "--is-ancestor", `refs/heads/${branch}`, baseRef]);
  return r.ok;
}

/** Clean up git's bookkeeping for worktree folders that no longer exist. */
export async function worktreePrune(root: string): Promise<void> {
  await run(["git", "-C", root, "worktree", "prune"]);
}

/**
 * Remove a worktree folder via git (also clears its bookkeeping). Without
 * `force`, git refuses a dirty worktree — callers surface that refusal rather
 * than pre-checking.
 */
export function removeWorktree(root: string, path: string, force = false): Promise<RunResult> {
  return run(["git", "-C", root, "worktree", "remove", ...(force ? ["--force"] : []), path]);
}

/** Delete a local branch. `force` = -D (drops unmerged commits); otherwise -d lets git refuse. */
export function deleteBranch(root: string, branch: string, force = false): Promise<RunResult> {
  return run(["git", "-C", root, "branch", force ? "-D" : "-d", branch]);
}
