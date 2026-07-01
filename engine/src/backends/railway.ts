/**
 * Railway backend — shells out to the `railway` CLI, the same way the compose
 * backend shells out to `docker compose`. Auth comes from `railway login` or the
 * RAILWAY_TOKEN / RAILWAY_API_TOKEN env vars (inherited by the child process).
 *
 * Every `railway` subcommand lives in one wrapper here so a CLI-surface change
 * (the CLI moves fast) is a single-file edit. Commands used: whoami, status,
 * add, variable set, up, logs, down.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StecklingConfig } from "../config";
import { run, runInherit, which, type RunResult } from "../sh";

export function railwayAvailable(): boolean {
  return which("railway") !== null;
}

export function railwayWhoami(cwd: string): Promise<RunResult> {
  return run(["railway", "whoami"], { cwd });
}

export function railwayStatus(cwd: string): Promise<RunResult> {
  return run(["railway", "status"], { cwd });
}

export function railwayAdd(cwd: string, database: string): Promise<RunResult> {
  return run(["railway", "add", "--database", database], { cwd });
}

/**
 * Set a variable with its value piped via stdin (`--stdin`) rather than in argv,
 * so secrets never appear in `ps`/shell history. `--skip-deploys` because we
 * deploy explicitly with `railway up` afterward.
 */
export function railwaySetVariable(cwd: string, key: string, value: string): Promise<RunResult> {
  return run(["railway", "variable", "set", key, "--stdin", "--skip-deploys"], { cwd, input: value });
}

export function railwayUp(cwd: string): Promise<number> {
  // --ci streams build logs then exits (instead of attaching to the runtime log
  // stream, which never returns). Runtime logs are `steck logs`' job.
  return runInherit(["railway", "up", "--ci"], { cwd });
}

export function railwayDown(cwd: string): Promise<RunResult> {
  return run(["railway", "down", "--yes"], { cwd });
}

export function railwayLogs(cwd: string, opts: { lines?: number; build?: boolean }): Promise<number> {
  const args = ["railway", "logs"];
  if (opts.build) args.push("--build");
  if (opts.lines) args.push("-n", String(opts.lines));
  return runInherit(args, { cwd });
}

/** The build+deploy config Steckling writes to railway.json (config-as-code). */
export interface RailwayJson {
  $schema: string;
  build: { builder: "DOCKERFILE"; dockerfilePath: string };
  deploy: {
    startCommand: string;
    preDeployCommand?: string[];
    cronSchedule?: string;
    restartPolicyType: "ALWAYS" | "ON_FAILURE" | "NEVER";
  };
}

/** Translate the `agent` block of a manifest into Railway's railway.json shape. */
export function buildRailwayJson(config: StecklingConfig): RailwayJson {
  const agent = config.agent;
  if (!agent) throw new Error("buildRailwayJson called without an `agent` block");
  const scheduled = agent.kind === "scheduled";
  const deploy: RailwayJson["deploy"] = {
    startCommand: agent.start,
    // A scheduled job must exit and not be restarted; an always-on agent should.
    restartPolicyType: scheduled ? "NEVER" : "ALWAYS",
  };
  if (agent.preDeploy) deploy.preDeployCommand = [agent.preDeploy];
  if (scheduled && agent.schedule) deploy.cronSchedule = agent.schedule;
  return {
    $schema: "https://railway.com/railway.schema.json",
    build: { builder: "DOCKERFILE", dockerfilePath: agent.build.dockerfile.replace(/^\.\//, "") },
    deploy,
  };
}

/** Write railway.json into the worktree and return its path. */
export function writeRailwayJson(worktreeDir: string, config: StecklingConfig): string {
  const path = join(worktreeDir, "railway.json");
  writeFileSync(path, JSON.stringify(buildRailwayJson(config), null, 2) + "\n");
  return path;
}

/** Reference-variable syntax for a managed database, for the deploy.needs hint. */
const DB_REFERENCE: Record<string, string> = {
  postgres: "${{Postgres.DATABASE_URL}}",
  redis: "${{Redis.REDIS_URL}}",
  mysql: "${{MySQL.MYSQL_URL}}",
  mongo: "${{MongoDB.MONGO_URL}}",
};

export function dbReference(dep: string): string | null {
  return DB_REFERENCE[dep] ?? null;
}

/** True if a cron minute field fires more often than Railway's 5-minute floor. */
export function cronTooFrequent(schedule: string): boolean {
  const minute = schedule.trim().split(/\s+/)[0] ?? "";
  if (minute === "*") return true;
  const step = /^\*\/(\d+)$/.exec(minute);
  return step ? Number(step[1]) < 5 : false;
}
