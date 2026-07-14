/** Unit tests for port-block allocation. Uses real sockets on high ports — no Docker. */
import { expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { allocateBlock, isPortFree } from "../src/ports";

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

// A quiet corner of port space for these tests.
const BASE = 46000;
const OPTS = { base: BASE, blockSize: 10, maxBlocks: 50 };

test("allocation is hash-stable: same seed → same block", async () => {
  const a = await allocateBlock("b28b7a", ["pg"], true, OPTS);
  const b = await allocateBlock("b28b7a", ["pg"], true, OPTS);
  expect(a.blockStart).toBe(b.blockStart);
  expect(a.services["pg"]).toBe(a.blockStart);
  expect(a.app).toBe(a.blockStart + 1);
});

test("reserved ports push allocation to the next block", async () => {
  const first = await allocateBlock("b28b7a", ["pg"], false, OPTS);
  const reserved = new Set([first.blockStart]);
  const next = await allocateBlock("b28b7a", ["pg"], false, { ...OPTS, reserved });
  expect(next.blockStart).not.toBe(first.blockStart);
});

test("a genuinely occupied port skips the block", async () => {
  const preferred = await allocateBlock("000000", ["pg"], false, OPTS);
  const srv = await listen(preferred.blockStart);
  try {
    const moved = await allocateBlock("000000", ["pg"], false, OPTS);
    expect(moved.blockStart).not.toBe(preferred.blockStart);
  } finally {
    srv.close();
  }
});

test("more slots than the block size throws", async () => {
  await expect(
    allocateBlock("abcdef", ["a", "b", "c"], true, { ...OPTS, blockSize: 3 }),
  ).rejects.toThrow(/Cannot fit/);
});

test("isPortFree detects a listening socket", async () => {
  const alloc = await allocateBlock("ffffff", ["x"], false, OPTS);
  const port = alloc.blockStart;
  expect(await isPortFree(port)).toBe(true);
  const srv = await listen(port);
  try {
    expect(await isPortFree(port)).toBe(false);
  } finally {
    srv.close();
  }
});
