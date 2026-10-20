// Client support: a ticket comes in, Kavya reads company knowledge and drafts a reply,
// and the director approves it before anything is emailed to the client.
import { q, one } from "../db.js";
import { ask } from "../llm.js";
import { search } from "../kb.js";
import { COMPANY } from "../agents.js";
import { status, idle, log, handoff, refresh, problem } from "../events.js";
import { requestApproval, onDecision } from "./approvals.js";
import { sendMail } from "../mail.js";

const err = (status, message) => Object.assign(new Error(message), { status });

export async function newTicket(input) {
  const project = input.project_id ? await one("SELECT id FROM projects WHERE id=$1", [input.project_id]) : null;
  const t = await one(`INSERT INTO tickets (project_id, customer, email, subject, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [project?.id || null, String(input.customer).slice(0, 200), input.email || null, String(input.subject).slice(0, 300), String(input.message).slice(0, 8000)]);
  refresh("stats");
  triage(t).catch(e => problem(`could not answer ticket #${t.id} from ${t.customer}`, e));
  return t;
}

export async function triage(t) {
  await status("kavya", `Reading ticket #${t.id} from ${t.customer}`);
  const docs = await search(`${t.subject} ${t.message}`, 3).catch(() => []);
  const kb = docs.length ? docs.map(d => `### ${d.title}\n${d.content}`).join("\n\n") : "No company documents found.";
  const r = await ask({
    agent: "kavya", tier: "fast", maxTokens: 900, need: ["category", "priority", "reply"],
    system: COMPANY() + " You are Kavya, client support. Answer only from company knowledge and what the client wrote. " +
      "If you don't know, say a person will follow up; never promise dates, refunds or discounts.",
    prompt: `Company knowledge:\n${kb}\n\nTicket from ${t.customer}:\nSubject: ${t.subject}\n${t.message}\n\n` +
      `Return {"category":"bug"|"question"|"change_request"|"billing"|"other","priority":"high"|"normal"|"low",` +
      `"summary":"one line","reply":"the email reply, friendly, under 120 words, signed Kavya","needs_engineer":true|false}`,
    mock: () => {
      const m = `${t.subject} ${t.message}`.toLowerCase();
      const category = /bug|error|crash|not working|broken|down/.test(m) ? "bug" : /invoice|bill|payment|gst|refund/.test(m) ? "billing"
        : /change|add|new feature|modify/.test(m) ? "change_request" : "question";
      const priority = /urgent|asap|down|crash|cannot|can't/.test(m) ? "high" : "normal";
      const fromKb = docs[0] ? ` From our ${docs[0].title}: ${docs[0].content.slice(0, 160)}` : "";
      return { category, priority, summary: `${t.customer}: ${t.subject}`, needs_engineer: category === "bug",
        reply: `Hello ${t.customer},\n\nThank you for writing to us about "${t.subject}". ${category === "bug" ? "I've passed this to our engineering team and they are looking into it now." :
          category === "billing" ? "Our accounts team will check this and confirm." : "Here is what I can tell you."}${fromKb}\n\nWe'll update you shortly.\n\nRegards,\nKavya, Client Support` };
    }
  });
  const reply = { ...r, sources: docs.map(d => d.title) };
  await q("UPDATE tickets SET category=$2, priority=$3, reply=$4, status='awaiting_approval' WHERE id=$1", [t.id, r.category, r.priority, reply]);
  await log("kavya", `drafted a reply to ${t.customer} about "${t.subject}" (${r.category}, ${r.priority} priority).`, { reply: r.reply });
  await idle("kavya");
  if (r.needs_engineer) await handoff("kavya", "tara", `#${t.id}`);
  await handoff("kavya", "dia", "Reply");
  await requestApproval("ticket_reply", t.id, `Send Kavya's reply to ${t.customer}?`, {
    customer: t.customer, email: t.email, subject: t.subject, message: t.message,
    category: r.category, priority: r.priority, reply: r.reply, sources: reply.sources });
  refresh("records");
}

onDecision("ticket_reply", async (a, approved) => {
  const t = await one("SELECT * FROM tickets WHERE id=$1", [a.ref_id]);
  if (!t) return;
  if (!approved) {
    await q("UPDATE tickets SET status='needs_you' WHERE id=$1", [t.id]);
    return log("kavya", `will leave ticket #${t.id} from ${t.customer} for you to answer yourself.`, null, false);
  }
  await sendMail("kavya", t.email, `Re: ${t.subject}`, t.reply?.reply || a.body.reply);
  await q("UPDATE tickets SET status='answered', answered_at=now() WHERE id=$1", [t.id]);
  refresh("records");
});

export async function closeTicket(id) {
  const t = await one("UPDATE tickets SET status='closed' WHERE id=$1 AND status <> 'closed' RETURNING *", [id]);
  if (!t) throw err(404, "Ticket not found or already closed.");
  await log("kavya", `closed ticket #${t.id} from ${t.customer}.`, null, false);
  refresh("records");
  return t;
}
