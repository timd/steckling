/**
 * Capture console output while running a function. Used by the MCP server: the
 * lifecycle functions log via console.*, but in an MCP stdio server stdout is
 * the JSON-RPC channel — so we redirect their output into a buffer and return
 * it as the tool result instead of letting it corrupt the protocol stream.
 *
 * Safe because the stdio server handles requests sequentially.
 */

export interface Captured {
  code: number;
  output: string;
}

export async function captureConsole(fn: () => Promise<number>): Promise<Captured> {
  const lines: string[] = [];
  const sink = (...args: unknown[]): void => {
    lines.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };
  console.log = sink;
  console.warn = sink;
  console.error = sink;
  console.info = sink;
  try {
    const code = await fn();
    return { code, output: lines.join("\n") };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
    console.info = original.info;
  }
}
