/** Runs project lifecycle hooks (shell strings) with the injected branch env. */

import { runInherit } from "./sh";

/**
 * Run a hook command via `sh -c` (so `a && b` works) with stdio inherited.
 * Returns the exit code, or null if the hook is empty (nothing to run).
 */
export async function runHook(
  cmd: string,
  cwd: string,
  env: Record<string, string>,
): Promise<number | null> {
  if (cmd.trim() === "") return null;
  return runInherit(["sh", "-c", cmd], { cwd, env });
}
