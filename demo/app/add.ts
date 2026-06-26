/** Insert a widget (used by the smoke test to prove per-branch DB isolation). */
import { SQL } from "bun";

const name = process.argv[2] ?? "extra";
const sql = new SQL(process.env.DATABASE_URL!);
await sql`INSERT INTO widgets (name) VALUES (${name})`;
const rows = await sql`SELECT name FROM widgets ORDER BY name`;
console.log(`after insert '${name}': ${rows.map((r: { name: string }) => r.name).join(", ")}`);
await sql.end();
