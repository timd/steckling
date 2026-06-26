/**
 * `steck mcp` — a stdio MCP server exposing the lifecycle as tools plus a
 * live `steckling://registry` resource, so an agent can drive the worktree fleet.
 *
 * A thin wrapper: read-only ops use snapshot() directly; state-changing ops
 * call the in-process lifecycle functions with their console output captured
 * (stdout is the JSON-RPC channel and must stay clean).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureConsole } from "../capture";
import { down, newWorktree, snapshot, up } from "../lifecycle";
import { computeNames } from "../naming";
import { loadRegistry } from "../registry";
import { version } from "../version";

function text(s: string, isError = false): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return isError ? { content: [{ type: "text", text: s }], isError: true } : { content: [{ type: "text", text: s }] };
}

function worktreePath(branch: string): string | null {
  return loadRegistry().worktrees[computeNames(branch).project]?.path ?? null;
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "steckling", version });

  server.registerResource(
    "registry",
    "steckling://registry",
    {
      title: "Steckling registry",
      description: "All worktrees with live status and host ports.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await snapshot(), null, 2) }],
    }),
  );

  server.registerTool(
    "steckling_list",
    {
      title: "List worktrees",
      description: "Every Steckling worktree with its live status (up/stopped/down) and host ports.",
      inputSchema: {},
    },
    async () => text(JSON.stringify(await snapshot(), null, 2)),
  );

  server.registerTool(
    "steckling_status",
    {
      title: "Worktree status",
      description: "Status + ports for one branch's worktree.",
      inputSchema: { branch: z.string().describe("Branch name") },
    },
    async ({ branch }) => {
      const found = (await snapshot()).find((s) => s.branch === branch);
      return found
        ? text(JSON.stringify(found, null, 2))
        : text(`No worktree registered for '${branch}'.`, true);
    },
  );

  server.registerTool(
    "steckling_new",
    {
      title: "New worktree",
      description: "Create a git worktree for a branch and allocate its service ports. With up=true, also bring services up (without running the app).",
      inputSchema: {
        branch: z.string().describe("New branch name"),
        base: z.string().optional().describe("Base branch (defaults to config)"),
        up: z.boolean().optional().describe("Also bring services up after creating"),
      },
    },
    async ({ branch, base, up: doUp }) => {
      const { code, output } = await captureConsole(() =>
        newWorktree(branch, base, { up: Boolean(doUp), noRun: true }),
      );
      return text(output || "(done)", code !== 0);
    },
  );

  server.registerTool(
    "steckling_up",
    {
      title: "Bring services up",
      description: "Start a branch's service stack (provision on first boot). Does not run the app foreground.",
      inputSchema: { branch: z.string().describe("Branch name") },
    },
    async ({ branch }) => {
      const path = worktreePath(branch);
      if (!path) return text(`No worktree registered for '${branch}'. Use steckling_new first.`, true);
      const { code, output } = await captureConsole(() => up({ noRun: true, reprovision: false, cwd: path }));
      return text(output, code !== 0);
    },
  );

  server.registerTool(
    "steckling_down",
    {
      title: "Stop services",
      description: "Stop a branch's containers, keeping its data/volumes.",
      inputSchema: { branch: z.string().describe("Branch name") },
    },
    async ({ branch }) => {
      const path = worktreePath(branch);
      if (!path) return text(`No worktree registered for '${branch}'.`, true);
      const { code, output } = await captureConsole(() => down(path));
      return text(output, code !== 0);
    },
  );

  return server;
}

export async function startMcp(): Promise<number> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return new Promise<number>((resolve) => {
    transport.onclose = () => resolve(0);
  });
}
