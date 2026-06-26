/** The demo "app" Steckling runs via the `run` command — a tiny HTTP server. */
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set — run via `steck up`.");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 4000);
const sql = new SQL(url);

Bun.serve({
  port,
  async fetch() {
    const widgets = await sql`SELECT id, name FROM widgets ORDER BY id`;
    return Response.json({ database: url, widgets });
  },
});

console.log(`demo app listening on http://localhost:${port}  (db: ${url})`);
