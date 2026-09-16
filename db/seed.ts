import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./client";
import { embed, EMBEDDING_VERSION } from "../lib/rag";
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ""; }
    else if (c === '\n' && !quoted) { row.push(field.replace(/\r$/, "")); if(row.some(Boolean)) rows.push(row); row=[]; field=""; }
    else field += c;
  }
  if(quoted) throw new Error("Unclosed CSV quote");
  row.push(field.replace(/\r$/, "")); if(row.some(Boolean)) rows.push(row);
  return rows;
}
async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(742002)");
    for (const [table, primary] of [["fleet_catalog","vehicle_id"],["customer_profiles","customer_id"],["booking_logs","booking_id"],["seasonal_pricing_matrix",""]]) {
      const [headers,...rows] = parseCsv(await fs.readFile(path.join("data",table+".csv"),"utf8"));
      const columns = headers.map(h => h === primary ? "id" : h);
      if(columns.some(c => !/^[a-z_]+$/.test(c))) throw new Error("Invalid CSV column");
      for(const row of rows) {
        if(row.length !== columns.length) throw new Error("Malformed CSV row");
        await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_,i)=>"$"+(i+1)).join(",")}) ON CONFLICT DO NOTHING`,row.map(v=>v===""?null:v));
      }
    }
    for(const content of (await fs.readFile("data/rental_policies.md","utf8")).split(/\n(?=##? )/).map(s=>s.trim()).filter(Boolean)) {
      await client.query("INSERT INTO rental_policies_vectors(content,source,embedding) VALUES ($1,$2,$3::vector) ON CONFLICT DO NOTHING",[content,`rental_policies.md#${EMBEDDING_VERSION}`,JSON.stringify(embed(content))]);
    }
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally {client.release();}
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>pool.end());
