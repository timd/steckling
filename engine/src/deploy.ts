/**
 * Remote deploy orchestration (Path 1): ship a branch's agent to Railway as a
 * long-running or scheduled service. Composes the Railway backend + registry,
 * dispatching on `deploy.target` — the remote analogue of lifecycle.ts.
 *
 * `steck deploy --dry-run` writes railway.json and prints the exact command
 * sequence without executing anything, so the whole path is inspectable without
 * a live Railway account.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildRailwayJson,
  cronTooFrequent,
  dbReference,
  railwayAdd,
  railwayAvailable,
  railwayDown,
  railwayLogs,
  railwaySetVariable,
  railwayStatus,
  railwayUp,
  railwayWhoami,
  writeRailwayJson,
} from "./backends/railway";
import { formatConfigError, loadConfig, type StecklingConfig } from "./config";
import { currentBranch, repoRoot } from "./git";
import { c, log } from "./log";
import { computeNames } from "./naming";
import { loadRegistry, updateRegistry, type RailwayRecord } from "./registry";

interface DeployContext {
  config: StecklingConfig;
  worktreeDir: string;
  branch: string;
  /** Registry key (branch-derived compose project name). */
  regKey: string;
  agent: NonNullable<StecklingConfig["agent"]>;
  deploy: NonNullable<StecklingConfig["deploy"]>;
}

async function resolveContext(cwd?: string): Promise<DeployContext | { error: string }> {
  const res = await loadConfig(cwd);
  if (!res.ok) return { error: formatConfigError(res.error) };
  const worktreeDir = dirname(res.path);
  const branch = await currentBranch(worktreeDir);
  if (!branch) return { error: "Not on a named git branch (detached HEAD?)." };
  const { agent, deploy } = res.config;
  if (!agent || !deploy) {
    return {
      error: "No `agent`/`deploy` block in steckling.yml — nothing to deploy. See docs/deploy-railway.md.",
    };
  }
  return { config: res.config, worktreeDir, branch, regKey: computeNames(branch).project, agent, deploy };
}

/** Expand `${VAR}` / `$VAR` against the local environment (for deploy.env values). */
function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a, b) => {
    const name = (a ?? b) as string;
    const v = process.env[name];
    if (v === undefined) {
      log.warn(`deploy.env references ${name}, which isn't set locally — pushing an empty value.`);
      return "";
    }
    return v;
  });
}

/** Redact obviously-secret values before printing them in a dry-run plan. */
function maskSecret(key: string, value: string): string {
  return /key|token|secret|password|pat/i.test(key) ? "********" : value;
}

function printPlan(deploy: DeployContext["deploy"], vars: Record<string, string>): void {
  const steps: string[] = [];
  for (const dep of deploy.needs) steps.push(`railway add --database ${dep}`);
  for (const [k, v] of Object.entries(vars)) {
    steps.push(`railway variable set ${k} --stdin --skip-deploys   (value: ${maskSecret(k, v)})`);
  }
  steps.push("railway up");
  for (const s of steps) console.log(`    ${c.dim("$")} ${s}`);
}

export async function deploy(opts: { dryRun: boolean; cwd?: string }): Promise<number> {
  const ctx = await resolveContext(opts.cwd);
  if ("error" in ctx) {
    log.error(ctx.error);
    return 1;
  }
  const { config, worktreeDir, branch, regKey, agent, deploy: deployCfg } = ctx;

  if (agent.kind === "scheduled" && agent.schedule && cronTooFrequent(agent.schedule)) {
    log.warn(
      `Schedule '${agent.schedule}' fires more often than every 5 minutes — Railway's floor; extra runs are skipped.`,
    );
  }

  const dockerfile = resolve(worktreeDir, agent.build.dockerfile);
  if (!existsSync(dockerfile)) {
    log.error(`Dockerfile not found: ${dockerfile}  (set agent.build.dockerfile in steckling.yml)`);
    return 1;
  }

  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(deployCfg.env)) vars[k] = expandEnv(v);

  if (opts.dryRun) {
    log.info("railway.json (dry run — not written):");
    console.log(JSON.stringify(buildRailwayJson(config), null, 2));
    console.log("");
    log.info("Would run:");
    printPlan(deployCfg, vars);
    return 0;
  }

  if (!railwayAvailable()) {
    log.error("`railway` CLI not found on PATH — install it: https://docs.railway.com/cli");
    return 1;
  }
  if (!(await railwayWhoami(worktreeDir)).ok) {
    log.error("Not authenticated with Railway — run `railway login`, or set RAILWAY_TOKEN / RAILWAY_API_TOKEN.");
    return 1;
  }
  if (!(await railwayStatus(worktreeDir)).ok) {
    log.error(
      "This directory isn't linked to a Railway project. Run `railway init` (new) or `railway link` (existing) here once, then re-run `steck deploy`.",
    );
    return 1;
  }

  for (const dep of deployCfg.needs) {
    log.info(`Ensuring managed ${c.bold(dep)}…`);
    const r = await railwayAdd(worktreeDir, dep);
    if (!r.ok) log.warn(`  \`railway add --database ${dep}\` failed (already present?): ${r.stderr || r.stdout}`);
    const ref = dbReference(dep);
    if (ref) log.info(`  wire it into the agent by adding ${c.dim(`<ENV>: "${ref}"`)} under deploy.env`);
  }

  const jsonPath = writeRailwayJson(worktreeDir, config);
  log.ok(`Wrote ${c.bold(jsonPath)}`);

  for (const [k, v] of Object.entries(vars)) {
    const r = await railwaySetVariable(worktreeDir, k, v);
    if (!r.ok) {
      log.error(`Failed to set variable ${k}: ${r.stderr || r.stdout}`);
      return 1;
    }
  }
  if (Object.keys(vars).length) log.ok(`Set ${Object.keys(vars).length} variable(s).`);

  log.info(`Deploying ${c.bold(branch)} to Railway…`);
  const code = await railwayUp(worktreeDir);
  if (code !== 0) {
    log.error("`railway up` failed.");
    return code;
  }

  const now = new Date().toISOString();
  const root = (await repoRoot(worktreeDir)) ?? worktreeDir;
  await updateRegistry((reg) => {
    const existing = reg.worktrees[regKey];
    const railway: RailwayRecord = {
      project: deployCfg.project ?? existing?.railway?.project ?? branch,
      schedule: agent.kind === "scheduled" ? agent.schedule : undefined,
      lastDeployAt: now,
    };
    reg.worktrees[regKey] = existing
      ? { ...existing, railway, lastUsedAt: now }
      : {
          project: regKey,
          branch,
          repo: root,
          path: worktreeDir,
          ports: { services: {} },
          createdAt: now,
          lastUsedAt: now,
          railway,
        };
  });

  log.ok(`Deployed ${c.bold(branch)}. Tail it with: ${c.bold("steck logs")}`);
  return 0;
}

export async function deployStatus(cwd?: string): Promise<number> {
  const ctx = await resolveContext(cwd);
  if ("error" in ctx) {
    log.error(ctx.error);
    return 1;
  }
  const rec = loadRegistry().worktrees[ctx.regKey];
  console.log("");
  console.log(`  branch    ${ctx.branch}`);
  console.log(`  kind      ${ctx.agent.kind}${ctx.agent.schedule ? `  (${ctx.agent.schedule})` : ""}`);
  if (rec?.railway) {
    console.log(`  project   ${rec.railway.project}`);
    if (rec.railway.domain) console.log(`  domain    ${rec.railway.domain}`);
    console.log(`  deployed  ${rec.railway.lastDeployAt}`);
  } else {
    console.log(`  ${c.dim("(not deployed yet — run `steck deploy`)")}`);
  }
  console.log("");
  return 0;
}

export async function deployLogs(opts: { lines?: number; build?: boolean; cwd?: string }): Promise<number> {
  const ctx = await resolveContext(opts.cwd);
  if ("error" in ctx) {
    log.error(ctx.error);
    return 1;
  }
  if (!railwayAvailable()) {
    log.error("`railway` CLI not found on PATH.");
    return 1;
  }
  return railwayLogs(ctx.worktreeDir, { lines: opts.lines, build: opts.build });
}

function confirm(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = globalThis.prompt?.(question) ?? "";
  return /^y(es)?$/i.test(answer.trim());
}

export async function deployDestroy(opts: { yes: boolean; cwd?: string }): Promise<number> {
  const ctx = await resolveContext(opts.cwd);
  if ("error" in ctx) {
    log.error(ctx.error);
    return 1;
  }
  if (!railwayAvailable()) {
    log.error("`railway` CLI not found on PATH.");
    return 1;
  }
  log.warn(`This tears down the Railway deployment for ${c.bold(ctx.branch)}.`);
  console.log(`  ${c.dim("the local stack and git worktree are left untouched")}`);
  if (!opts.yes && !confirm("Proceed? (yes/no) ")) {
    log.info("Cancelled.");
    return 0;
  }
  const r = await railwayDown(ctx.worktreeDir);
  if (!r.ok) {
    log.error(`\`railway down\` failed:\n${r.stderr || r.stdout}`);
    return 1;
  }
  await updateRegistry((reg) => {
    const rec = reg.worktrees[ctx.regKey];
    if (rec?.railway) delete rec.railway;
  });
  log.ok("Railway deployment removed.");
  return 0;
}
