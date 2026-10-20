import dotenv from "dotenv";
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { AGENTS } from "./agents.js";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH });

// sslmode=require in the URL makes pg print a long security warning on every start. We take the mode out of the URL
// and ask for a verified TLS connection directly, which is what pg does today anyway (and what Neon/Supabase/RDS support).
export function connectionOptions(url = process.env.DATABASE_URL || "") {
  try {
    const u = new URL(url), mode = u.searchParams.get("sslmode");
    if (!mode || u.searchParams.has("uselibpqcompat") || !["prefer", "require", "verify-ca", "verify-full", "no-verify"].includes(mode)) return { connectionString: url };
    u.searchParams.delete("sslmode");
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: mode !== "no-verify" } };
  } catch { return { connectionString: url }; }
}

const makePool = () => {
  const p = new pg.Pool({
    ...connectionOptions(),
    // Free cloud databases sleep when idle and take a few seconds to wake; give them time instead of failing.
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || "20000", 10),
    // Close our idle connections before the provider silently drops them ("Connection terminated unexpectedly").
    idleTimeoutMillis: 20000, keepAlive: true, max: 8
  });
  // A dropped idle connection (common with free cloud databases) should not crash the office.
  p.on("error", e => console.error("Database connection dropped:", e.message));
  return p;
};
export let pool = makePool();

// Re-read .env so a DATABASE_URL fixed while the office is running is picked up without a restart.
export function reloadDatabaseUrl() {
  const before = process.env.DATABASE_URL;
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, override: true });
  if (process.env.DATABASE_URL !== before) { pool.end().catch(() => {}); pool = makePool(); }
}
// One quiet retry when the connection itself failed (database waking up, dropped socket). Query errors are not retried.
const CONN_ERR = /timeout|terminated|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|Connection ended/i;
export async function q(text, params) {
  try { return await pool.query(text, params); }
  catch (e) {
    if (!CONN_ERR.test(`${e.message} ${e.code || ""} ${e.cause?.message || ""}`)) throw e;
    await new Promise(r => setTimeout(r, 1500));
    return pool.query(text, params);
  }
}
export const one = async (text, params) => (await q(text, params)).rows[0];

// Numbered SQL files in src/migrations run once each, in order, and are recorded in schema_migrations.
// To change the database, add a new file (e.g. 004_add_x.sql); never edit one that already ran.
export async function migrate() {
  const dim = parseInt(process.env.EMBED_DIM || "768", 10);
  const dir = new URL("./migrations/", import.meta.url);
  await q("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, run_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const done = new Set((await q("SELECT name FROM schema_migrations")).rows.map(r => r.name));
  for (const name of readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(new URL(name, dir), "utf8").replaceAll("{{EMBED_DIM}}", dim);
    const c = await pool.connect();
    try {
      await c.query("BEGIN"); await c.query(sql);
      await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw Object.assign(e, { message: `Migration ${name} failed: ${e.message}` }); }
    finally { c.release(); }
  }
  for (const a of AGENTS) {
    await q(
      `INSERT INTO agents (id,name,role,dept,kind,monthly_cost,look) VALUES ($1,$2,$3,$4,'ai',$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.name, a.role, a.dept, a.cost, a.look]
    );
  }
}

// Turn a database error into a plain-English next step for the setup screen.
export function dbHint(e) {
  const where = (() => { try { return new URL(process.env.DATABASE_URL).host; } catch { return "the DATABASE_URL host"; } })();
  if (!process.env.DATABASE_URL) return "DATABASE_URL is empty. Run npm run setup, or copy .env.example to .env and fill it in.";
  if (e.code === "ECONNREFUSED") return `Nothing is listening at ${where}. Start Postgres (Docker, a local install or WSL), or point DATABASE_URL at a free cloud database such as Neon or Supabase.`;
  if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") return `The host ${where} could not be found. Check the DATABASE_URL in .env for typos.`;
  if (e.code === "28P01" || e.code === "28000") return "The database rejected the username or password in DATABASE_URL.";
  if (e.code === "3D000") return "The database named in DATABASE_URL does not exist yet. Create it, or use the one your provider gave you.";
  if (/extension "vector"/i.test(e.message)) return "This Postgres does not have the pgvector extension. Neon, Supabase and the pgvector/pgvector Docker image include it; a plain Windows install needs pgvector added separately.";
  if (/ssl|certificate|no pg_hba/i.test(e.message)) return "The database needs an encrypted connection. Add ?sslmode=require to the end of DATABASE_URL.";
  if (/timeout/i.test(e.message)) return `Connecting to ${where} timed out. Check your internet connection or firewall, and that the database is awake.`;
  return "Check DATABASE_URL in .env, then press Try again.";
}
