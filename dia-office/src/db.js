import "dotenv/config";
import pg from "pg";
import { readFileSync } from "node:fs";
import { AGENTS } from "./agents.js";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0];

export async function migrate() {
  const dim = parseInt(process.env.EMBED_DIM || "768", 10);
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8").replace("{{EMBED_DIM}}", dim);
  await pool.query(sql);
  for (const a of AGENTS) {
    await q(
      `INSERT INTO agents (id,name,role,dept,kind,monthly_cost,look) VALUES ($1,$2,$3,$4,'ai',$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.name, a.role, a.dept, a.cost, a.look]
    );
  }
}
