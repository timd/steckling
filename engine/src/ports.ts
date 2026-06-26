/**
 * Host-port allocation. A worktree owns a contiguous block of ports — one per
 * exposed service (+ optionally the app). The preferred block is derived from
 * the branch hash for stability; if it's taken we scan forward for a free one.
 *
 * NB: M1 allocates on each `up` when the stack isn't already running; stable
 * persistence across restarts arrives with the registry in M2.
 */

import { connect, createServer } from "node:net";

export interface PortAllocation {
  /** serviceName → host port */
  services: Record<string, number>;
  /** app's own host port, if the config requested one */
  app?: number;
  blockStart: number;
}

/** True if a connection to the port is accepted (something is listening). */
function canConnect(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: "127.0.0.1", port });
    const finish = (v: boolean): void => {
      sock.destroy();
      resolve(v);
    };
    sock.once("connect", () => finish(true));
    sock.once("error", () => resolve(false));
    sock.setTimeout(timeoutMs, () => finish(false));
  });
}

/** True if we can bind the port ourselves. */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

/**
 * A port is free only if nothing accepts a connection AND we can bind it.
 * The connect-test is what catches Docker-published ports on macOS, where a
 * bind-test alone can wrongly report the port as free.
 */
export async function isPortFree(port: number): Promise<boolean> {
  if (await canConnect(port)) return false;
  return canBind(port);
}

export interface AllocateOptions {
  base?: number;
  blockSize?: number;
  maxBlocks?: number;
  /** Host ports already claimed by other worktrees (from the registry) — avoided. */
  reserved?: Set<number>;
}

export async function allocateBlock(
  seedHash6: string,
  serviceNames: string[],
  needApp: boolean,
  opts: AllocateOptions = {},
): Promise<PortAllocation> {
  const base = opts.base ?? 20000;
  const blockSize = opts.blockSize ?? 10;
  const maxBlocks = opts.maxBlocks ?? 3000;
  const slots = serviceNames.length + (needApp ? 1 : 0);
  if (slots > blockSize) {
    throw new Error(`Cannot fit ${slots} ports in a block of ${blockSize}`);
  }

  const hashInt = Number.parseInt(seedHash6, 16);
  const preferred = Number.isNaN(hashInt) ? 0 : hashInt % maxBlocks;

  const reserved = opts.reserved;
  for (let i = 0; i < maxBlocks; i++) {
    const blockIdx = (preferred + i) % maxBlocks;
    const start = base + blockIdx * blockSize;

    if (reserved && rangeHits(reserved, start, slots)) continue;

    let allFree = true;
    for (let p = 0; p < slots; p++) {
      if (!(await isPortFree(start + p))) {
        allFree = false;
        break;
      }
    }
    if (!allFree) continue;

    const services: Record<string, number> = {};
    serviceNames.forEach((name, idx) => {
      services[name] = start + idx;
    });
    const allocation: PortAllocation = { services, blockStart: start };
    if (needApp) allocation.app = start + serviceNames.length;
    return allocation;
  }

  throw new Error(`No free port block found in ${base}..${base + maxBlocks * blockSize}`);
}

function rangeHits(reserved: Set<number>, start: number, slots: number): boolean {
  for (let p = 0; p < slots; p++) {
    if (reserved.has(start + p)) return true;
  }
  return false;
}
