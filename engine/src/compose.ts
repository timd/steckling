/**
 * Docker Compose wrappers. Every branch is an isolated compose *project*
 * (`-p <project>`); host ports are passed in via env so the compose file can
 * interpolate them (e.g. `ports: ["${STECKLING_PORT_POSTGRES}:5432"]`).
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { run, type RunResult } from "./sh";

export interface ComposeContext {
  project: string;
  file: string;
  cwd: string;
  /** Env for `${...}` interpolation in the compose file (the STECKLING_PORT_* vars). */
  env: Record<string, string>;
}

function args(ctx: ComposeContext, rest: string[]): string[] {
  return ["compose", "-p", ctx.project, "-f", ctx.file, ...rest];
}

/**
 * True if the compose file declares at least one service. `docker compose`
 * errors on an empty file ("no service selected"), but a services-less setup
 * (e.g. a fresh `steck init` with no presets picked) is valid — the lifecycle
 * skips Docker entirely for it. Unreadable/invalid files return true so docker
 * compose itself gets to report the real error.
 */
export function composeFileHasServices(file: string): boolean {
  try {
    const doc = parseYaml(readFileSync(file, "utf8"));
    if (typeof doc !== "object" || doc === null) return false;
    const services = (doc as Record<string, unknown>)["services"];
    if (typeof services !== "object" || services === null) return false;
    return Object.keys(services).length > 0;
  } catch {
    return true;
  }
}

/** Bring the stack up detached and wait for healthchecks. */
export function composeUp(ctx: ComposeContext): Promise<RunResult> {
  return run(["docker", ...args(ctx, ["up", "-d", "--wait"])], { cwd: ctx.cwd, env: ctx.env });
}

/** Stop containers but keep volumes (data survives). */
export function composeStop(ctx: ComposeContext): Promise<RunResult> {
  return run(["docker", ...args(ctx, ["stop"])], { cwd: ctx.cwd, env: ctx.env });
}

/** Remove containers + volumes (destroys data). */
export function composeDownVolumes(ctx: ComposeContext): Promise<RunResult> {
  return run(["docker", ...args(ctx, ["down", "--volumes"])], { cwd: ctx.cwd, env: ctx.env });
}

/** True if the project has at least one running container. */
export async function composeIsRunning(ctx: ComposeContext): Promise<boolean> {
  const r = await run(["docker", ...args(ctx, ["ps", "-q"])], { cwd: ctx.cwd, env: ctx.env });
  return r.ok && r.stdout.trim().length > 0;
}

/**
 * Status of a compose project by its label, independent of any compose file or
 * cwd — used by `list`/`status` to reconcile the registry against Docker.
 */
export async function projectStatus(project: string): Promise<"up" | "stopped" | "absent"> {
  const label = `label=com.docker.compose.project=${project}`;
  const running = await run(["docker", "ps", "-q", "--filter", label]);
  if (running.ok && running.stdout.trim() !== "") return "up";
  const all = await run(["docker", "ps", "-aq", "--filter", label]);
  if (all.ok && all.stdout.trim() !== "") return "stopped";
  return "absent";
}

export interface DestroyResult {
  containers: number;
  volumes: number;
  networks: number;
}

/**
 * Remove a project's containers + named volumes + networks by compose label.
 * Label-based (not file-based) so it works even when the worktree or compose
 * file is gone — which is exactly the `prune`/stale case.
 */
export async function destroyProject(project: string): Promise<DestroyResult> {
  const label = `label=com.docker.compose.project=${project}`;

  const idsOf = async (kind: "ps" | "volume" | "network"): Promise<string[]> => {
    const cmd =
      kind === "ps"
        ? ["docker", "ps", "-aq", "--filter", label]
        : ["docker", kind, "ls", "-q", "--filter", label];
    const r = await run(cmd);
    return r.ok ? r.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  };

  const containers = await idsOf("ps");
  if (containers.length) await run(["docker", "rm", "-f", ...containers]);
  const volumes = await idsOf("volume");
  if (volumes.length) await run(["docker", "volume", "rm", ...volumes]);
  const networks = await idsOf("network");
  if (networks.length) await run(["docker", "network", "rm", ...networks]);

  return { containers: containers.length, volumes: volumes.length, networks: networks.length };
}

/** The published host port for a service's container port, or null. */
export async function composePort(
  ctx: ComposeContext,
  service: string,
  containerPort: number,
): Promise<number | null> {
  const r = await run(["docker", ...args(ctx, ["port", service, String(containerPort)])], {
    cwd: ctx.cwd,
    env: ctx.env,
  });
  if (!r.ok) return null;
  const m = r.stdout.match(/:(\d+)\s*$/);
  return m && m[1] ? Number(m[1]) : null;
}
