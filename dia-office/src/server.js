import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { q, one, migrate, dbHint, reloadDatabaseUrl } from "./db.js";
import { attach, log } from "./events.js";
import { monthSpendUSD } from "./llm.js";
import { addDoc, search, listDocs } from "./kb.js";
import { decide } from "./workflows/approvals.js";
import { newLead } from "./workflows/sales.js";
import { newCandidate, getInterview, submitAnswers } from "./workflows/hiring.js";
import { setStage, STAGES } from "./workflows/engineering.js";
import { chat } from "./assistant.js";
import { selfCheck, scheduleSelfCheck } from "./selfcheck.js";
import { proposeFix } from "./repair.js";
import { DEPTS } from "./agents.js";
import { newTicket, closeTicket } from "./workflows/support.js";
import { markPaid, profitAndLoss } from "./workflows/finance.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
// fileURLToPath, not URL.pathname: pathname gives "/C:/..." on Windows and keeps %20 for spaces.
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
// three.js for the 3D office, served from node_modules so the page works offline.
app.use("/vendor/three", express.static(fileURLToPath(new URL("../node_modules/three", import.meta.url))));

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  if (!e.status || e.status >= 500) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});

// ---- Setup status: the page shows a setup screen until the database is reachable ----
const PLACEHOLDER_TOKEN = "change-me-to-a-long-random-string";
const db = { ok: false, error: null, hint: null };
async function connectDb({ reload = false } = {}) {
  if (reload) reloadDatabaseUrl();
  try {
    await migrate();
    Object.assign(db, { ok: true, error: null, hint: null });
  } catch (e) {
    Object.assign(db, { ok: false, error: e.message || String(e.code || e), hint: dbHint(e) });
    console.error(`Database not ready: ${db.error}\n  -> ${db.hint}`);
  }
  return db.ok;
}
const tokenState = () => !process.env.ADMIN_TOKEN ? "missing" : process.env.ADMIN_TOKEN === PLACEHOLDER_TOKEN ? "placeholder" : "ok";

const health = () => ({
  db, admin_token: tokenState(), provider: process.env.LLM_PROVIDER || "mock",
  ses: !!process.env.SES_FROM, platform: process.platform
});
app.get("/api/health", (_req, res) => res.json(health()));
let retrying;
app.post("/api/health/retry", async (_req, res) => {
  if (!db.ok) await (retrying ??= connectDb({ reload: true }).finally(() => (retrying = null)));
  res.status(db.ok ? 200 : 503).json({ db });
});
app.use("/api", (_req, res, next) => db.ok ? next()
  : res.status(503).json({ error: `Database not ready: ${db.hint}`, setup: true }));

// Small in-memory rate limit: `max` hits per `ms` per IP for one bucket name.
const hits = new Map();
function limited(bucket, ip, max, ms) {
  const k = `${bucket}:${ip}`, now = Date.now(), h = (hits.get(k) || []).filter(t => now - t < ms);
  h.push(now); hits.set(k, h);
  return h.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.every(t => now - t > 15 * 60 * 1000)) hits.delete(k); }, 60 * 1000).unref();

// Only the director (whoever holds ADMIN_TOKEN) can add work, make decisions or see client data.
const keyMatches = sent => {
  const want = Buffer.from(process.env.ADMIN_TOKEN || ""), got = Buffer.from(sent || "");
  return tokenState() === "ok" && want.length === got.length && timingSafeEqual(want, got);
};
export const isDirector = req => keyMatches((req.get("authorization") || "").replace(/^Bearer\s*/, "").trim());
function admin(req, res, next) {
  if (tokenState() !== "ok")
    return res.status(401).json({ error: "ADMIN_TOKEN is not set in .env yet. Run npm run setup, then restart the office." });
  if (isDirector(req)) return next();
  if (limited("badkey", req.ip, 20, 10 * 60 * 1000))
    return res.status(429).json({ error: "Too many wrong director keys. Wait 10 minutes and try again." });
  const sent = (req.get("authorization") || "").replace(/^Bearer\s*/, "").trim();
  if (!sent)
    return res.status(401).json({ error: "Enter your director key first: paste ADMIN_TOKEN from .env into the Director key box at the top of the page and press Unlock.", key: "missing" });
  return res.status(401).json({ error: "That director key doesn't match ADMIN_TOKEN in .env. Copy it again from .env. If you changed .env after starting the office, restart npm start.", key: "wrong" });
}
const need = (body, fields) => {
  const miss = fields.filter(f => !body?.[f]);
  if (miss.length) throw Object.assign(new Error(`Missing: ${miss.join(", ")}`), { status: 400 });
};

// ---- Office state ----
// Anyone who can open the page sees the floor and counts. Client data, decisions, money and the
// activity feed are only sent to the director.
app.get("/api/state", wrap(async (req, res) => {
  const director = isDirector(req), none = { rows: [] };
  const [agents, approvals, projects, activity, stats] = await Promise.all([
    q("SELECT id,name,role,dept,kind,monthly_cost,look,status,tasks_done FROM agents ORDER BY created_at"),
    director ? q("SELECT * FROM approvals WHERE status='pending' ORDER BY created_at") : none,
    director ? q("SELECT id,company,need,value,so,wo,stage,plan,marketing,created_at FROM projects ORDER BY created_at DESC LIMIT 20") : none,
    director ? q("SELECT * FROM activity ORDER BY created_at DESC LIMIT 60") : none,
    one(`SELECT
      (SELECT count(*) FROM leads)::int AS leads,
      (SELECT count(*) FROM leads WHERE temperature='hot')::int AS hot,
      (SELECT count(*) FROM projects)::int AS won,
      (SELECT count(*) FROM projects WHERE stage IN ('Live','Promoted'))::int AS live,
      (SELECT COALESCE(sum(value),0) FROM projects)::bigint AS revenue,
      (SELECT COALESCE(sum(monthly_cost),0) FROM agents)::bigint AS payroll,
      (SELECT count(*) FROM tickets WHERE status NOT IN ('answered','closed'))::int AS open_tickets,
      (SELECT COALESCE(sum(subtotal),0) FROM invoices WHERE status='paid')::bigint AS received`)
  ]);
  const money = director ? { revenue: stats.revenue, payroll: stats.payroll, received: stats.received, ai_spend_usd: await monthSpendUSD(),
    ai_budget_usd: parseFloat(process.env.MONTHLY_AI_BUDGET_USD || "0") } : { revenue: null, payroll: null, received: null, ai_spend_usd: null, ai_budget_usd: null };
  res.json({ director, agents: director ? agents.rows : agents.rows.map(({ monthly_cost, ...a }) => a),
    approvals: approvals.rows, projects: projects.rows, activity: activity.rows,
    stats: { ...stats, ...money, provider: process.env.LLM_PROVIDER || "mock" }, stages: STAGES });
}));

app.get("/api/auth/check", admin, (_req, res) => res.json({ ok: true }));

// ---- Sales ----
app.post("/api/leads", admin, wrap(async (req, res) => {
  need(req.body, ["company", "need"]);
  res.status(202).json(await newLead(req.body));
}));
// Hook for a CRM (HubSpot/Zoho webhook, a form, a call log): same body, same token.
app.post("/api/webhooks/lead", admin, wrap(async (req, res) => {
  need(req.body, ["company", "need"]);
  res.status(202).json(await newLead({ ...req.body, source: req.body.source || "CRM" }));
}));

// ---- HR ----
app.post("/api/candidates", admin, wrap(async (req, res) => {
  need(req.body, ["name", "role", "dept"]);
  if (!DEPTS.includes(req.body.dept)) throw Object.assign(new Error(`dept must be one of: ${DEPTS.join(", ")}`), { status: 400 });
  const c = await newCandidate(req.body);
  res.status(202).json({ id: c.id, interview_link: `${process.env.PUBLIC_URL}/interview.html?t=${c.token}` });
}));
app.get("/api/interview/:token", wrap(async (req, res) => {
  if (limited("interview-get", req.ip, 60, 60 * 1000)) return res.status(429).json({ error: "Too many requests. Wait a minute and reload." });
  res.json(await getInterview(req.params.token));
}));
app.post("/api/interview/:token", wrap(async (req, res) => {
  if (limited("interview-post", req.ip, 10, 60 * 1000)) return res.status(429).json({ error: "Too many submissions. Wait a minute and try again." });
  if (!Array.isArray(req.body?.answers)) throw Object.assign(new Error("answers must be a list"), { status: 400 });
  need(req.body, ["answers"]);
  await submitAnswers(req.params.token, req.body.answers.map(a => String(a).slice(0, 4000)), String(req.body.task_answer || "").slice(0, 8000));
  res.json({ ok: true });
}));

// ---- Support ----
app.post("/api/tickets", admin, wrap(async (req, res) => {
  need(req.body, ["customer", "subject", "message"]);
  const t = await newTicket(req.body);
  res.status(202).json({ id: t.id });
}));
// Hook for a help-desk form or mailbox forwarder: same body, same token.
app.post("/api/webhooks/ticket", admin, wrap(async (req, res) => {
  need(req.body, ["customer", "subject", "message"]);
  res.status(202).json({ id: (await newTicket(req.body)).id });
}));
app.post("/api/tickets/:id/close", admin, wrap(async (req, res) => res.json(await closeTicket(parseInt(req.params.id, 10)))));

// ---- Finance ----
app.post("/api/invoices/:id/paid", admin, wrap(async (req, res) => res.json(await markPaid(parseInt(req.params.id, 10)))));

// ---- Decisions & projects ----
app.post("/api/approvals/:id", admin, wrap(async (req, res) => {
  res.json(await decide(parseInt(req.params.id, 10), req.body.decision === "approve"));
}));
app.post("/api/projects/:id/stage", admin, wrap(async (req, res) => {
  res.json(await setStage(parseInt(req.params.id, 10), req.body.stage));
}));

// ---- Records (the lists behind the office) ----
app.get("/api/records/leads", admin, wrap(async (_req, res) => res.json((await q(
  "SELECT id, company, contact, email, need, budget, source, score, temperature, status, report, created_at FROM leads ORDER BY created_at DESC LIMIT 200")).rows)));
app.get("/api/records/candidates", admin, wrap(async (_req, res) => res.json((await q(
  `SELECT id, name, email, role, dept, kind, monthly_cost, status, evaluation, created_at,
     CASE WHEN status = 'interview_sent' AND kind = 'human' THEN token END AS token FROM candidates ORDER BY created_at DESC LIMIT 200`)).rows
  .map(({ token, ...c }) => ({ ...c, interview_link: token ? `${process.env.PUBLIC_URL}/interview.html?t=${token}` : null })))));
app.get("/api/records/projects", admin, wrap(async (_req, res) => res.json((await q(
  "SELECT id, company, need, value, so, wo, stage, plan, marketing, created_at FROM projects ORDER BY created_at DESC LIMIT 200")).rows)));
app.get("/api/records/decisions", admin, wrap(async (_req, res) => res.json((await q(
  "SELECT id, kind, title, status, created_at, decided_at FROM approvals ORDER BY created_at DESC LIMIT 200")).rows)));
app.get("/api/records/spend", admin, wrap(async (_req, res) => res.json((await q(
  `SELECT COALESCE(g.name, u.agent_id) AS agent, u.model, count(*)::int AS calls, sum(u.input_tokens)::int AS input_tokens,
     sum(u.output_tokens)::int AS output_tokens, round(sum(u.cost_usd)::numeric, 4)::float AS cost_usd
   FROM llm_usage u LEFT JOIN agents g ON g.id = u.agent_id
   WHERE u.created_at >= date_trunc('month', now()) GROUP BY 1, 2 ORDER BY cost_usd DESC, calls DESC`)).rows)));
app.get("/api/records/tickets", admin, wrap(async (_req, res) => res.json((await q(
  "SELECT id, customer, email, subject, message, category, priority, reply, status, created_at, answered_at FROM tickets ORDER BY created_at DESC LIMIT 200")).rows)));
app.get("/api/records/invoices", admin, wrap(async (_req, res) => res.json((await q(
  "SELECT id, number, company, email, label, subtotal, gst, total, status, due_date, created_at, sent_at, paid_at FROM invoices ORDER BY id DESC LIMIT 200")).rows)));
app.get("/api/records/finance", admin, wrap(async (_req, res) => res.json(await profitAndLoss())));
// Marketing drafts are only drafts until the director approves them for publishing.
app.post("/api/projects/:id/marketing", admin, wrap(async (req, res) => {
  const ok = req.body?.decision === "approve";
  const p = await one(`UPDATE projects SET marketing = jsonb_set(marketing, '{review}', $2::jsonb) WHERE id=$1 AND marketing IS NOT NULL RETURNING id, company`,
    [parseInt(req.params.id, 10), JSON.stringify({ status: ok ? "approved" : "rejected", at: new Date().toISOString() })]);
  if (!p) throw Object.assign(new Error("No marketing drafts for that project yet."), { status: 404 });
  await log("isha", ok ? `got your approval to publish the ${p.company} case study and post.` : `will rewrite the ${p.company} drafts.`, null, false);
  res.json({ ok: true });
}));

// ---- Talk to Dia ----
app.post("/api/dia/chat", admin, wrap(async (req, res) => {
  need(req.body, ["message"]);
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8).map(h => ({ role: h.role === "dia" ? "Dia" : "Director", text: String(h.text).slice(0, 1000) })) : [];
  res.json(await chat(String(req.body.message).slice(0, 2000), history));
}));
app.post("/api/dia/selfcheck", admin, wrap(async (_req, res) => res.json(await selfCheck({ getHealth: health }))));
app.post("/api/dia/repair", admin, wrap(async (req, res) => res.json(await proposeFix(req.body?.problem_id))));

// ---- Company knowledge base ----
app.post("/api/kb", admin, wrap(async (req, res) => {
  need(req.body, ["title", "content"]);
  res.json({ chunks: await addDoc(req.body.title, req.body.content) });
}));
app.get("/api/kb", admin, wrap(async (_req, res) => res.json(await listDocs())));
app.get("/api/kb/search", admin, wrap(async (req, res) => res.json(await search(String(req.query.q || ""), 5))));

await connectDb();
scheduleSelfCheck(health);
const server = createServer(app);
attach(new WebSocketServer({ server, path: "/ws", maxPayload: 4096 }), keyMatches);
const port = parseInt(process.env.PORT || "8080", 10);
server.listen(port, () => console.log(`Dia's office is open on http://localhost:${port} (AI: ${process.env.LLM_PROVIDER || "mock"})` +
  (db.ok ? "" : " - database not ready, the page will show setup steps") +
  (tokenState() === "ok" ? `\nDirector key: ADMIN_TOKEN in .env (starts with ${process.env.ADMIN_TOKEN.slice(0, 4)}…). Paste it into the Director key box and press Unlock.`
    : "\nADMIN_TOKEN is not set yet: run npm run setup, then restart.")));
