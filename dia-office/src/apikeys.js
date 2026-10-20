// Keys for the phone and desktop apps. The director makes one per device and can switch it off any time.
// Only a SHA-256 hash is kept, so a key is shown once when it is made.
import { createHash, randomBytes } from "node:crypto";
import { q, one } from "./db.js";

const hash = key => createHash("sha256").update(key).digest("hex");

export async function createKey(name) {
  const key = "dia_" + randomBytes(24).toString("base64url");
  const row = await one("INSERT INTO api_keys (name, prefix, hash) VALUES ($1,$2,$3) RETURNING id, name, prefix, created_at",
    [String(name || "App").slice(0, 80), key.slice(0, 8), hash(key)]);
  return { ...row, key };
}

export const listKeys = async () => (await q(
  "SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY revoked_at NULLS FIRST, created_at DESC")).rows;

export async function revokeKey(id) {
  const row = await one("UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id", [id]);
  if (!row) throw Object.assign(new Error("No active key with that id."), { status: 404 });
  return row;
}

// Returns the key's row when it is valid, otherwise null.
export async function checkKey(key) {
  if (!/^dia_[A-Za-z0-9_-]{32}$/.test(key || "")) return null;
  const row = await one("SELECT id, name FROM api_keys WHERE hash=$1 AND revoked_at IS NULL", [hash(key)]);
  if (row) q("UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [row.id]).catch(() => {});
  return row;
}
