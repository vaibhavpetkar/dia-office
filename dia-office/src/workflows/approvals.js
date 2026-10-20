// Human-in-the-loop: Dia never hires or takes a project without a person's decision.
import { one } from "../db.js";
import { broadcast, log, status } from "../events.js";

const handlers = {}; // kind -> async (approval, approved) => void
export const onDecision = (kind, fn) => (handlers[kind] = fn);

export async function requestApproval(kind, refId, title, body) {
  const a = await one("INSERT INTO approvals (kind,ref_id,title,body) VALUES ($1,$2,$3,$4) RETURNING *", [kind, refId, title, body]);
  await status("dia", "Waiting for your decision", false);
  broadcast({ type: "approval", item: a });
  return a;
}

export async function decide(id, approved) {
  const a = await one(
    "UPDATE approvals SET status=$2, decided_at=now() WHERE id=$1 AND status='pending' RETURNING *",
    [id, approved ? "approved" : "rejected"]);
  if (!a) throw Object.assign(new Error("This decision was already made or does not exist."), { status: 409 });
  broadcast({ type: "approval_done", id: a.id, status: a.status });
  await log("dia", `${approved ? "Approved" : "Rejected"} by you: ${a.title}`);
  await status("dia", approved ? "Thank you! Passing it on." : "Okay, I'll close this one.", false);
  handlers[a.kind]?.(a, approved).catch(e => log("dia", `hit a problem continuing "${a.title}": ${e.message}`, null, false));
  return a;
}
