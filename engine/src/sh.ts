/**
 * Thin wrappers over Bun's process APIs. The engine shells out to `git` and
 * `docker` rather than reimplementing them.
 */

/** Resolve a binary on PATH, or null if absent. */
export function which(bin: string): string | null {
  return Bun.which(bin);
}

export interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  /** Extra env merged on top of the current process env. */
  env?: Record<string, string>;
}

/** Run a command to completion, capturing trimmed stdout/stderr. Never throws on non-zero exit. */
export async function run(cmd: string[], opts: RunOptions = {}): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Run a command with inherited stdio (for hooks + the foreground app). Returns its exit code. */
export async function runInherit(cmd: string[], opts: RunOptions = {}): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return proc.exited;
}
