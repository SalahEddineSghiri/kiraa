import { createHash } from "node:crypto";
import { pool } from "../../db/client";
// Local lexical vectors, not semantic embeddings. Same algorithm for seed and query.
export const EMBEDDING_VERSION = "lexical-hash-v1";
export function embed(text: string): number[] {
  const vector = Array<number>(1536).fill(0);
  const words = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g) ?? [];
  for (const word of words) vector[createHash("sha256").update(word).digest().readUInt32BE(0) % vector.length] += 1;
  const norm = Math.sqrt(vector.reduce((n, v) => n + v * v, 0));
  return norm ? vector.map(v => v / norm) : vector;
}
export async function retrievePolicies(query: string) {
  const vector = embed(query);
  if (!vector.some(Boolean)) return [];
  const { rows } = await pool.query<{content: string; source: string; score: number}>(
    "SELECT content, source, 1 - (embedding <=> $1::vector) AS score FROM rental_policies_vectors WHERE source = $2 ORDER BY (embedding <=> $1::vector) + 0 LIMIT 3",
    [JSON.stringify(vector), `rental_policies.md#${EMBEDDING_VERSION}`],
  );
  return rows.filter(row => Number(row.score) >= 0.12).map(row => ({ ...row, score: Number(row.score) }));
}
