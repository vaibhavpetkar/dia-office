import { q, one } from "./db.js";

let clients = new Set();
// The page sends {"type":"auth","key":"..."} after connecting; only then does it get client data.
export function attach(wss, keyMatches) {
  wss.on("connection", ws => {
    ws.director = false;
    clients.add(ws);
    ws.on("message", raw => {
      try { const m = JSON.parse(raw); if (m.type === "auth") { ws.director = keyMatches(String(m.key || "")); ws.send(JSON.stringify({ type: "auth", ok: ws.director })); } } catch {}
    });
    ws.on("close", () => clients.delete(ws));
  });
}
const PRIVATE = new Set(["activity", "approval", "approval_done"]);
export function broadcast(msg) {
  const s = JSON.stringify(msg), priv = PRIVATE.has(msg.type);
  for (const c of clients) if (c.readyState === 1 && (!priv || c.director)) c.send(s);
}

// An agent says what it is doing (shown as a speech bubble).
export async function status(agentId, text, working = true) {
  await q("UPDATE agents SET status=$2 WHERE id=$1", [agentId, text || "Idle"]);
  broadcast({ type: "agent", id: agentId, status: text || "", working });
}
export const idle = id => status(id, "", false);

// A finished piece of work: goes to the activity feed and counts as a task done.
export async function log(agentId, text, data = null, countTask = true) {
  const row = await one("INSERT INTO activity (agent_id,text,data) VALUES ($1,$2,$3) RETURNING *", [agentId, text, data]);
  if (countTask && agentId) await q("UPDATE agents SET tasks_done=tasks_done+1 WHERE id=$1", [agentId]);
  broadcast({ type: "activity", item: row });
}

// A document travelling between desks (animation only).
export function handoff(from, to, label) {
  broadcast({ type: "handoff", from, to, label });
  return new Promise(r => setTimeout(r, 1300));
}

export const refresh = what => broadcast({ type: "refresh", what });

// Problems Dia ran into while working. Her self-check reads these and reports them in chat.
export const problems = [];
let problemSeq = 0;
export async function problem(text, e) {
  problems.unshift({ id: ++problemSeq, at: new Date().toISOString(), text, error: e?.message || String(e), stack: e?.stack || null });
  problems.length = Math.min(problems.length, 50);
  console.error(`${text}:`, e?.message || e);
  await log("dia", `${text}: ${e?.message || e}`, null, false).catch(() => {});
}
