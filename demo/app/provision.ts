/** Provision hook: create + seed the demo schema in this branch's database. */
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set — run via `steck up` / `steck exec`.");
  process.exit(1);
}

const sql = new SQL(url);
await sql`CREATE TABLE IF NOT EXISTS widgets (id serial PRIMARY KEY, name text NOT NULL)`;
await sql`DELETE FROM widgets`;
await sql`INSERT INTO widgets (name) VALUES ('alpha'), ('beta'), ('gamma')`;
const [{ n }] = await sql`SELECT count(*)::int AS n FROM widgets`;
console.log(`Provisioned: ${n} widgets seeded into ${url}`);
await sql.end();
