// End-to-end tests: start the real server in mock AI mode against a throwaway database and drive it over HTTP.
// Needs Postgres with pgvector. Uses TEST_DATABASE_URL (default postgres://dia:dia@localhost:5432/dia_test),
// and wipes that database first, so never point it at real data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DB = process.env.TEST_DATABASE_URL || "postgres://dia:dia@localhost:5432/dia_test";
const PORT = 8097, BASE = `http://localhost:${PORT}`, KEY = "test-director-key-0123456789";
const root = fileURLToPath(new URL("..", import.meta.url));
let server, db;

// Same generator the office uses in mock mode, to pick inputs with a known outcome.
function seeded(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hotLead = (need, prefix = "Hot Co") => { for (let i = 0; ; i++) if (50 + Math.floor(seeded(`${prefix} ${i}` + need)() * 46) >= 70) return `${prefix} ${i}`; };
const passingCandidate = role => { for (let i = 0; ; i++) { const r = seeded(`Agent ${i}` + role), a = 55 + Math.floor(r() * 40), b = 55 + Math.floor(r() * 40); if (a >= 65 && b >= 65) return `Agent ${i}`; } };

async function call(path, { method = "GET", body, key = KEY } = {}) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function waitFor(fn, what, ms = 40000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 250));
  }
}
const row = async (sql, p) => (await db.query(sql, p)).rows[0];

before(async () => {
  db = new pg.Client({ connectionString: DB });
  await db.connect();
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  server = spawn(process.execPath, ["src/server.js"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, DOTENV_CONFIG_PATH: "/nonexistent", DATABASE_URL: DB, PORT: String(PORT), PUBLIC_URL: BASE, ADMIN_TOKEN: KEY,
    LLM_PROVIDER: "mock", MOCK_DELAY_MS: "10", EMBED_DIM: "768", SES_FROM: "", GITHUB_TOKEN: "" } });
  let log = "";
  server.stdout.on("data", d => (log += d)); server.stderr.on("data", d => (log += d));
  await waitFor(async () => log.includes("open on") || (server.exitCode !== null && Promise.reject(new Error(log))), "server start", 20000);
  server.log = () => log;
});
after(async () => { server?.kill(); await db?.end(); });

test("health reports the database as connected", async () => {
  const { body } = await call("/api/health");
  assert.equal(body.db.ok, true);
  assert.equal(body.admin_token, "ok");
  const m = await row("SELECT count(*)::int n FROM schema_migrations");
  assert.ok(m.n >= 1, "migrations are recorded");
});

test("director key: missing, wrong and right", async () => {
  const none = await call("/api/auth/check", { key: null });
  assert.equal(none.status, 401); assert.equal(none.body.key, "missing");
  const wrong = await call("/api/auth/check", { key: "nope" });
  assert.equal(wrong.status, 401); assert.equal(wrong.body.key, "wrong");
  assert.equal((await call("/api/auth/check")).status, 200);
});

test("office state hides client data and money without the key", async () => {
  const pub = (await call("/api/state", { key: null })).body;
  assert.equal(pub.director, false);
  assert.deepEqual(pub.approvals, []); assert.deepEqual(pub.activity, []);
  assert.equal(pub.stats.revenue, null);
  assert.ok(pub.agents.length >= 12 && pub.agents.every(a => a.monthly_cost === undefined));
  const dir = (await call("/api/state")).body;
  assert.equal(dir.director, true);
  assert.ok(dir.agents.every(a => a.monthly_cost !== undefined));
});

test("a hot lead goes all the way to a promoted project", async () => {
  const need = "event ticketing web app", company = hotLead(need);
  assert.equal((await call("/api/leads", { method: "POST", body: { company, need, budget: 300000 } })).status, 202);
  const ap = await waitFor(() => row("SELECT * FROM approvals WHERE kind='project' AND title LIKE $1 AND status='pending'", [`%${company}%`]), "project approval");
  assert.equal((await call(`/api/approvals/${ap.id}`, { method: "POST", body: { decision: "approve" } })).status, 200);
  assert.equal((await call(`/api/approvals/${ap.id}`, { method: "POST", body: { decision: "approve" } })).status, 409, "a decision can't be made twice");
  const p = await waitFor(() => row("SELECT * FROM projects WHERE company=$1 AND stage='Building'", [company]), "build plan");
  assert.match(p.so, /^SO-/); assert.match(p.wo, /^WO-/);
  assert.ok(p.plan.tasks.length > 0);
  for (const stage of ["Testing", "Deploying", "Live"]) assert.equal((await call(`/api/projects/${p.id}/stage`, { method: "POST", body: { stage } })).status, 200);
  const done = await waitFor(() => row("SELECT * FROM projects WHERE id=$1 AND stage='Promoted'", [p.id]), "marketing");
  assert.ok(done.marketing.content.linkedin_post);
});

test("an unknown stage is refused", async () => {
  const r = await call("/api/projects/1/stage", { method: "POST", body: { stage: "Shipped" } });
  assert.equal(r.status, 400);
});

test("mock scores are repeatable", async () => {
  const a = seeded("Same Co" + "x")(), b = seeded("Same Co" + "x")();
  assert.equal(a, b);
});

test("an AI candidate is interviewed, approved and gets a desk", async () => {
  const role = "QA Engineer", name = passingCandidate(role);
  const r = await call("/api/candidates", { method: "POST", body: { name, role, dept: "eng", kind: "ai", monthly_cost: 12000 } });
  assert.equal(r.status, 202);
  const ap = await waitFor(() => row("SELECT * FROM approvals WHERE kind='hire' AND ref_id=$1", [r.body.id]), "hire approval");
  await call(`/api/approvals/${ap.id}`, { method: "POST", body: { decision: "approve" } });
  await waitFor(() => row("SELECT * FROM agents WHERE id=$1", [`c${r.body.id}`]), "new desk");
});

test("a human candidate answers once on the interview link", async () => {
  const r = await call("/api/candidates", { method: "POST", body: { name: "Meena", role: "Designer", dept: "mkt" } });
  const token = new URL(r.body.interview_link).searchParams.get("t");
  const iv = await waitFor(async () => { const x = await call(`/api/interview/${token}`, { key: null }); return x.body.status === "interview_sent" && x.body; }, "interview questions");
  assert.ok(iv.questions.questions.length >= 3);
  assert.equal((await call(`/api/interview/${token}`, { method: "POST", key: null, body: { answers: "not a list" } })).status, 400);
  const answers = iv.questions.questions.map(() => "A careful answer.");
  assert.equal((await call(`/api/interview/${token}`, { method: "POST", key: null, body: { answers, task_answer: "Plan" } })).status, 200);
  assert.equal((await call(`/api/interview/${token}`, { method: "POST", key: null, body: { answers, task_answer: "Plan" } })).status, 409);
  assert.equal((await call("/api/interview/not-a-real-token", { key: null })).status, 404);
});

test("company knowledge: add, list, search", async () => {
  assert.equal((await call("/api/kb", { method: "POST", body: { title: "Leave policy", content: "18 paid leaves a year. Working hours 10am to 7pm." } })).status, 200);
  const list = (await call("/api/kb")).body;
  assert.ok(list.some(d => d.title === "Leave policy"));
  const hits = (await call("/api/kb/search?q=paid%20leaves")).body;
  assert.equal(hits[0].title, "Leave policy");
});

test("Dia answers in chat and offers actions as buttons", async () => {
  const hi = (await call("/api/dia/chat", { method: "POST", body: { message: "Hello Dia" } })).body;
  assert.match(hi.reply, /Dia/);
  const lead = (await call("/api/dia/chat", { method: "POST", body: { message: "add lead Acme needs an online store" } })).body;
  assert.equal(lead.action.path, "/api/leads");
  assert.equal(lead.action.body.company, "Acme");
  const fix = (await call("/api/dia/chat", { method: "POST", body: { message: "check yourself" } })).body;
  assert.equal(fix.action.path, "/api/dia/selfcheck");
  assert.equal((await call("/api/dia/chat", { method: "POST", key: null, body: { message: "hi" } })).status, 401);
});

test("self-check restarts a lead that stopped half-way", async () => {
  const l = await row("INSERT INTO leads (company, need, status, created_at) VALUES ('Stuck Co', 'crm', 'new', now() - interval '10 minutes') RETURNING id");
  const r = (await call("/api/dia/selfcheck", { method: "POST" })).body;
  assert.ok(r.repaired.includes("lead Stuck Co"), JSON.stringify(r));
  await waitFor(() => row("SELECT * FROM leads WHERE id=$1 AND status <> 'new'", [l.id]), "lead analysed");
});

test("code repair is refused in mock mode with a clear reason", async () => {
  const r = await call("/api/dia/repair", { method: "POST", body: {} });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /free test mode/);
});

test("records list leads, candidates, projects, decisions and spend for the director only", async () => {
  for (const r of ["leads", "candidates", "projects", "decisions", "spend"]) {
    const res = await call(`/api/records/${r}`);
    assert.equal(res.status, 200, r); assert.ok(Array.isArray(res.body), r);
    assert.equal((await call(`/api/records/${r}`, { key: null })).status, 401, r);
  }
  const human = (await call("/api/records/candidates")).body.find(c => c.name === "Meena");
  assert.equal(human.interview_link, null, "link is hidden once the interview is submitted");
});

test("marketing drafts wait for the director's approval", async () => {
  const p = (await call("/api/records/projects")).body.find(x => x.marketing);
  assert.ok(p, "a promoted project exists from the earlier test");
  assert.equal((await call(`/api/projects/${p.id}/marketing`, { method: "POST", body: { decision: "approve" } })).status, 200);
  const after = (await call("/api/records/projects")).body.find(x => x.id === p.id);
  assert.equal(after.marketing.review.status, "approved");
});

test("a support ticket gets a drafted reply that waits for approval", async () => {
  const r = await call("/api/tickets", { method: "POST", body: { customer: "Pune Events", subject: "Login is down", message: "Urgent: users cannot log in since morning." } });
  assert.equal(r.status, 202);
  const ap = await waitFor(() => row("SELECT * FROM approvals WHERE kind='ticket_reply' AND ref_id=$1", [r.body.id]), "reply approval");
  assert.equal(ap.body.category, "bug"); assert.equal(ap.body.priority, "high");
  assert.equal((await row("SELECT status FROM tickets WHERE id=$1", [r.body.id])).status, "awaiting_approval");
  await call(`/api/approvals/${ap.id}`, { method: "POST", body: { decision: "approve" } });
  await waitFor(() => row("SELECT * FROM tickets WHERE id=$1 AND status='answered'", [r.body.id]), "ticket answered");
  assert.equal((await call(`/api/tickets/${r.body.id}/close`, { method: "POST" })).status, 200);
  assert.equal((await call("/api/tickets", { method: "POST", key: null, body: { customer: "x", subject: "y", message: "z" } })).status, 401);
});

test("an approved project gets a GST advance invoice, then balance at go-live", async () => {
  const need = "inventory app", company = hotLead(need, "Billing Co");
  await call("/api/leads", { method: "POST", body: { company, need, budget: 200000, email: "owner@example.com" } });
  const ap = await waitFor(() => row("SELECT * FROM approvals WHERE kind='project' AND title LIKE $1", [`%${company}%`]), "project approval");
  await call(`/api/approvals/${ap.id}`, { method: "POST", body: { decision: "approve" } });
  const ia = await waitFor(() => row("SELECT * FROM approvals WHERE kind='invoice' AND title LIKE $1", [`%${company}%`]), "invoice approval");
  assert.equal(ia.body.subtotal, 100000); assert.equal(ia.body.gst, 18000); assert.equal(ia.body.total, 118000);
  assert.match(ia.body.number, /^INV-\d+$/);
  assert.equal((await call(`/api/invoices/${ia.ref_id}/paid`, { method: "POST" })).status, 409, "a draft can't be paid");
  await call(`/api/approvals/${ia.id}`, { method: "POST", body: { decision: "approve" } });
  await waitFor(() => row("SELECT * FROM invoices WHERE id=$1 AND status='sent'", [ia.ref_id]), "invoice sent");
  assert.equal((await call(`/api/invoices/${ia.ref_id}/paid`, { method: "POST" })).status, 200);
  const pnl = (await call("/api/records/finance")).body;
  assert.ok(pnl.received >= 100000 && typeof pnl.profit === "number");
  const p = await waitFor(() => row("SELECT * FROM projects WHERE company=$1 AND stage='Building'", [company]), "build");
  await call(`/api/projects/${p.id}/stage`, { method: "POST", body: { stage: "Live" } });
  const bal = await waitFor(() => row("SELECT * FROM invoices WHERE project_id=$1 AND label='Balance on go-live'", [p.id]), "balance invoice");
  assert.equal(Number(bal.subtotal), 100000);
  for (const r of ["tickets", "invoices", "finance"]) assert.equal((await call(`/api/records/${r}`, { key: null })).status, 401, r);
});

test("Dia splits a goal into jobs for different teams", async () => {
  const r = (await call("/api/dia/chat", { method: "POST", body: { message: "add lead Zen Foods needs a delivery app; ticket from Acme: the app is slow then check yourself" } })).body;
  assert.deepEqual(r.actions.map(a => a.path), ["/api/leads", "/api/tickets", "/api/dia/selfcheck"]);
  const money = (await call("/api/dia/chat", { method: "POST", body: { message: "How much profit this month?" } })).body;
  assert.match(money.reply, /profit|loss/i);
});

test("Support, Finance and the floor 2 departments take new hires", async () => {
  const st = (await call("/api/state")).body;
  assert.ok(st.agents.some(a => a.id === "kavya" && a.dept === "support"));
  assert.ok(st.agents.some(a => a.id === "arjun" && a.dept === "fin"));
  assert.equal((await call("/api/candidates", { method: "POST", body: { name: "Riya", role: "Accountant", dept: "fin" } })).status, 202);
  assert.equal((await call("/api/candidates", { method: "POST", body: { name: "Kiran", role: "Designer", dept: "design" } })).status, 202, "floor 2 departments take hires");
  assert.equal((await call("/api/candidates", { method: "POST", body: { name: "Riya", role: "Accountant", dept: "space" } })).status, 400);
});

test("Dia greets in Marathi and Hindi, and the cloud voice explains when it isn't set up", async () => {
  const mr = (await call("/api/dia/chat", { method: "POST", body: { message: "namaskar", lang: "mr" } })).body;
  assert.match(mr.reply, /नमस्कार! मी दिया/);
  const hi = (await call("/api/dia/chat", { method: "POST", body: { message: "hello", lang: "hi" } })).body;
  assert.match(hi.reply, /नमस्ते! मैं दिया/);
  assert.equal((await call("/api/health")).body.tts, "browser");
  const tts = await call("/api/dia/tts", { method: "POST", body: { text: "hello", lang: "mr" } });
  assert.equal(tts.status, 400); assert.match(tts.body.error, /AZURE_SPEECH_KEY/);
});

test("QA tests a build at its preview URL, sends bugs back to Tara, then signs off the release", async () => {
  // A tiny client site: one good link, one broken link (until "fixed"), and an image without alt text.
  let fixed = false;
  const site = createServer((req, res) => {
    if (req.url === "/") return res.end(`<!doctype html><html lang="en"><head><title>Pune Bakes</title><meta name="viewport" content="width=device-width">
      </head><body><a href="/menu">Menu</a><a href="/missing">Old page</a><img src="/a.png"></body></html>`);
    if (req.url === "/menu" || (fixed && req.url === "/missing")) return res.end("ok");
    res.statusCode = 404; res.end("nope");
  });
  await new Promise(r => site.listen(0, r));
  const url = `http://localhost:${site.address().port}/`;
  try {
    const st = (await call("/api/state")).body;
    assert.ok(st.agents.some(a => a.id === "sneha" && a.dept === "qa") && st.agents.some(a => a.id === "aditya" && a.dept === "qa"), "QA team has desks");
    const p = await row(`INSERT INTO projects (company, need, value, wo, stage, plan) VALUES ('Pune Bakes', 'bakery website', 80000, 'WO-QA1', 'Building',
      '{"modules":["Auth","Payments (Razorpay)"]}') RETURNING id`);
    assert.equal((await call(`/api/projects/${p.id}/qa`, { method: "POST", body: { url } })).status, 409, "only projects in Testing are tested");

    // Marking Testing hands the build to QA; with no preview URL yet nothing is run and Sneha says not ready.
    await call(`/api/projects/${p.id}/stage`, { method: "POST", body: { stage: "Testing" } });
    const first = await waitFor(() => row("SELECT * FROM approvals WHERE kind='qa_signoff' AND body->>'company'='Pune Bakes' AND status='pending'"), "first sign-off");
    assert.equal(first.body.verdict, "not_ready"); assert.equal(first.body.url, null);
    const run1 = await row("SELECT * FROM test_runs WHERE id=$1", [first.ref_id]);
    assert.ok(run1.manual.some(m => m.area === "Sliders & carousels"), "hands-on checklist covers sliders");
    assert.ok(run1.manual.some(m => m.area === "Payments"), "checklist follows the plan's modules");
    assert.match(run1.cases.playwright, /@playwright\/test/);

    // Run again with the preview URL: real checks find the broken link; the old sign-off is withdrawn.
    assert.equal((await call(`/api/projects/${p.id}/qa`, { method: "POST", body: { url: "ftp://x" } })).status, 400);
    assert.equal((await call(`/api/projects/${p.id}/qa`, { method: "POST", body: { url } })).status, 202);
    const second = await waitFor(() => row("SELECT * FROM approvals WHERE kind='qa_signoff' AND body->>'url'=$1 AND status='pending'", [url]), "second sign-off");
    assert.equal((await row("SELECT status FROM approvals WHERE id=$1", [first.id])).status, "rejected");
    const run2 = await row("SELECT * FROM test_runs WHERE id=$1", [second.ref_id]);
    const check = name => run2.automated.find(c => c.name === name);
    assert.equal(check("Home page opens").result, "pass");
    assert.equal(check("Page has a title").detail, "Pune Bakes");
    assert.equal(check("No broken links").result, "fail"); assert.match(check("No broken links").detail, /\/missing \(404\)/);
    assert.equal(check("Images have alt text").result, "warn");
    assert.equal(check("Served over HTTPS").result, "warn", "a local preview isn't failed for plain http");
    assert.equal(second.body.verdict, "not_ready");

    // A person fails one hands-on check: it becomes a bug for Tara. Then the director sends the build back.
    const tick = await call(`/api/test-runs/${run2.id}/manual`, { method: "POST", body: { index: 0, result: "fail", note: "banner jumps back" } });
    assert.equal(tick.status, 200); assert.equal(tick.body.bugs, 2);
    assert.equal((await call(`/api/test-runs/${run2.id}/manual`, { method: "POST", body: { index: 0, result: "maybe" } })).status, 400);
    await call(`/api/approvals/${second.id}`, { method: "POST", body: { decision: "reject" } });
    await waitFor(() => row("SELECT * FROM projects WHERE id=$1 AND stage='Building'", [p.id]), "back to build");
    assert.equal((await row("SELECT status FROM test_runs WHERE id=$1", [run2.id])).status, "failed");

    // Tara fixes it; Testing again re-tests at the saved preview URL, all links pass, and sign-off releases to deploy.
    fixed = true;
    await call(`/api/projects/${p.id}/stage`, { method: "POST", body: { stage: "Testing" } });
    const third = await waitFor(() => row("SELECT * FROM approvals WHERE kind='qa_signoff' AND body->>'url'=$1 AND status='pending' AND id > $2", [url, second.id]), "third sign-off");
    assert.equal(third.body.verdict, "ready"); assert.equal(third.body.failed, 0);
    await call(`/api/approvals/${third.id}`, { method: "POST", body: { decision: "approve" } });
    await waitFor(() => row("SELECT * FROM projects WHERE id=$1 AND stage='Deploying'", [p.id]), "released to deploy");
    assert.equal((await row("SELECT status FROM test_runs WHERE id=$1", [third.ref_id])).status, "passed");

    const tests = await call("/api/records/tests");
    assert.ok(tests.body.some(r => r.company === "Pune Bakes" && r.status === "passed"));
    assert.equal((await call("/api/records/tests", { key: null })).status, 401);
  } finally { site.close(); }
});

test("Dia asks QA to test a project in Testing", async () => {
  await row("INSERT INTO projects (company, need, value, stage) VALUES ('Chat Testers', 'crm', 50000, 'Testing') RETURNING id");
  const r = (await call("/api/dia/chat", { method: "POST", body: { message: "run tests for Chat Testers at https://preview.example.com" } })).body;
  assert.match(r.action.path, /^\/api\/projects\/\d+\/qa$/);
  assert.equal(r.action.body.url, "https://preview.example.com");
});

test("sslmode in DATABASE_URL becomes a verified TLS option without the pg warning", async () => {
  const { connectionOptions } = await import("../src/db.js");
  assert.deepEqual(connectionOptions("postgres://u:p@h/db?sslmode=require&channel_binding=require"),
    { connectionString: "postgres://u:p@h/db?channel_binding=require", ssl: { rejectUnauthorized: true } });
  assert.deepEqual(connectionOptions("postgres://u:p@h/db"), { connectionString: "postgres://u:p@h/db" });
});

test("Engineering's website runs live in the sandbox, isolated, and a change request makes a new version", async () => {
  const need = "online store for handmade sarees", company = hotLead(need, "Saree Co");
  await call("/api/leads", { method: "POST", body: { company, need, budget: 250000 } });
  const ap = await waitFor(() => row("SELECT * FROM approvals WHERE kind='project' AND title LIKE $1 AND status='pending'", [`%${company}%`]), "project approval");
  await call(`/api/approvals/${ap.id}`, { method: "POST", body: { decision: "approve" } });
  const p = await waitFor(() => row("SELECT * FROM projects WHERE company=$1 AND stage='Building'", [company]), "build plan");
  const v1 = await waitFor(() => row("SELECT * FROM sites WHERE project_id=$1 AND status='ready'", [p.id]), "first sandbox version");
  assert.equal(v1.version, 1);
  assert.equal((await call("/api/state")).body.projects.find(x => x.id === p.id).site.token, v1.token, "the project card links the sandbox");

  // Anyone with the link can look, without the director key.
  const meta = await call(`/api/sandbox/${v1.token}`, { key: null });
  assert.equal(meta.status, 200);
  assert.equal(meta.body.company, company);
  assert.ok(meta.body.pages[0] === "index.html" && meta.body.pages.length >= 2);
  assert.ok(meta.body.guide.summary && meta.body.guide.try.length);
  const home = await fetch(`${BASE}/sandbox/${v1.token}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /^sandbox allow-scripts/);
  assert.match(home.headers.get("content-security-policy"), /connect-src 'none'/);
  const html = await home.text();
  assert.ok(html.includes(company) && html.includes("parent.postMessage"), "page is served with the sandbox helper");
  assert.equal((await fetch(`${BASE}/sandbox/${v1.token}`, { redirect: "manual" })).status, 301);
  assert.match((await fetch(`${BASE}/sandbox/${v1.token}/styles.css`)).headers.get("content-type"), /text\/css/);
  assert.equal((await fetch(`${BASE}/sandbox/${v1.token}/..%2f..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${BASE}/sandbox/${v1.token}/missing.html`)).status, 404);
  assert.equal((await call("/api/sandbox/not-a-real-token-123456789", { key: null })).status, 404);

  // Only the director can ask for changes; the old version stays.
  assert.equal((await call(`/api/projects/${p.id}/sites`, { method: "POST", body: { feedback: "bigger logo" }, key: null })).status, 401);
  const v2 = await call(`/api/projects/${p.id}/sites`, { method: "POST", body: { feedback: "Add a pricing page" } });
  assert.equal(v2.status, 202); assert.equal(v2.body.version, 2);
  assert.equal((await call(`/api/projects/${p.id}/sites`, { method: "POST", body: { feedback: "again" } })).status, 409, "one build at a time");
  await waitFor(() => row("SELECT 1 FROM sites WHERE token=$1 AND status='ready'", [v2.body.token]), "second version");
  const list = (await call(`/api/projects/${p.id}/sites`)).body;
  assert.deepEqual(list.map(s => s.version), [2, 1]);
  assert.equal((await call(`/api/sandbox/${v1.token}`, { key: null })).body.latest, v2.body.token, "old link points to the newer version");
  assert.match(list[0].guide.changes.join(" "), /pricing page/);
});
