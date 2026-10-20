// Testing department. When a build reaches Testing, Sneha (QA automation) writes test cases and runs real
// automated checks against the project's preview URL, and Aditya (manual & UI tester) prepares a hands-on
// checklist (sliders, forms, phones, browsers) that a person ticks. Release to deploy waits for the director.
import { q, one } from "../db.js";
import { ask } from "../llm.js";
import { COMPANY } from "../agents.js";
import { status, idle, log, handoff, refresh, broadcast, problem } from "../events.js";
import { requestApproval, onDecision } from "./approvals.js";
import { setStage } from "./engineering.js";

const err = (status, message) => Object.assign(new Error(message), { status });

export function checkUrl(url) {
  if (!url) return null;
  let u;
  try { u = new URL(String(url).trim()); } catch { throw err(400, "The preview URL doesn't look like a web address. Use http://… or https://…"); }
  if (!["http:", "https:"].includes(u.protocol)) throw err(400, "The preview URL must start with http:// or https://");
  return u.toString();
}

// Start a test run for a project in Testing. `url` is the preview/sandbox address; without one only the plan and checklist are made.
export async function startTesting(projectId, { url } = {}) {
  const p = await one("SELECT * FROM projects WHERE id=$1", [projectId]);
  if (!p) throw err(404, "Project not found");
  if (p.stage !== "Testing") throw err(409, `${p.company} is in ${p.stage}. Tests run when a project is in Testing.`);
  if (await one("SELECT 1 FROM test_runs WHERE project_id=$1 AND status='running'", [p.id])) throw err(409, `Tests for ${p.company} are already running.`);
  const target = checkUrl(url) || p.preview_url || null;
  if (target !== p.preview_url) await q("UPDATE projects SET preview_url=$2 WHERE id=$1", [p.id, target]);
  // An older run still waiting for sign-off is replaced by this one.
  for (const old of (await q("UPDATE test_runs SET status='stopped', finished_at=now() WHERE project_id=$1 AND status='awaiting_signoff' RETURNING id", [p.id])).rows)
    for (const a of (await q("UPDATE approvals SET status='rejected', decided_at=now() WHERE kind='qa_signoff' AND ref_id=$1 AND status='pending' RETURNING id", [old.id])).rows)
      broadcast({ type: "approval_done", id: a.id, status: "rejected" });
  const run = await one("INSERT INTO test_runs (project_id, url) VALUES ($1,$2) RETURNING *", [p.id, target]);
  refresh("records");
  execute(run.id).catch(e => problem(`testing stopped for ${p.company}`, e));
  return run;
}

export async function execute(runId) {
  const run = await one("SELECT * FROM test_runs WHERE id=$1", [runId]);
  const p = await one("SELECT * FROM projects WHERE id=$1", [run.project_id]);
  await handoff("tara", "sneha", p.wo || "Build");
  await status("sneha", `Writing test cases for ${p.wo || p.company}`);
  await status("aditya", `Preparing hands-on checks for ${p.company}`);
  const [cases, manual] = await Promise.all([testCases(p, run.url), checklist(p)]);
  await idle("aditya");
  await log("aditya", `prepared ${manual.length} hands-on checks for ${p.company} (sliders, forms, phones, browsers). Tick them in Records → Tests.`, null, false);

  let automated = [];
  if (run.url) {
    await status("sneha", `Running automated checks on ${new URL(run.url).host}`);
    automated = await smoke(run.url);
  }
  const bugs = automated.filter(c => c.result === "fail").map(c => ({ source: "automated", severity: c.severity || "medium", title: c.name, detail: c.detail }));
  const verdict = run.url && !bugs.some(b => ["critical", "high"].includes(b.severity)) ? "ready" : "not_ready";
  const done = await one(`UPDATE test_runs SET cases=$2, manual=$3, automated=$4, bugs=$5, verdict=$6, status='awaiting_signoff'
    WHERE id=$1 AND status='running' RETURNING *`, [run.id, cases, JSON.stringify(manual), JSON.stringify(automated), JSON.stringify(bugs), verdict]);
  await idle("sneha");
  if (!done) return; // replaced or stopped while we worked

  const n = k => automated.filter(c => c.result === k).length;
  await log("sneha", run.url
    ? `tested ${p.company} at ${run.url}: ${n("pass")} passed, ${n("fail")} failed, ${n("warn")} warnings; ${(cases.test_cases || []).length} test cases written.`
    : `wrote ${(cases.test_cases || []).length} test cases for ${p.company}. No preview URL yet, so nothing was run; add one and press Run tests.`,
    { automated, bugs }, true);
  if (bugs.length) await handoff("sneha", "tara", `${bugs.length} bug${bugs.length > 1 ? "s" : ""}`);

  const now = await one("SELECT stage FROM projects WHERE id=$1", [p.id]);
  if (now?.stage !== "Testing") {
    await q("UPDATE test_runs SET status='stopped', finished_at=now() WHERE id=$1", [run.id]);
    return refresh("records");
  }
  await handoff("sneha", "dia", "QA report");
  await requestApproval("qa_signoff", run.id, `Release ${p.company} to deploy?`, {
    company: p.company, wo: p.wo, url: run.url, verdict,
    passed: n("pass"), failed: n("fail"), warnings: n("warn"), cases: (cases.test_cases || []).length,
    manual_open: manual.length, bugs: bugs.map(b => `${b.severity}: ${b.title}${b.detail ? ` (${b.detail})` : ""}`) });
  refresh("records");
}

async function testCases(p, url) {
  const modules = p.plan?.modules || [];
  return ask({
    agent: "sneha", tier: "fast", maxTokens: 1800, need: ["test_cases"],
    system: COMPANY() + " You are Sneha, QA automation engineer. Write test cases the team can automate with Playwright.",
    prompt: `Project: ${p.company} — ${p.need}.\nModules: ${modules.join(", ") || "unknown"}\nPreview URL: ${url || "not available yet"}\n` +
      `Return {"test_cases":[{"id":"TC-1","title":"...","type":"e2e"|"api"|"ui"|"unit","steps":"...","expected":"..."}],` +
      `"playwright":"a Playwright test file (TypeScript) covering the most important cases"}`,
    mock: () => {
      const base = [
        { title: "Home page loads without errors", type: "e2e", steps: "Open the home page", expected: "Page shows within 3 seconds, no console errors" },
        ...modules.map(m => ({ title: `${m} works end to end`, type: "e2e", steps: `Go through the main ${m} flow with valid data, then with empty and wrong data`, expected: "Valid data saves; bad data shows a clear message" })),
        { title: "API rejects requests without login", type: "api", steps: "Call a protected endpoint with no token", expected: "401, no data leaked" },
        { title: "Layout holds on a 360px phone screen", type: "ui", steps: "Open each main screen at 360×740", expected: "No sideways scrolling, buttons reachable" }
      ];
      const test_cases = base.map((c, i) => ({ id: `TC-${i + 1}`, ...c }));
      return { test_cases, playwright: playwrightSpec(url, test_cases) };
    }
  });
}

const playwrightSpec = (url, cases) => `import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || ${JSON.stringify(url || "http://localhost:3000")};

test("TC-1 home page loads without errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const start = Date.now();
  await page.goto(BASE);
  expect(Date.now() - start).toBeLessThan(3000);
  await expect(page).toHaveTitle(/.+/);
  expect(errors).toEqual([]);
});

test("layout holds on a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(BASE);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});
${cases.filter(c => c.type === "e2e" && c.id !== "TC-1").map(c => `
test.fixme(${JSON.stringify(`${c.id} ${c.title}`)}, async ({ page }) => {
  // ${c.steps}. Expect: ${c.expected}
  await page.goto(BASE);
});`).join("\n")}
`;

// Hands-on checks a person does with a real phone and browser. Sliders and carousels get their own section.
async function checklist(p) {
  const r = await ask({
    agent: "aditya", tier: "fast", maxTokens: 1200, need: ["checklist"],
    system: COMPANY() + " You are Aditya, manual and UI tester. List hands-on checks a person does with real devices: " +
      "sliders and carousels, swipes, forms, menus, layouts on phones and desktops, browsers, accessibility.",
    prompt: `Project: ${p.company} — ${p.need}. Modules: ${(p.plan?.modules || []).join(", ") || "unknown"}.\n` +
      `Return {"checklist":[{"area":"...","check":"one concrete thing to try and what should happen","device":"e.g. Android Chrome"}]} with 8-14 items.`,
    mock: () => {
      const m = (p.plan?.modules || []).join(" ").toLowerCase();
      return { checklist: [
        { area: "Sliders & carousels", check: "Swipe the home banner left and right; it moves smoothly, dots follow, and it doesn't jump back", device: "Android Chrome" },
        { area: "Sliders & carousels", check: "Drag any range slider (price, quantity) to both ends; the value shown matches and the list updates", device: "iPhone Safari" },
        { area: "Sliders & carousels", check: "Auto-playing slides pause when you hover or touch them", device: "Desktop Chrome" },
        { area: "Forms", check: "Submit every form empty, then with a wrong email and phone; clear messages appear next to the field", device: "Desktop Chrome" },
        { area: "Navigation", check: "Open the menu on a phone, visit every page, and press Back; nothing is broken or blank", device: "Android Chrome" },
        { area: "Layout", check: "Rotate the phone and resize the browser; text doesn't overlap and nothing scrolls sideways", device: "iPhone Safari" },
        { area: "Browsers", check: "Repeat the main flow in Firefox and Edge", device: "Desktop Firefox / Edge" },
        ...(/auth|login/.test(m) ? [{ area: "Login", check: "Log in, log out, wrong password, forgot password; the reset email arrives", device: "Desktop Chrome" }] : []),
        ...(/payment|razorpay/.test(m) ? [{ area: "Payments", check: "Pay with a Razorpay test card, then cancel a payment half-way; order status is right both times", device: "Android Chrome" }] : []),
        { area: "Accessibility", check: "Use only the keyboard (Tab, Enter, Esc) through the main flow; focus is always visible", device: "Desktop Chrome" },
        { area: "Content", check: "Read every page for spelling, placeholder text and broken images", device: "Any" }
      ] };
    }
  });
  return (r.checklist || []).slice(0, 20).map(c => ({ area: String(c.area || "General"), check: String(c.check || ""), device: String(c.device || "Any"), result: null, note: null }));
}

// Real automated checks over HTTP. No browser needed, so it runs on any machine the office runs on.
export async function smoke(url) {
  const checks = [];
  const add = (name, result, detail, severity) => checks.push({ name, result: result === true ? "pass" : result === false ? "fail" : result, detail, ...(severity ? { severity } : {}) });
  const get = (u, method = "GET") => fetch(u, { method, redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "InveonQA/1.0 (+Dia's office)" } });
  let res, html = "", ms;
  const t0 = Date.now();
  try { res = await get(url); html = (await res.text()).slice(0, 2_000_000); ms = Date.now() - t0; }
  catch (e) { add("Home page opens", false, e.cause?.message || e.message, "critical"); return checks; }
  add("Home page opens", res.ok, `HTTP ${res.status}`, "critical");
  if (!res.ok) return checks;
  add("Loads in under 3 seconds", ms < 3000 ? true : ms < 6000 ? "warn" : false, `${ms} ms`, "medium");
  const final = new URL(res.url || url), local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(final.hostname);
  add("Served over HTTPS", final.protocol === "https:" ? true : local ? "warn" : false, local ? "local preview, check again on the live address" : final.href, "high");
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  add("Page has a title", !!title, title || "missing <title>", "low");
  add("Works on phones (viewport tag)", /<meta[^>]+name=["']?viewport/i.test(html), null, "medium");
  add("Language is set", /<html[^>]+lang=/i.test(html) ? true : "warn", null, "low");
  const imgs = html.match(/<img\b[^>]*>/gi) || [], noAlt = imgs.filter(t => !/\balt\s*=/i.test(t)).length;
  add("Images have alt text", noAlt === 0 ? true : "warn", imgs.length ? `${imgs.length - noAlt} of ${imgs.length} have alt text` : "no images", "low");

  // Links on the same site must not be broken.
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)].map(m => m[1]);
  const same = [...new Set(hrefs.map(h => { try { return new URL(h, final).toString(); } catch { return null; } })
    .filter(h => h && new URL(h).origin === final.origin && h !== final.toString()))].slice(0, 15);
  const broken = [];
  await Promise.all(same.map(async h => {
    try { let r = await get(h, "HEAD"); if (r.status === 405 || r.status === 501) r = await get(h); if (r.status >= 400) broken.push(`${new URL(h).pathname} (${r.status})`); }
    catch (e) { broken.push(`${new URL(h).pathname} (${e.cause?.code || e.message})`); }
  }));
  add("No broken links", same.length ? broken.length === 0 : "warn", same.length ? (broken.length ? `broken: ${broken.join(", ")}` : `${same.length} links checked`) : "no links to other pages", "high");
  return checks;
}

// A person ticks one item of Aditya's checklist. A failed item becomes a bug for Tara.
export async function markManual(runId, index, result, note) {
  if (!["pass", "fail"].includes(result)) throw err(400, "result must be pass or fail");
  const run = await one("SELECT r.*, p.company FROM test_runs r JOIN projects p ON p.id = r.project_id WHERE r.id=$1", [runId]);
  if (!run) throw err(404, "Test run not found");
  if (!["awaiting_signoff", "running"].includes(run.status)) throw err(409, "This test run is finished.");
  const item = run.manual?.[index];
  if (!item) throw err(400, "No such checklist item");
  const manual = run.manual.map((m, i) => i === index ? { ...m, result, note: note ? String(note).slice(0, 1000) : null } : m);
  const bugs = run.bugs.filter(b => !(b.source === "manual" && b.index === index));
  if (result === "fail") bugs.push({ source: "manual", index, severity: "medium", title: `${item.area}: ${item.check}`, detail: [item.device, note].filter(Boolean).join(" · ") });
  await q("UPDATE test_runs SET manual=$2, bugs=$3 WHERE id=$1", [run.id, JSON.stringify(manual), JSON.stringify(bugs)]);
  if (result === "fail") {
    await log("aditya", `found a problem in ${run.company}: ${item.area} — ${item.check}${note ? ` (${note})` : ""}. Passed to Tara.`);
    await handoff("aditya", "tara", "Bug");
  }
  refresh("records");
  return { manual: manual[index], open: manual.filter(m => !m.result).length, bugs: bugs.length };
}

onDecision("qa_signoff", async (a, approved) => {
  const run = await one("SELECT * FROM test_runs WHERE id=$1", [a.ref_id]);
  if (!run || run.status !== "awaiting_signoff") return;
  const p = await one("SELECT * FROM projects WHERE id=$1", [run.project_id]);
  await q("UPDATE test_runs SET status=$2, finished_at=now() WHERE id=$1", [run.id, approved ? "passed" : "failed"]);
  refresh("records");
  if (p?.stage !== "Testing") return;
  if (approved) {
    await log("sneha", `signed off ${p.company} for release.`, null, false);
    await handoff("sneha", "om", "QA pass");
    return setStage(p.id, "Deploying");
  }
  await setStage(p.id, "Building");
  await handoff("sneha", "tara", "Fix list");
  const n = run.bugs.length;
  await status("tara", `Fixing ${n || "QA"} bug${n === 1 ? "" : "s"} in ${p.wo || p.company}`);
  await log("tara", `got ${p.company} back from QA with ${n} bug${n === 1 ? "" : "s"}. Mark it as Testing again when they're fixed and QA will re-test.`,
    { bugs: run.bugs }, false);
});
