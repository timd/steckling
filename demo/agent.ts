/**
 * Steckling demo agent — a tiny long-running Claude agent.
 *
 * It "beats" on an interval: each beat asks Claude for a one-line status and
 * logs it. The smallest thing that proves the deploy loop end to end
 * (build → Railway service → real Claude call), and the seed you grow into
 * something useful (a scheduled repo-digest, a webhook responder, …).
 *
 * Local:  ANTHROPIC_API_KEY=sk-... bun run agent.ts
 * Cloud:  steck deploy   (ships it to Railway as an always-on service)
 */
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
const intervalMs = Number(process.env.HEARTBEAT_MS ?? 60_000);

async function beat(): Promise<void> {
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 128,
    messages: [
      {
        role: "user",
        content:
          "You are a cloud agent that just woke up for a heartbeat. Reply with ONE short, upbeat status line. Vary it each time.",
      },
    ],
  });
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  console.log(`[${new Date().toISOString()}] ${text?.text ?? "(no text)"}`);
}

console.log(`steckling demo agent online — beating every ${intervalMs}ms`);
await beat();
setInterval(() => void beat().catch((e: unknown) => console.error("beat failed:", e)), intervalMs);
