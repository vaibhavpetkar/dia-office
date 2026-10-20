// Talk to Dia. She answers from the live office data and can suggest an action,
// which the page shows as a button: nothing changes until the director presses it.
import { q, one } from "./db.js";
import { ask } from "./llm.js";
import { context } from "./kb.js";
import { COMPANY, DEPTS } from "./agents.js";
import { STAGES } from "./workflows/engineering.js";
import { profitAndLoss } from "./workflows/finance.js";

const inr = n => (n ? "₹" + Number(n).toLocaleString("en-IN") : "no budget given");

async function snapshot() {
  const [stats, approvals, projects, activity, leads, tickets, invoices, money, tests] = await Promise.all([
    one(`SELECT (SELECT count(*) FROM leads)::int AS leads, (SELECT count(*) FROM leads WHERE temperature='hot')::int AS hot,
      (SELECT count(*) FROM projects)::int AS projects, (SELECT count(*) FROM projects WHERE stage IN ('Live','Promoted'))::int AS live,
      (SELECT count(*) FROM agents WHERE id <> 'dia')::int AS team, (SELECT COALESCE(sum(value),0) FROM projects)::bigint AS revenue`),
    q("SELECT id, kind, title, body FROM approvals WHERE status='pending' ORDER BY created_at"),
    q("SELECT id, company, need, stage, value FROM projects ORDER BY created_at DESC LIMIT 8"),
    q("SELECT a.text, g.name FROM activity a LEFT JOIN agents g ON g.id = a.agent_id ORDER BY a.created_at DESC LIMIT 8"),
    q("SELECT company, temperature, score, status FROM leads ORDER BY created_at DESC LIMIT 8"),
    q("SELECT id, customer, subject, category, priority, status FROM tickets WHERE status <> 'closed' ORDER BY created_at DESC LIMIT 8"),
    q("SELECT id, number, company, label, total, status, due_date FROM invoices WHERE status IN ('draft','sent') ORDER BY id DESC LIMIT 8"),
    profitAndLoss(),
    q(`SELECT r.id, r.project_id, p.company, r.url, r.status, r.verdict, jsonb_array_length(r.bugs) AS bugs FROM test_runs r
       JOIN projects p ON p.id = r.project_id ORDER BY r.id DESC LIMIT 6`)
  ]);
  return { stats, approvals: approvals.rows, projects: projects.rows, activity: activity.rows, leads: leads.rows,
    tickets: tickets.rows, invoices: invoices.rows, money, tests: tests.rows };
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
  if (a.type === "qa" && p && p.stage === "Testing")
    return { label: `Ask QA to test ${p.company}${a.url ? ` at ${a.url}` : ""}`, method: "POST", path: `/api/projects/${p.id}/qa`, body: a.url ? { url: String(a.url) } : {} };
  if (a.type === "lead" && a.company && a.need)
    return { label: `Give Kabir the lead: ${a.company}`, method: "POST", path: "/api/leads",
      body: { company: String(a.company), need: String(a.need), budget: Number(a.budget) || null, email: a.email || null, contact: a.contact || null, source: "Dia chat" } };
  if (a.type === "candidate" && a.name && a.role && DEPTS.includes(a.dept))
    return { label: `Give Asha the candidate: ${a.name}`, method: "POST", path: "/api/candidates",
      body: { name: String(a.name), role: String(a.role), dept: a.dept, kind: a.kind === "ai" ? "ai" : "human", email: a.email || null, monthly_cost: Number(a.monthly_cost) || 0 } };
  if (a.type === "doc" && a.title && a.content)
    return { label: `Save "${a.title}" to company knowledge`, method: "POST", path: "/api/kb", body: { title: String(a.title), content: String(a.content) } };
  if (a.type === "ticket" && a.customer && a.message)
    return { label: `Give Kavya the ticket from ${a.customer}`, method: "POST", path: "/api/tickets",
      body: { customer: String(a.customer), email: a.email || null, subject: String(a.subject || String(a.message).slice(0, 60)), message: String(a.message) } };
  const inv = snap.invoices.find(x => x.id === Number(a.invoice_id));
  if (a.type === "paid" && inv && inv.status === "sent")
    return { label: `Mark ${inv.number} as paid`, method: "POST", path: `/api/invoices/${inv.id}/paid`, body: {} };
  if (a.type === "repair") return { label: "Draft a code fix for my latest error", method: "POST", path: "/api/dia/repair", body: {} };
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
  const ticket = msg.match(/(?:ticket|complaint|issue) from\s+(.+?)[:\-–]\s*(.+)/i);
  if (ticket) return { reply: `I'll give ${ticket[1]}'s ticket to Kavya. She'll draft a reply for you to approve.`,
    action: { type: "ticket", customer: ticket[1].trim(), message: ticket[2].trim() } };
  const paid = msg.match(/(INV-\d+).*paid|paid.*(INV-\d+)/i);
  if (paid) {
    const no = (paid[1] || paid[2]).toUpperCase(), inv = snap.invoices.find(i => i.number === no);
    if (!inv) return { reply: `I can't find a sent invoice called ${no}.` };
    if (inv.status !== "sent") return { reply: `${no} hasn't been sent yet. Approve it in your decisions first.` };
    return { reply: `${inv.company} paid ${no}? Press the button and Arjun will record ${inr(inv.total)}.`, action: { type: "paid", invoice_id: inv.id } };
  }
  if (/ticket|support|complain/.test(m)) {
    const open = snap.tickets.filter(t => !["answered", "closed"].includes(t.status));
    if (!snap.tickets.length) return { reply: 'No support tickets. Tell me "ticket from Acme: the login page is slow" and Kavya will handle it.' };
    return { reply: `${open.length} open ticket${open.length === 1 ? "" : "s"}. ` + snap.tickets.slice(0, 3).map(t => `${t.customer}: ${t.subject} (${t.status.replace(/_/g, " ")})`).join("; ") + "." };
  }
  if (/invoice|profit|loss|p&l|finance|account|cash|paid|money|revenue|earn/.test(m)) {
    const f = snap.money;
    return { reply: `This month we received ${inr(f.received)} and spent about ${inr(f.costs)} on the team and AI, so profit is ${f.profit < 0 ? "minus " : ""}${inr(Math.abs(f.profit))}. ` +
      `${inr(f.outstanding)} is still to be collected${f.overdue ? `, ${inr(f.overdue)} of it overdue` : ""}.` };
  }
  if (/\b(test|tests|testing|qa|tester|bugs?)\b/.test(m) && !/fix|repair/.test(m)) {
    const url = msg.match(/https?:\/\/\S+/)?.[0], inTest = snap.projects.find(p => p.stage === "Testing" && m.includes(p.company.toLowerCase())) || snap.projects.find(p => p.stage === "Testing");
    if (inTest && (url || /run|start|again|re-?test|check/.test(m)))
      return { reply: `I'll ask Sneha and Aditya to test ${inTest.company}${url ? ` at ${url}` : ""}. Sneha runs the automated checks and Aditya prepares the hands-on checklist.`,
        action: { type: "qa", project_id: inTest.id, url } };
    if (!snap.tests.length) return { reply: "QA hasn't tested anything yet. When Tara marks a project as Testing, Sneha and Aditya pick it up. Give me a preview link and I'll ask them to run the checks." };
    return { reply: "Latest tests: " + snap.tests.slice(0, 3).map(t => `${t.company} ${t.status.replace(/_/g, " ")}, ${t.bugs} bug${t.bugs === 1 ? "" : "s"}`).join("; ") + "." };
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
  if (/(fix|repair).*(code|bug)|code fix|bug/.test(m))
    return { reply: "I can look at my latest error, find the line in my code and draft a fix. You approve it before anything changes, and then I open a pull request.", action: { type: "repair" } };
  if (/fix|repair|problem|error|broken|health|check|stuck/.test(m))
    return { reply: "I can check myself: the database, the AI, the budget, and any work that stopped half-way. Shall I run it and restart anything stuck?", action: { type: "selfcheck" } };
  if (/who are you|your name|what can you/.test(m) || /help/.test(m))
    return { reply: "I'm Dia, I run Inveon's virtual office. Ask me about decisions, leads, projects, tests, tickets, invoices or profit. Give me several jobs at once, separated by \"then\" or \";\", and I'll line them up for you." };
  if (/team|hire|staff|people|candidate/.test(m))
    return { reply: `The team has ${s.team} members. To hire, press + New candidate, or pick "AI agent" and Asha will interview automatically.` };
  if (/how.*(office|doing|going)|status|summary|update|report/.test(m)) {
    const open = snap.tickets.filter(t => !["answered", "closed"].includes(t.status)).length;
    return { reply: `Here's today: ${s.leads} leads (${s.hot} hot), ${s.projects} project${s.projects === 1 ? "" : "s"} with ${s.live} live, ${open} open support ticket${open === 1 ? "" : "s"}, ` +
      `${inr(snap.money.received)} received this month, and ${ap.length} decision${ap.length === 1 ? "" : "s"} waiting for you.` };
  }
  return { reply: "In free test mode I understand decisions, leads, projects, tickets, invoices, profit, the team and my own health. Set LLM_PROVIDER to ollama or bedrock and I can talk about anything." };
}

// A goal with several jobs ("add lead X needs Y; ticket from Z: ... then check yourself") becomes several actions.
function mockGoal(msg, snap) {
  const parts = msg.split(/\s*(?:;|\n|,?\s+(?:and )?then\s+|,?\s+and also\s+)\s*/i).filter(p => p.trim().length > 2);
  if (parts.length < 2) return mockReply(msg, snap);
  const outs = parts.slice(0, 5).map(p => mockReply(p, snap)), actions = outs.map(o => o.action).filter(Boolean);
  if (actions.length < 2) return mockReply(msg, snap);
  return { reply: `I've lined up ${actions.length} jobs for the team. Press each one, or "Do all" and I'll hand them out in order.`, actions };
}

const LANG_NAME = { en: "English (Indian English)", hi: "Hindi, in Devanagari script", mr: "Marathi, in Devanagari script" };
// Free test mode has no AI to translate, so only the greeting is in Hindi and Marathi; the rest stays English.
const MOCK_HELLO = {
  hi: (s, n) => `नमस्ते! मैं दिया हूँ। ऑफिस चल रहा है: टीम में ${s.team} लोग, ${s.leads} लीड, और ${n} फ़ैसले आपका इंतज़ार कर रहे हैं। बताइए, क्या करें?`,
  mr: (s, n) => `नमस्कार! मी दिया. ऑफिस सुरू आहे: टीममध्ये ${s.team} जण, ${s.leads} लीड, आणि ${n} निर्णय तुमची वाट पाहत आहेत. सांगा, काय करूया?`
};

export async function chat(message, history = [], lang = "en") {
  const snap = await snapshot();
  let out;
  if ((process.env.LLM_PROVIDER || "mock") === "mock") {
    out = mockGoal(message, snap);
    if (MOCK_HELLO[lang] && /^(hi|hello|hey|namaste|namaskar|नमस्|हॅलो)/i.test(message.trim())) out.reply = MOCK_HELLO[lang](snap.stats, snap.approvals.length);
  }
  else {
    const kb = await context(message, 3);
    out = await ask({
      agent: "dia", tier: "fast", maxTokens: 700, need: ["reply"],
      system: COMPANY() + ` You are Dia, the warm, cheerful owner-assistant who runs this virtual office. ` +
        `You talk to the human director. Answer in 1-3 short spoken sentences, friendly and specific, using the office data. ` +
        `Reply in ${LANG_NAME[lang] || LANG_NAME.en}, the way a warm, educated person from Pune speaks it; keep company names and numbers as they are. ` +
        `You may suggest actions for the director to confirm: one, or up to 5 when they give you a bigger goal (split it into jobs for the right team). ` +
        `Never claim an action is done; say you've prepared it.`,
      prompt: `Office data:\n${JSON.stringify(snap)}\n\nCompany knowledge:\n${kb}\n\n` +
        `Conversation so far:\n${history.slice(-8).map(h => `${h.role}: ${h.text}`).join("\n")}\n\nDirector: ${message}\n\n` +
        `Return {"reply":"...","actions":[] of up to 5 actions, each one of: {"type":"approve"|"reject","id":number} | {"type":"stage","project_id":number,"stage":"${STAGES.join("|")}"} | ` +
        `{"type":"qa","project_id":number,"url":"preview URL or omit"} | {"type":"lead","company":"...","need":"...","budget":number} | {"type":"candidate","name":"...","role":"...","dept":"${DEPTS.join("|")}","kind":"human|ai"} | ` +
        `{"type":"ticket","customer":"...","subject":"...","message":"..."} | {"type":"paid","invoice_id":number} | ` +
        `{"type":"doc","title":"...","content":"..."} | {"type":"selfcheck"} | {"type":"repair"}}`,
      mock: () => mockGoal(message, snap)
    });
  }
  const actions = [...(Array.isArray(out.actions) ? out.actions : []), ...(out.action ? [out.action] : [])]
    .slice(0, 5).map(a => toAction(a, snap)).filter(Boolean);
  // `action` stays for older pages; new pages read `actions`.
  return { reply: String(out.reply || "Sorry, I lost my words there. Could you ask again?"), action: actions[0] || null, actions };
}
