/**
 * MCP smoke test: spawns `steck mcp` and drives it as a real MCP client —
 * lists tools, reads the registry resource, then exercises status/down/up.
 *
 * Assumes the `main` worktree is registered (run `steck up` in demo/ first).
 * Run from engine/: bun run test/mcp-smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentBranch } from "../src/git";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "src", "cli.ts");
const demo = join(here, "..", "..", "demo");
const branch = (await currentBranch(demo)) ?? "main";

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

const transport = new StdioClientTransport({
  command: process.execPath, // bun
  args: [cli, "mcp"],
  cwd: demo,
  env,
});
const client = new Client({ name: "steckling-smoke", version: "0.0.0" });
await client.connect(transport);

let failures = 0;
function check(label: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? `  ${extra}` : ""}`);
  if (!ok) failures++;
}
const textOf = (r: { content?: unknown }): string => {
  const first = (r.content as Array<{ type: string; text?: string }> | undefined)?.[0];
  return first?.text ?? "";
};

const EXPECTED_TOOLS = ["steckling_down", "steckling_list", "steckling_new", "steckling_status", "steckling_up"];
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
check(
  "tools/list exposes the expected tools",
  EXPECTED_TOOLS.every((t) => tools.includes(t)) && tools.length === EXPECTED_TOOLS.length,
  tools.join(","),
);

const resource = await client.readResource({ uri: "steckling://registry" });
const regText = String(resource.contents?.[0]?.text ?? "");
check(`resource steckling://registry includes ${branch}`, regText.includes(`"branch": "${branch}"`));

const st = textOf(await client.callTool({ name: "steckling_status", arguments: { branch } }));
check(`steckling_status ${branch}`, st.includes(`"branch": "${branch}"`), st.split("\n").find((l) => l.includes("status")) ?? "");

const dn = await client.callTool({ name: "steckling_down", arguments: { branch } });
check(`steckling_down ${branch}`, dn.isError !== true, textOf(dn).split("\n").pop() ?? "");

const up = await client.callTool({ name: "steckling_up", arguments: { branch } });
check(`steckling_up ${branch}`, up.isError !== true, textOf(up).split("\n").pop() ?? "");

await client.close();
console.log(failures === 0 ? "\nALL MCP CHECKS PASSED" : `\n${failures} MCP CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
