/** One-shot connectivity check used by the smoke test (exits, doesn't serve). */
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = new SQL(url);
const rows = await sql`SELECT name FROM widgets ORDER BY name`;
console.log(`DATABASE_URL = ${url}`);
console.log(`widgets      = ${rows.map((r: { name: string }) => r.name).join(", ")}`);
await sql.end();
