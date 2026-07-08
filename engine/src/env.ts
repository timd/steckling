/**
 * Computes the per-branch environment and writes the gitignored `.steckling/env`
 * dotenv the app reads. Also produces the `STECKLING_PORT_*` vars the compose
 * file interpolates for host ports.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StecklingConfig } from "./config";
import type { PortAllocation } from "./ports";
import { ticketEnvName, ticketUrl } from "./ticket";

/** Compose-interpolation var name for a service's host port. */
export function portEnvName(service: string): string {
  return "STECKLING_PORT_" + service.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Placeholder port vars for read-only compose commands (ps/port/stop/down).
 * Docker still interpolates the compose file for these, so the vars must be
 * set even though their values are unused by those subcommands.
 */
export function portPlaceholders(serviceNames: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of serviceNames) out[portEnvName(name)] = "0";
  return out;
}

/** Branch/ticket identity injected alongside the service URLs. */
export interface EnvMeta {
  branch: string;
  project: string;
  ticket?: string;
}

/** The STECKLING_* identity vars — also used alone for hooks that run before/after the stack exists. */
export function metaVars(config: StecklingConfig, meta: EnvMeta): Record<string, string> {
  const out: Record<string, string> = {
    STECKLING_BRANCH: meta.branch,
    STECKLING_PROJECT: meta.project,
  };
  if (meta.ticket) {
    out[ticketEnvName(config)] = meta.ticket;
    const url = ticketUrl(config, meta.ticket);
    if (url) out["STECKLING_TICKET_URL"] = url;
  }
  return out;
}

export interface ResolvedEnv {
  /** Vars written to .steckling/env and injected into the app + hooks. */
  vars: Record<string, string>;
  /** Vars for docker compose `${...}` interpolation. */
  composeEnv: Record<string, string>;
  /** `env.extra` keys that overrode an injected var (extra wins; caller warns). */
  collisions: string[];
}

export function resolveEnv(
  config: StecklingConfig,
  ports: PortAllocation,
  meta: EnvMeta,
): ResolvedEnv {
  const vars: Record<string, string> = {};
  const composeEnv: Record<string, string> = {};
  const appPort = ports.app;

  for (const [name, entry] of Object.entries(config.services.expose)) {
    const hostPort = ports.services[name];
    if (hostPort === undefined) continue;
    composeEnv[portEnvName(name)] = String(hostPort);
    vars[entry.env] = entry.url.replaceAll("{port}", String(hostPort));
  }

  if (config.app.port && appPort !== undefined) {
    vars[config.app.port.env] = String(appPort);
  }

  Object.assign(vars, metaVars(config, meta));

  const collisions: string[] = [];
  for (const [key, value] of Object.entries(config.env.extra)) {
    if (key in vars) collisions.push(key);
    vars[key] = appPort !== undefined ? value.replaceAll("{app_port}", String(appPort)) : value;
  }

  return { vars, composeEnv, collisions };
}

export function stecklingDir(worktreeDir: string): string {
  return join(worktreeDir, ".steckling");
}

function escapeVal(v: string): string {
  return /[\s#"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

/** Write `.steckling/env` and return its path. */
export function writeDotenv(worktreeDir: string, vars: Record<string, string>): string {
  const dir = stecklingDir(worktreeDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "env");
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}=${escapeVal(v)}`)
    .join("\n");
  writeFileSync(path, body + "\n");
  return path;
}

/** Parse `.steckling/env`, or null if it doesn't exist. */
export function readDotenv(worktreeDir: string): Record<string, string> | null {
  const path = join(stecklingDir(worktreeDir), "env");
  if (!existsSync(path)) return null;
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq);
    let val = t.slice(eq + 1);
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\"/g, '"');
    }
    out[key] = val;
  }
  return out;
}
