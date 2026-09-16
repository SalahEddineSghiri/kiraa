import fs from "node:fs/promises";
import path from "node:path";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "./client";
async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(742001)");
    await client.query("CREATE TABLE IF NOT EXISTS kiraa_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const name of (await fs.readdir("db/migrations")).filter(n => n.endsWith(".sql")).sort()) {
      if ((await client.query("SELECT 1 FROM kiraa_migrations WHERE name=$1", [name])).rowCount) continue;
      const sql = await fs.readFile(path.join("db/migrations", name), "utf8");
      // PostgresSaver owns checkpoint DDL, not the legacy draft migration.
      await client.query(sql.split(";").filter(s => !/CREATE TABLE IF NOT EXISTS checkpoint/.test(s)).join(";") + ";");
      await client.query("INSERT INTO kiraa_migrations(name) VALUES ($1)", [name]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const saver = PostgresSaver.fromConnString(process.env.DATABASE_URL!, {schema:"kiraa_checkpoints"});
  try { await saver.setup(); } finally { await saver.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
