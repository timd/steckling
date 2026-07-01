/**
 * Global registry at ~/.steckling/registry.json — the single source of truth for
 * which worktrees exist and what host ports they own. Writes go through a
 * directory-mutex lock + atomic rename so concurrent `up`/`new` don't corrupt it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PortsRecord {
  services: Record<string, number>;
  app?: number;
}

/** A branch's remote (Railway) deployment, present once `steck deploy` has run. */
export interface RailwayRecord {
  project: string;
  environment?: string;
  service?: string;
  domain?: string;
  schedule?: string;
  lastDeployAt: string;
}

export interface WorktreeRecord {
  project: string;
  branch: string;
  repo: string;
  path: string;
  ports: PortsRecord;
  createdAt: string;
  lastUsedAt: string;
  /** Set once this branch has been deployed to a remote target. */
  railway?: RailwayRecord;
}

export interface Registry {
  version: 1;
  worktrees: Record<string, WorktreeRecord>;
}

const DIR = join(homedir(), ".steckling");
const FILE = join(DIR, "registry.json");
const LOCK = join(DIR, "registry.lock");

function emptyRegistry(): Registry {
  return { version: 1, worktrees: {} };
}

/** Read the registry (tolerant of a missing/corrupt file → empty). */
export function loadRegistry(): Registry {
  if (!existsSync(FILE)) return emptyRegistry();
  try {
    const data = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Registry>;
    if (data && typeof data === "object" && data.worktrees) {
      return { version: 1, worktrees: data.worktrees };
    }
  } catch {
    // fall through to empty
  }
  return emptyRegistry();
}

function writeAtomic(reg: Registry): void {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n");
  renameSync(tmp, FILE);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read-modify-write the registry under an exclusive lock. */
export async function updateRegistry(mutate: (reg: Registry) => void): Promise<Registry> {
  mkdirSync(DIR, { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK); // atomic — throws if held
      break;
    } catch {
      if (Date.now() - start > 5000) throw new Error("Timed out acquiring the registry lock");
      await sleep(50);
    }
  }
  try {
    const reg = loadRegistry();
    mutate(reg);
    writeAtomic(reg);
    return reg;
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

/** Every host port currently reserved by any worktree (optionally excluding one). */
export function reservedPorts(reg: Registry, exceptProject?: string): Set<number> {
  const ports = new Set<number>();
  for (const [project, w] of Object.entries(reg.worktrees)) {
    if (project === exceptProject) continue;
    for (const p of Object.values(w.ports.services)) ports.add(p);
    if (w.ports.app !== undefined) ports.add(w.ports.app);
  }
  return ports;
}
