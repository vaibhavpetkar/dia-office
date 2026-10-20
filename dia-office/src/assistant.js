// Talk to Dia. She answers from the live office data and can suggest an action,
// which the page shows as a button: nothing changes until the director presses it.
import { q, one } from "./db.js";
import { ask } from "./llm.js";
import { context } from "./kb.js";
import { COMPANY } from "./agents.js";
import { STAGES } from "./workflows/engineering.js";

const inr = n => (n ? "₹" + Number(n).toLocaleString("en-IN") : "no budget given");

async function snapshot() {
  const [stats, approvals, projects, activity, leads] = await Promise.all([
    one(`SELECT (SELECT count(*) FROM leads)::int AS leads, (SELECT count(*) FROM leads WHERE temperature='hot')::int AS hot,
      (SELECT count(*) FROM projects)::int AS projects, (SELECT count(*) FROM projects WHERE stage IN ('Live','Promoted'))::int AS live,
      (SELECT count(*) FROM agents WHERE id <> 'dia')::int AS team, (SELECT COALESCE(sum(value),0) FROM projects)::bigint AS revenue`),
    q("SELECT id, kind, title, body FROM approvals WHERE status='pending' ORDER BY created_at"),
    q("SELECT id, company, need, stage, value FROM projects ORDER BY created_at DESC LIMIT 8"),
    q("SELECT a.text, g.name FROM activity a LEFT JOIN agents g ON g.id = a.agent_id ORDER BY a.created_at DESC LIMIT 8"),
    q("SELECT company, temperature, score, status FROM leads ORDER BY created_at DESC LIMIT 8")
  ]);
  return { stats, approvals: approvals.rows, projects: projects.rows, activity: activity.rows, leads: leads.rows };
}

// Turn what the AI suggested into a request the page can send, or nothing if it isn't allowed.
function toAction(a, snap) {
  if (!a || typeof a !== "object") return null;
  const ap = snap.approvals.find(x => x.id === Number(a.id));
  if ((a.type === "approve" || a.type === "reject") && ap)
    return { label: `${a.type === "approve" ? (ap.kind === "hire" ? "Hire" : "Approve") : "Decline"}: ${ap.title}`,
      method: "POST", path: `/api/approvals/${ap.id}`, body: { decision: a.type === "approve" ? "approve" : "reject" } };
  const p = snap.projects.find(x => x.id === Number(a.project_id));
  if (a.type === "stage" && p && STAGES.includes(a.stage))
    return { label: `Move ${p.company} to ${a.stage}`, method: "POST", path: `/api/projects/${p.id}/stage`, body: { stage: a.stage } };
  if (a.type === "lead" && a.company && a.need)
    return { label: `Give Kabir the lead: ${a.company}`, method: "POST", path: "/api/leads",
      body: { company: String(a.company), need: String(a.need), budget: Number(a.budget) || null, email: a.email || null, contact: a.contact || null, source: "Dia chat" } };
  if (a.type === "candidate" && a.name && a.role && ["hr", "sales", "eng", "mkt"].includes(a.dept))
    return { label: `Give Asha the candidate: ${a.name}`, method: "POST", path: "/api/candidates",
      body: { name: String(a.name), role: String(a.role), dept: a.dept, kind: a.kind === "ai" ? "ai" : "human", email: a.email || null, monthly_cost: Number(a.monthly_cost) || 0 } };
  if (a.type === "doc" && a.title && a.content)
    return { label: `Save "${a.title}" to company knowledge`, method: "POST", path: "/api/kb", body: { title: String(a.title), content: String(a.content) } };
  if (a.type === "selfcheck") return { label: "Run my self-check and fix what I can", method: "POST", path: "/api/dia/selfcheck", body: {} };
  return null;
}

// Free test mode: understand the common questions without any AI.
function mockReply(msg, snap) {
  const m = msg.toLowerCase(), s = snap.stats;
  const ap = snap.approvals;
  if (/^(hi|hello|hey|namaste|namaskar)\b/.test(m) || /how are you/.test(m))
    return { reply: `Namaskar! I'm Dia. The office is running: ${s.team} people on the team, ${s.leads} leads, ${ap.length} decision${ap.length === 1 ? "" : "s"} waiting for you. What would you like to do?` };
  if (/approv|decision|waiting|pending/.test(m)) {
    if (!ap.length) return { reply: "Nothing is waiting for you right now. I'll ask here before any hire or new project." };
    const first = ap[0];
    return { reply: `${ap.length} decision${ap.length > 1 ? "s are" : " is"} waiting. First: ${first.title} ${first.body?.reason || first.body?.summary || ""}`.trim(),
      action: { type: "approve", id: first.id } };
  }
  if (/project/.test(m)) {
    if (!snap.projects.length) return { reply: "No projects yet. Approve a hot lead and Sameer will create the sale order and work order." };
    return { reply: "Projects: " + snap.projects.map(p => `${p.company} is ${p.stage} (${inr(p.value)})`).join("; ") + "." };
  }
  if (/lead|sales|client/.test(m)) {
    const add = msg.match(/(?:add|new) lead[:\s]+(.+?)\s+(?:needs|wants)\s+(.+)/i);
    if (add) return { reply: `I'll hand ${add[1]} to Kabir. Press the button to confirm.`, action: { type: "lead", company: add[1], need: add[2] } };
    if (!snap.leads.length) return { reply: 'No leads yet. Tell me "add lead Acme needs an online store" and I\'ll pass it to Kabir.' };
    return { reply: `${s.leads} leads, ${s.hot} hot. Latest: ` + snap.leads.slice(0, 4).map(l => `${l.company} (${l.temperature || "being analysed"})`).join(", ") + "." };
  }
  if (/fix|repair|problem|error|broken|health|check|stuck/.test(m))
    return { reply: "I can check myself: the database, the AI, the budget, and any work that stopped half-way. Shall I run it and restart anything stuck?", action: { type: "selfcheck" } };
  if (/who are you|your name|what can you/.test(m) || /help/.test(m))
    return { reply: "I'm Dia, I run Inveon's virtual office. Ask me about decisions waiting, leads, projects or the team, tell me \"add lead <company> needs <what>\", or ask me to check and fix myself." };
  if (/team|hire|staff|people|candidate/.test(m))
    return { reply: `The team has ${s.team} members. To hire, press + New candidate, or pick "AI agent" and Asha will interview automatically.` };
  if (/revenue|money|sales value|earn/.test(m))
    return { reply: `Won project value so far is ${inr(s.revenue)} across ${s.projects} project${s.projects === 1 ? "" : "s"}, ${s.live} live.` };
  return { reply: "In free test mode I understand questions about decisions, leads, projects, the team, revenue and my own health. Set LLM_PROVIDER to ollama or bedrock and I can talk about anything." };
}

export async function chat(message, history = []) {
  const snap = await snapshot();
  let out;
  if ((process.env.LLM_PROVIDER || "mock") === "mock") out = mockReply(message, snap);
  else {
    const kb = await context(message, 3);
    out = await ask({
      agent: "dia", tier: "fast", maxTokens: 700,
      system: COMPANY() + ` You are Dia, the warm, cheerful owner-assistant who runs this virtual office. ` +
        `You talk to the human director. Answer in 1-3 short spoken sentences, friendly and specific, using the office data. ` +
        `You may suggest ONE action for the director to confirm. Never claim an action is done; say you've prepared it.`,
      prompt: `Office data:\n${JSON.stringify(snap)}\n\nCompany knowledge:\n${kb}\n\n` +
        `Conversation so far:\n${history.slice(-8).map(h => `${h.role}: ${h.text}`).join("\n")}\n\nDirector: ${message}\n\n` +
        `Return {"reply":"...","action":null | {"type":"approve"|"reject","id":number} | {"type":"stage","project_id":number,"stage":"${STAGES.join("|")}"} | ` +
        `{"type":"lead","company":"...","need":"...","budget":number} | {"type":"candidate","name":"...","role":"...","dept":"hr|sales|eng|mkt","kind":"human|ai"} | ` +
        `{"type":"doc","title":"...","content":"..."} | {"type":"selfcheck"}}`,
      mock: () => mockReply(message, snap)
    });
  }
  return { reply: String(out.reply || "Sorry, I lost my words there. Could you ask again?"), action: toAction(out.action, snap) };
}
