import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { timingSafeEqual } from "node:crypto";
import { q, one, migrate } from "./db.js";
import { attach } from "./events.js";
import { monthSpendUSD } from "./llm.js";
import { addDoc, search } from "./kb.js";
import { decide } from "./workflows/approvals.js";
import { newLead } from "./workflows/sales.js";
import { newCandidate, getInterview, submitAnswers } from "./workflows/hiring.js";
import { setStage, STAGES } from "./workflows/engineering.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(new URL("../public", import.meta.url).pathname));

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  if (!e.status || e.status >= 500) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});

// Only the director (whoever holds ADMIN_TOKEN) can add work or make decisions.
function admin(req, res, next) {
  const want = Buffer.from(process.env.ADMIN_TOKEN || "");
  const got = Buffer.from((req.get("authorization") || "").replace(/^Bearer /, ""));
  if (!want.length || want.length !== got.length || !timingSafeEqual(want, got))
    return res.status(401).json({ error: "Admin token missing or wrong. Enter it in the office page." });
  next();
}
const need = (body, fields) => {
  const miss = fields.filter(f => !body?.[f]);
  if (miss.length) throw Object.assign(new Error(`Missing: ${miss.join(", ")}`), { status: 400 });
};

// ---- Office state (read-only, safe to show on a screen) ----
app.get("/api/state", wrap(async (_req, res) => {
  const [agents, approvals, projects, activity, stats] = await Promise.all([
    q("SELECT id,name,role,dept,kind,monthly_cost,look,status,tasks_done FROM agents ORDER BY created_at"),
    q("SELECT * FROM approvals WHERE status='pending' ORDER BY created_at"),
    q("SELECT id,company,need,value,so,wo,stage,plan,marketing,created_at FROM projects ORDER BY created_at DESC LIMIT 20"),
    q("SELECT * FROM activity ORDER BY created_at DESC LIMIT 60"),
    one(`SELECT
      (SELECT count(*) FROM leads)::int AS leads,
      (SELECT count(*) FROM leads WHERE temperature='hot')::int AS hot,
      (SELECT count(*) FROM projects)::int AS won,
      (SELECT count(*) FROM projects WHERE stage IN ('Live','Promoted'))::int AS live,
      (SELECT COALESCE(sum(value),0) FROM projects)::bigint AS revenue,
      (SELECT COALESCE(sum(monthly_cost),0) FROM agents)::bigint AS payroll`)
  ]);
  res.json({ agents: agents.rows, approvals: approvals.rows, projects: projects.rows, activity: activity.rows,
    stats: { ...stats, ai_spend_usd: await monthSpendUSD(), ai_budget_usd: parseFloat(process.env.MONTHLY_AI_BUDGET_USD || "0"),
      provider: process.env.LLM_PROVIDER || "mock" }, stages: STAGES });
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
  if (!["hr", "sales", "eng", "mkt"].includes(req.body.dept)) throw Object.assign(new Error("dept must be hr, sales, eng or mkt"), { status: 400 });
  const c = await newCandidate(req.body);
  res.status(202).json({ id: c.id, interview_link: `${process.env.PUBLIC_URL}/interview.html?t=${c.token}` });
}));
app.get("/api/interview/:token", wrap(async (req, res) => res.json(await getInterview(req.params.token))));
app.post("/api/interview/:token", wrap(async (req, res) => {
  need(req.body, ["answers"]);
  await submitAnswers(req.params.token, req.body.answers.map(a => String(a).slice(0, 4000)), String(req.body.task_answer || "").slice(0, 8000));
  res.json({ ok: true });
}));

// ---- Decisions & projects ----
app.post("/api/approvals/:id", admin, wrap(async (req, res) => {
  res.json(await decide(parseInt(req.params.id, 10), req.body.decision === "approve"));
}));
app.post("/api/projects/:id/stage", admin, wrap(async (req, res) => {
  res.json(await setStage(parseInt(req.params.id, 10), req.body.stage));
}));

// ---- Company knowledge base ----
app.post("/api/kb", admin, wrap(async (req, res) => {
  need(req.body, ["title", "content"]);
  res.json({ chunks: await addDoc(req.body.title, req.body.content) });
}));
app.get("/api/kb/search", admin, wrap(async (req, res) => res.json(await search(String(req.query.q || ""), 5))));

await migrate();
const server = createServer(app);
attach(new WebSocketServer({ server, path: "/ws" }));
const port = parseInt(process.env.PORT || "8080", 10);
server.listen(port, () => console.log(`Dia's office is open on http://localhost:${port} (AI: ${process.env.LLM_PROVIDER || "mock"})`));
