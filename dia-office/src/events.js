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
// `pub`, when given, is what people without the director key get instead (e.g. without client names).
export function broadcast(msg, pub) {
  const s = JSON.stringify(msg), p = pub && JSON.stringify(pub), priv = PRIVATE.has(msg.type);
  for (const c of clients) if (c.readyState === 1) { if (c.director) c.send(s); else if (p) c.send(p); else if (!priv) c.send(s); }
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

// Work passing from one person to another. On the 3D floor the sender gets up and walks it over.
// The last few hundred hand-overs are kept in memory for people's profiles (they start again when the office restarts).
export const handoffs = [];
export function handoff(from, to, label) {
  handoffs.unshift({ from, to, label, at: new Date().toISOString() });
  handoffs.length = Math.min(handoffs.length, 500);
  broadcast({ type: "handoff", from, to, label });
  return new Promise(r => setTimeout(r, 1300));
}

// A meeting: the people walk to the meeting room on floor 1, take turns to talk, then go back to their desks.
// It goes in each person's history; the feed gets one line from whoever called it.
export async function meeting(title, people, { by = people[0], seconds = 20 } = {}) {
  const rows = (await q("SELECT id, name FROM agents WHERE id = ANY($1)", [[...new Set(people)]])).rows;
  const ids = people.filter((id, i) => people.indexOf(id) === i && rows.some(r => r.id === id));
  if (ids.length < 2) return null;
  broadcast({ type: "meeting", title, people: ids, seconds }, { type: "meeting", title: "Team meeting", people: ids, seconds });
  const names = ids.filter(id => id !== by).map(id => rows.find(r => r.id === id).name);
  await log(by, `called a meeting "${title}" with ${names.join(", ")}.`, { meeting: { title, people: ids } }, false);
  return ids;
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
