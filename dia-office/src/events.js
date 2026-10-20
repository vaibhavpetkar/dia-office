import { q, one } from "./db.js";

let clients = new Set();
export function attach(wss) {
  wss.on("connection", ws => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });
}
export function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(s);
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
export async function problem(text, e) {
  problems.unshift({ at: new Date().toISOString(), text, error: e?.message || String(e) });
  problems.length = Math.min(problems.length, 50);
  console.error(`${text}:`, e?.message || e);
  await log("dia", `${text}: ${e?.message || e}`, null, false).catch(() => {});
}
