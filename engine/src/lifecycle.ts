/**
 * Lifecycle orchestration. M1 gave us the single-branch loop; M2 adds the
 * registry (stable ports + a record per worktree) and the worktree commands.
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  composeFileHasServices,
  composePort,
  composeStop,
  composeUp,
  destroyProject,
  projectStatus,
  type ComposeContext,
} from "./compose";
import { formatConfigError, loadConfig, type StecklingConfig } from "./config";
import { portPlaceholders, readDotenv, resolveEnv, stecklingDir, writeDotenv } from "./env";
import {
  currentBranch,
  deleteBranch,
  isMerged,
  localBranchExists,
  remoteRefExists,
  removeWorktree,
  repoRoot,
  worktreePrune,
} from "./git";
import { runHook } from "./hooks";
import { c, log } from "./log";
import { type BranchNames, computeNames } from "./naming";
import { allocateBlock, isPortFree, type PortAllocation } from "./ports";
import {
  loadRegistry,
  reservedPorts,
  updateRegistry,
  type Registry,
  type WorktreeRecord,
} from "./registry";
import { runInherit } from "./sh";
import { createWorktree, planWorktree } from "./worktree";

interface Context {
  config: StecklingConfig;
  worktreeDir: string;
  repoRoot: string;
  branch: string;
  names: BranchNames;
  composeFile: string;
}

async function resolveContext(cwd: string = process.cwd()): Promise<Context | { error: string }> {
  const res = await loadConfig(cwd);
  if (!res.ok) return { error: formatConfigError(res.error) };

  const worktreeDir = dirname(res.path);
  const branch = await currentBranch(worktreeDir);
  if (!branch) {
    return {
      error: "Not on a named git branch (detached HEAD?). Steckling keys everything off the branch name.",
    };
  }

  const composeFile = resolve(worktreeDir, res.config.services.compose);
  if (!existsSync(composeFile)) return { error: `Compose file not found: ${composeFile}` };

  const root = (await repoRoot(worktreeDir)) ?? worktreeDir;
  return {
    config: res.config,
    worktreeDir,
    repoRoot: root,
    branch,
    names: computeNames(branch),
    composeFile,
  };
}

function markerPath(worktreeDir: string): string {
  return join(stecklingDir(worktreeDir), ".provisioned");
}

/** Interactive yes/no. Returns false in a non-TTY (so callers must pass --yes there). */
function confirm(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = globalThis.prompt?.(question) ?? "";
  return /^y(es)?$/i.test(answer.trim());
}

async function baseRefFor(root: string, base: string): Promise<string> {
  return (await remoteRefExists(root, base)) ? `origin/${base}` : base;
}

function firstLine(s: string): string {
  return s.split("\n")[0] ?? s;
}

/**
 * The `--purge` half of rm/prune: remove the worktree folder (git refuses a
 * dirty one unless `force`) and delete the branch (-D only when we've verified
 * it's merged, or on `force`; otherwise -d and git decides). Failures warn and
 * keep — purge never turns a safety refusal into an error exit.
 */
async function purgeWorktree(
  root: string,
  branch: string,
  path: string | undefined,
  opts: { merged: boolean; force: boolean },
): Promise<void> {
  if (path && existsSync(path)) {
    const r = await removeWorktree(root, path, opts.force);
    if (r.ok) log.ok(`Removed folder ${path}`);
    else {
      log.warn(`Kept folder ${path}: ${firstLine(r.stderr || r.stdout)}`);
      log.info(`Remove it manually with: git worktree remove ${opts.force ? "" : "--force "}"${path}"`);
    }
  }
  await worktreePrune(root);
  if (await localBranchExists(root, branch)) {
    const r = await deleteBranch(root, branch, opts.merged || opts.force);
    if (r.ok) log.ok(`Deleted branch ${branch}`);
    else log.warn(`Kept branch ${branch}: ${firstLine(r.stderr || r.stdout)}`);
  }
}

function recordToAllocation(rec: WorktreeRecord): PortAllocation {
  const values = Object.values(rec.ports.services);
  const alloc: PortAllocation = {
    services: rec.ports.services,
    blockStart: values.length ? Math.min(...values) : 0,
  };
  if (rec.ports.app !== undefined) alloc.app = rec.ports.app;
  return alloc;
}

async function allPortsFree(alloc: PortAllocation): Promise<boolean> {
  for (const p of Object.values(alloc.services)) {
    if (!(await isPortFree(p))) return false;
  }
  if (alloc.app !== undefined && !(await isPortFree(alloc.app))) return false;
  return true;
}

function portsRecordFrom(alloc: PortAllocation): WorktreeRecord["ports"] {
  return alloc.app !== undefined
    ? { services: alloc.services, app: alloc.app }
    : { services: alloc.services };
}

function portsSummary(alloc: PortAllocation, serviceNames: string[]): string {
  const svc = serviceNames.map((n) => `${n}:${alloc.services[n] ?? "?"}`).join("  ");
  return alloc.app !== undefined ? `${svc}  app:${alloc.app}` : svc;
}

interface UpOptions {
  noRun: boolean;
  reprovision: boolean;
  /** Operate on the worktree at this dir instead of the current one (used by MCP). */
  cwd?: string;
}

export async function up(opts: UpOptions): Promise<number> {
  const ctx = await resolveContext(opts.cwd);
  if ("error" in ctx) {
    log.error(ctx.error);
    return 1;
  }

  const serviceNames = Object.keys(ctx.config.services.expose);
  const needApp = Boolean(ctx.config.app.port);
  const base = { project: ctx.names.project, file: ctx.composeFile, cwd: ctx.worktreeDir };
  const probeEnv = portPlaceholders(serviceNames);

  const reg = loadRegistry();
  const record = reg.worktrees[ctx.names.project];
  const status = await projectStatus(ctx.names.project);

  // --- resolve host ports ---
  let ports: PortAllocation;
  if (status === "up") {
    log.info(`Stack already running (project ${c.bold(ctx.names.project)}).`);
    const services: Record<string, number> = {};
    for (const name of serviceNames) {
      const entry = ctx.config.services.expose[name]!;
      const p = await composePort({ ...base, env: probeEnv }, name, entry.container);
      if (p === null) {
        log.error(`Couldn't discover the host port for service '${name}'.`);
        return 1;
      }
      services[name] = p;
    }
    const values = Object.values(services);
    ports = { services, blockStart: values.length ? Math.min(...values) : 0 };
    if (needApp) {
      const prev = record?.ports.app;
      ports.app =
        prev ?? (await allocateBlock(ctx.names.hash6, [], true, {
          reserved: reservedPorts(reg, ctx.names.project),
        })).app;
    }
  } else if (record) {
    const recAlloc = recordToAllocation(record);
    if (await allPortsFree(recAlloc)) {
      ports = recAlloc; // stable: reuse the recorded ports
    } else {
      log.warn("Recorded ports are now in use elsewhere — reallocating.");
      ports = await allocateBlock(ctx.names.hash6, serviceNames, needApp, {
        reserved: reservedPorts(reg, ctx.names.project),
      });
    }
  } else {
    ports = await allocateBlock(ctx.names.hash6, serviceNames, needApp, {
      reserved: reservedPorts(reg),
    });
  }

  const { vars, composeEnv } = resolveEnv(ctx.config, ports);

  if (status !== "up") {
    if (composeFileHasServices(ctx.composeFile)) {
      log.info(`Starting services for ${c.bold(ctx.branch)} → project ${c.bold(ctx.names.project)} …`);
      const composeCtx: ComposeContext = { ...base, env: composeEnv };
      const r = await composeUp(composeCtx);
      if (!r.ok) {
        log.error("docker compose up failed:\n" + (r.stderr || r.stdout));
        return 1;
      }
    } else {
      log.info(`No services in ${c.bold(ctx.config.services.compose)} — skipping Docker.`);
    }
  }

  const envPath = writeDotenv(ctx.worktreeDir, vars);
  log.ok(`Wrote ${c.bold(envPath)}`);
  for (const [k, v] of Object.entries(vars)) console.log(`    ${c.dim(`${k}=${v}`)}`);

  // --- persist to the registry ---
  const now = new Date().toISOString();
  await updateRegistry((r) => {
    const existing = r.worktrees[ctx.names.project];
    r.worktrees[ctx.names.project] = {
      project: ctx.names.project,
      branch: ctx.branch,
      repo: ctx.repoRoot,
      path: ctx.worktreeDir,
      ports: portsRecordFrom(ports),
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now,
    };
  });

  // --- provision once (or on --reprovision) ---
  const hasHook = ctx.config.hooks.provision.trim() !== "";
  const marker = markerPath(ctx.worktreeDir);
  if (hasHook && (opts.reprovision || !existsSync(marker))) {
    log.info(`Provisioning: ${c.dim(ctx.config.hooks.provision)}`);
    const code = await runHook(ctx.config.hooks.provision, ctx.worktreeDir, vars);
    if (code !== null && code !== 0) {
      log.error(`Provision hook exited ${code}.`);
      return code;
    }
    writeFileSync(marker, "provisioned\n");
    log.ok("Provisioned.");
  } else if (hasHook) {
    log.info("Already provisioned (use --reprovision to re-run).");
  }

  // --- run the app, or stop here ---
  if (opts.noRun) {
    log.ok(`Stack up — ${portsSummary(ports, serviceNames)}`);
    log.info("Start the app with: steck up   (or run a command via: steck exec -- <cmd>)");
    return 0;
  }

  log.info(`Running app: ${c.bold(ctx.config.app.run)}  (${portsSummary(ports, serviceNames)})`);
  return runInherit(["sh", "-c", ctx.config.app.run], { cwd: ctx.worktreeDir, env: vars });
}

export async function down(cwd?: string): Promise<number> {
  const ctx = await resolveContext(cwd);
  if ("error" in ctx) {
    log.error(ctx.error);
    return 1;
  }
  if (!composeFileHasServices(ctx.composeFile)) {
    log.info(`No services in ${c.bold(ctx.config.services.compose)} — nothing to stop.`);
    return 0;
  }
  const composeCtx: ComposeContext = {
    project: ctx.names.project,
    file: ctx.composeFile,
    cwd: ctx.worktreeDir,
    env: portPlaceholders(Object.keys(ctx.config.services.expose)),
  };
  log.info(`Stopping services for ${c.bold(ctx.branch)} (data kept)…`);
  const r = await composeStop(composeCtx);
  if (!r.ok) {
    log.error("docker compose stop failed:\n" + (r.stderr || r.stdout));
    return 1;
  }
  log.ok("Stopped. Volumes preserved — `steck up` to resume.");
  return 0;
}

export async function execCmd(cmd: string[]): Promise<number> {
  if (cmd.length === 0) {
    log.error("Usage: steck exec -- <command> [args…]");
    return 1;
  }
  const res = await loadConfig();
  if (!res.ok) {
    log.error(formatConfigError(res.error));
    return 1;
  }
  const worktreeDir = dirname(res.path);
  const env = readDotenv(worktreeDir);
  if (!env) {
    log.error("No .steckling/env found — run `steck up` first.");
    return 1;
  }
  return runInherit(cmd, { cwd: worktreeDir, env });
}

interface NewOptions {
  up: boolean;
  noRun: boolean;
}

export async function newWorktree(
  branch: string,
  baseArg: string | undefined,
  opts: NewOptions,
): Promise<number> {
  const res = await loadConfig();
  if (!res.ok) {
    log.error(formatConfigError(res.error));
    return 1;
  }
  const cfg = res.config;
  const base = baseArg ?? cfg.worktrees.base;
  const names = computeNames(branch);

  log.info(`Creating worktree for ${c.bold(branch)} (base ${c.bold(base)})…`);
  const plan = await planWorktree(branch, base, process.cwd(), cfg.worktrees.dir);
  if ("error" in plan) {
    log.error(plan.error);
    return 1;
  }

  const created = await createWorktree(branch, plan, cfg.worktrees.copyOnCreate);
  if ("error" in created) {
    log.error(created.error);
    return 1;
  }
  log.ok(`Worktree at ${c.bold(plan.worktreePath)}`);

  const reg = loadRegistry();
  const serviceNames = Object.keys(cfg.services.expose);
  const ports = await allocateBlock(names.hash6, serviceNames, Boolean(cfg.app.port), {
    reserved: reservedPorts(reg),
  });

  const now = new Date().toISOString();
  await updateRegistry((r) => {
    r.worktrees[names.project] = {
      project: names.project,
      branch,
      repo: plan.repoRoot,
      path: plan.worktreePath,
      ports: portsRecordFrom(ports),
      createdAt: now,
      lastUsedAt: now,
    };
  });
  log.ok(`Allocated ports: ${portsSummary(ports, serviceNames)}`);

  if (opts.up) {
    process.chdir(plan.worktreePath);
    return up({ noRun: opts.noRun, reprovision: false });
  }
  log.info(`Next: ${c.bold(`cd ${plan.worktreePath} && steck up`)}`);
  return 0;
}

function statusCell(status: "up" | "stopped" | "absent"): string {
  const word = status === "absent" ? "down" : status;
  const paint = status === "up" ? c.green : status === "stopped" ? c.yellow : c.dim;
  return paint(word.padEnd(8));
}

function portsCell(rec: WorktreeRecord): string {
  const svc = Object.entries(rec.ports.services).map(([n, p]) => `${n}:${p}`);
  if (rec.ports.app !== undefined) svc.push(`app:${rec.ports.app}`);
  return svc.join(",");
}

export async function list(): Promise<number> {
  const reg = loadRegistry();
  const entries = Object.values(reg.worktrees).sort((a, b) => a.branch.localeCompare(b.branch));
  if (entries.length === 0) {
    log.info("No worktrees registered yet. Use `steck new <branch>` or `steck up`.");
    return 0;
  }

  console.log("");
  console.log(
    `  ${c.bold("BRANCH".padEnd(26))} ${c.bold("STATUS".padEnd(8))} ${c.bold("PORTS".padEnd(26))} PATH`,
  );
  for (const w of entries) {
    const st = await projectStatus(w.project);
    const note = existsSync(w.path) ? "" : c.red(" (missing)");
    console.log(
      `  ${w.branch.padEnd(26)} ${statusCell(st)} ${portsCell(w).padEnd(26)} ${c.dim(w.path)}${note}`,
    );
  }
  console.log("");
  return 0;
}

export interface WorktreeSnapshot {
  branch: string;
  project: string;
  status: "up" | "stopped" | "down";
  ports: WorktreeRecord["ports"];
  path: string;
  pathExists: boolean;
  lastUsedAt: string;
}

/** Structured registry view with live status — for the MCP resource + tools (no console output). */
export async function snapshot(): Promise<WorktreeSnapshot[]> {
  const reg = loadRegistry();
  const out: WorktreeSnapshot[] = [];
  for (const w of Object.values(reg.worktrees)) {
    const st = await projectStatus(w.project);
    out.push({
      branch: w.branch,
      project: w.project,
      status: st === "absent" ? "down" : st,
      ports: w.ports,
      path: w.path,
      pathExists: existsSync(w.path),
      lastUsedAt: w.lastUsedAt,
    });
  }
  return out.sort((a, b) => a.branch.localeCompare(b.branch));
}

export async function status(branchArg?: string): Promise<number> {
  const reg = loadRegistry();

  let project: string;
  let branchLabel: string;
  if (branchArg) {
    project = computeNames(branchArg).project;
    branchLabel = branchArg;
  } else {
    const res = await loadConfig();
    if (!res.ok) {
      log.error(formatConfigError(res.error));
      return 1;
    }
    const branch = await currentBranch(dirname(res.path));
    if (!branch) {
      log.error("Detached HEAD — pass a branch name: steck status <branch>");
      return 1;
    }
    project = computeNames(branch).project;
    branchLabel = branch;
  }

  const record = reg.worktrees[project];
  const st = await projectStatus(project);

  console.log("");
  console.log(`  branch    ${record?.branch ?? branchLabel}`);
  console.log(`  project   ${project}`);
  console.log(`  status    ${st === "absent" ? "down" : st}`);
  if (record) {
    const missing = existsSync(record.path) ? "" : c.red("  (missing)");
    console.log(`  path      ${record.path}${missing}`);
    console.log(`  ports     ${portsCell(record).replace(/,/g, "  ")}`);
    const envFile = join(record.path, ".steckling", "env");
    console.log(`  env       ${existsSync(envFile) ? envFile : c.dim("(not written yet)")}`);
    console.log(`  used      ${record.lastUsedAt}`);
  } else {
    console.log(`  ${c.dim("(no registry entry — run `steck up` or `steck new`)")}`);
  }
  console.log("");
  return 0;
}

interface RmOptions {
  yes: boolean;
  force: boolean;
  /** Also remove the worktree folder and delete the git branch. */
  purge: boolean;
}

export async function rm(branchArg: string | undefined, opts: RmOptions): Promise<number> {
  const res = await loadConfig();
  if (!res.ok) {
    log.error(formatConfigError(res.error));
    return 1;
  }
  const cfg = res.config;
  const reg = loadRegistry();

  let branch: string;
  if (branchArg) {
    branch = branchArg;
  } else {
    const b = await currentBranch(dirname(res.path));
    if (!b) {
      log.error("Detached HEAD — pass a branch name: steck rm <branch>");
      return 1;
    }
    branch = b;
  }

  if (branch === cfg.worktrees.base && !opts.force) {
    log.error(`Refusing to rm the base branch '${branch}'. Pass --force to override.`);
    return 1;
  }

  const project = computeNames(branch).project;
  const record = reg.worktrees[project];
  const st = await projectStatus(project);
  if (st === "absent" && !record) {
    log.error(`Nothing to remove for '${branch}' (no containers and no registry entry).`);
    return 1;
  }

  log.warn(`This DESTROYS the stack for ${c.bold(branch)} (project ${project}):`);
  console.log("  • containers + named volumes  (DATA LOSS)");
  console.log("  • its registry entry");
  if (opts.purge) {
    console.log("  • the worktree folder + the git branch");
  } else {
    console.log(`  ${c.dim("the worktree folder and git branch are left intact")}`);
  }
  if (!opts.yes && !confirm("Proceed? (yes/no) ")) {
    log.info("Cancelled.");
    return 0;
  }

  const d = await destroyProject(project);
  await updateRegistry((r) => {
    delete r.worktrees[project];
  });
  log.ok(`Removed ${d.containers} container(s), ${d.volumes} volume(s), ${d.networks} network(s).`);

  if (opts.purge) {
    const root = (await repoRoot(process.cwd())) ?? process.cwd();
    const merged = await isMerged(root, branch, await baseRefFor(root, cfg.worktrees.base));
    await purgeWorktree(root, branch, record?.path, { merged, force: opts.force });
  } else if (record && existsSync(record.path)) {
    log.info(`Worktree kept at ${record.path}  (remove with: git worktree remove "${record.path}")`);
  }
  return 0;
}

interface PruneOptions {
  yes: boolean;
  /** Also remove the worktree folders and delete the git branches. */
  purge: boolean;
}

export async function prune(opts: PruneOptions): Promise<number> {
  const res = await loadConfig();
  if (!res.ok) {
    log.error(formatConfigError(res.error));
    return 1;
  }
  const cfg = res.config;
  const reg = loadRegistry();
  const root = (await repoRoot(process.cwd())) ?? process.cwd();
  const base = cfg.worktrees.base;
  const baseRef = await baseRefFor(root, base);

  const candidates: Array<{ record: WorktreeRecord; reason: string }> = [];
  for (const record of Object.values(reg.worktrees)) {
    if (record.branch === base) continue;
    if (!existsSync(record.path)) {
      candidates.push({ record, reason: "worktree folder missing" });
    } else if (!(await localBranchExists(root, record.branch))) {
      candidates.push({ record, reason: "branch deleted" });
    } else if (await isMerged(root, record.branch, baseRef)) {
      candidates.push({ record, reason: `merged into ${base}` });
    }
  }

  if (candidates.length === 0) {
    log.info("Nothing to prune — every worktree is active and unmerged.");
    return 0;
  }

  const scope = opts.purge
    ? "DESTROYS containers + volumes + worktree folders + branches"
    : "DESTROYS containers + volumes";
  log.warn(`${candidates.length} worktree(s) eligible for prune (${scope}):`);
  for (const { record, reason } of candidates) {
    console.log(`  • ${record.branch.padEnd(24)} ${c.dim(`(${reason})`)}  ${c.dim(record.path)}`);
  }
  if (!opts.purge) {
    console.log(`  ${c.dim("worktree folders + git branches are left intact (--purge removes them too)")}`);
  }
  if (!opts.yes && !confirm("Prune these? (yes/no) ")) {
    log.info("Cancelled.");
    return 0;
  }

  for (const { record, reason } of candidates) {
    const d = await destroyProject(record.project);
    await updateRegistry((r) => {
      delete r.worktrees[record.project];
    });
    log.ok(`pruned ${record.branch} — ${d.containers} container(s), ${d.volumes} volume(s)`);
    if (opts.purge) {
      // -D only for branches whose merged-ness the candidate check established;
      // "folder missing" candidates may hold unmerged commits, so -d lets git refuse.
      const merged = reason.startsWith("merged");
      await purgeWorktree(root, record.branch, record.path, { merged, force: false });
    }
  }
  await worktreePrune(root);
  return 0;
}
