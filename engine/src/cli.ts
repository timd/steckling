#!/usr/bin/env bun
/**
 * Steckling CLI entrypoint — argument dispatch.
 *
 * M0 implements `doctor` and `config`; the lifecycle commands are registered
 * but stubbed until later milestones (see docs/plan.md §11).
 */

import { loadConfig, formatConfigError } from "./config";
import { deploy, deployDestroy, deployLogs, deployStatus } from "./deploy";
import { runDoctor } from "./doctor";
import { init } from "./init";
import { down, execCmd, list, newWorktree, prune, rm, status, up } from "./lifecycle";
import { startMcp } from "./mcp/server";
import { c, log } from "./log";
import { version } from "./version";

const HELP = `${c.bold("steck")} v${version} — a worktree + isolated Docker stack per git branch

${c.bold("Usage:")} steck <command> [options]

${c.bold("Commands:")}
  init [--yes]          Set up this repo (interactive wizard; --yes writes defaults)
  new <branch> [base]   Create a worktree + allocate its service ports
  up [--no-run]         Bring up services, provision, run the app
  down                  Stop this branch's containers (keeps data)
  list                  Show every worktree, its ports + status
  status [branch]       Detailed status of a worktree
  exec -- <cmd>         Run a command with this branch's env loaded
  rm [branch] [--yes]   Destroy containers + volumes (asks first; --purge: folder+branch too)
  prune [--yes]         Clean up merged/dead branches (--purge: folders+branches too)
  deploy [--dry-run]    Ship this branch's agent to Railway (--status to inspect)
  logs [-n N] [--build] Tail the deployed agent's logs
  destroy [--yes]       Tear down this branch's Railway deployment
  config                Validate + print the resolved steckling.yml
  doctor                Check the environment is ready
  mcp                   Start the MCP server (stdio) for agents

${c.bold("Flags:")}
  -h, --help            Show this help
  -v, --version         Show version`;

const STUBBED = new Set<string>();

async function runConfig(): Promise<number> {
  const res = await loadConfig();
  if (!res.ok) {
    log.error("steckling.yml could not be loaded:");
    console.error(formatConfigError(res.error));
    return 1;
  }
  log.ok(`Loaded ${c.bold(res.path)}`);
  console.log(JSON.stringify(res.config, null, 2));
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === undefined || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(HELP);
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(version);
    return 0;
  }

  switch (cmd) {
    case "init": {
      const flags = argv.slice(1);
      return init({ yes: flags.includes("--yes") || flags.includes("-y") });
    }
    case "doctor":
      return runDoctor();
    case "config":
      return runConfig();
    case "up": {
      const flags = argv.slice(1);
      return up({ noRun: flags.includes("--no-run"), reprovision: flags.includes("--reprovision") });
    }
    case "down":
      return down();
    case "exec": {
      const rest = argv.slice(1);
      return execCmd(rest[0] === "--" ? rest.slice(1) : rest);
    }
    case "new": {
      const positional = argv.slice(1).filter((a) => !a.startsWith("-"));
      const flags = argv.slice(1).filter((a) => a.startsWith("-"));
      const branch = positional[0];
      if (!branch) {
        log.error("Usage: steck new <branch> [base] [--up] [--no-run]");
        return 1;
      }
      return newWorktree(branch, positional[1], {
        up: flags.includes("--up"),
        noRun: flags.includes("--no-run"),
      });
    }
    case "list":
      return list();
    case "status": {
      const positional = argv.slice(1).filter((a) => !a.startsWith("-"));
      return status(positional[0]);
    }
    case "rm": {
      const positional = argv.slice(1).filter((a) => !a.startsWith("-"));
      const flags = argv.slice(1).filter((a) => a.startsWith("-"));
      return rm(positional[0], {
        yes: flags.includes("--yes") || flags.includes("-y"),
        force: flags.includes("--force"),
        purge: flags.includes("--purge"),
      });
    }
    case "prune": {
      const flags = argv.slice(1).filter((a) => a.startsWith("-"));
      return prune({
        yes: flags.includes("--yes") || flags.includes("-y"),
        purge: flags.includes("--purge"),
      });
    }
    case "deploy": {
      const flags = argv.slice(1);
      if (flags.includes("--status")) return deployStatus();
      return deploy({ dryRun: flags.includes("--dry-run") });
    }
    case "logs": {
      const flags = argv.slice(1);
      let lines: number | undefined;
      const nIdx = flags.indexOf("-n");
      if (nIdx !== -1 && flags[nIdx + 1]) {
        const n = Number(flags[nIdx + 1]);
        if (Number.isFinite(n)) lines = n;
      }
      return deployLogs({ lines, build: flags.includes("--build") });
    }
    case "destroy": {
      const flags = argv.slice(1);
      return deployDestroy({ yes: flags.includes("--yes") || flags.includes("-y") });
    }
    case "mcp":
      return startMcp();
    default:
      if (STUBBED.has(cmd)) {
        log.warn(`'steck ${cmd}' isn't implemented yet — it lands in a later milestone.`);
        log.info("Try 'steck doctor' or 'steck config' for now.");
        return 1;
      }
      log.error(`Unknown command: ${cmd}`);
      console.log(`\n${HELP}`);
      return 1;
  }
}

process.exit(await main());
