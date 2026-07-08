/** Creating git worktrees for `steck new`. */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { addWorktree, fetchBase, localBranchExists, refHasCommit, remoteRefExists, repoRoot } from "./git";
import { log } from "./log";

export interface WorktreePlan {
  repoRoot: string;
  worktreePath: string;
  startPoint: string;
}

/** Resolve where a new worktree will live and what it branches from (no side effects beyond fetch). */
export async function planWorktree(
  branch: string,
  base: string,
  cwd: string,
  dirTemplate: string,
): Promise<WorktreePlan | { error: string }> {
  const root = await repoRoot(cwd);
  if (!root) return { error: "Not inside a git repository." };
  if (await localBranchExists(root, branch)) {
    return { error: `Branch '${branch}' already exists.` };
  }

  const treesDir = resolve(root, dirTemplate.replaceAll("{repo}", basename(root)));
  const worktreePath = join(treesDir, branch);
  if (existsSync(worktreePath)) {
    return { error: `Worktree path already exists: ${worktreePath}` };
  }

  await fetchBase(root, base);
  const startPoint = (await remoteRefExists(root, base)) ? `origin/${base}` : base;
  if (!(await refHasCommit(root, startPoint))) {
    return {
      error:
        `Base '${startPoint}' has no commits to branch from. ` +
        `In a brand-new repo, make an initial commit first (git commit); ` +
        `otherwise check the base branch name in steckling.yml (worktrees.base).`,
    };
  }
  return { repoRoot: root, worktreePath, startPoint };
}

export async function createWorktree(
  branch: string,
  plan: WorktreePlan,
  copyOnCreate: string[],
): Promise<{ ok: true } | { error: string }> {
  const r = await addWorktree(plan.repoRoot, branch, plan.worktreePath, plan.startPoint);
  if (!r.ok) return { error: `git worktree add failed:\n${r.stderr || r.stdout}` };

  for (const rel of copyOnCreate) {
    const src = join(plan.repoRoot, rel);
    if (!existsSync(src)) continue;
    const dest = join(plan.worktreePath, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    log.info(`copied ${rel}`);
  }

  return { ok: true };
}
