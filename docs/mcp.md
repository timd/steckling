# Driving Steckling from Claude (MCP)

`steck mcp` starts a stdio [MCP](https://modelcontextprotocol.io) server so an agent can
inspect and control the worktree fleet. It's a thin wrapper over the same lifecycle the CLI
uses — anything the server does, you can also do by hand.

## Register it

**Claude Code:**

```sh
claude mcp add steckling -- steck mcp
```

**Claude Desktop / Cursor / other clients** — add to the MCP servers config:

```json
{
  "mcpServers": {
    "steckling": { "command": "steckling", "args": ["mcp"] }
  }
}
```

Running from source instead of a binary? Use Bun:

```json
{
  "mcpServers": {
    "steckling": { "command": "bun", "args": ["run", "/abs/path/to/engine/src/cli.ts", "mcp"] }
  }
}
```

## What it exposes

**Resource**

| URI | Description |
| --- | --- |
| `steckling://registry` | JSON snapshot of every worktree: branch, project, live status (up/stopped/down), host ports, path, and ticket ID (when a `ticket` block is configured). |

**Tools**

| Tool | Args | Effect |
| --- | --- | --- |
| `steckling_list` | — | All worktrees with live status + ports. |
| `steckling_status` | `branch` | Status + ports for one branch. |
| `steckling_new` | `branch`, `base?`, `up?` | Create a worktree + allocate ports (optionally bring services up). |
| `steckling_up` | `branch` | Start that branch's services (provision on first boot). Does **not** run the app foreground. |
| `steckling_down` | `branch` | Stop that branch's containers, keep data. |

`steckling_up`/`steckling_down` target a branch by looking up its worktree path in the registry,
so the agent can manage any branch without changing directories.

With a `ticket` block configured, each worktree's ticket ID rides along in the registry resource
and tool output — an orchestrating agent that also has your tracker's MCP server can map issues
to stacks directly ("one ticket, one branch, one stack, one agent"). See the
[ticket-trackers recipe](recipes/ticket-trackers.md).

## Notes

- The server speaks JSON-RPC over stdout; the lifecycle's normal console output is captured
  and returned as the tool result, so the protocol stream stays clean.
- Destructive operations (`rm`, `prune`) are intentionally **not** exposed as tools — keep
  data destruction a human, CLI-side decision.
- Each worktree is fully isolated (own containers, volumes, ports), so multiple agent
  sessions can work different branches in parallel without interfering.
