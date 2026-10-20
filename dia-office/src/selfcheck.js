// Dia's self-check: finds work that stopped half-way (a crash, a restart, an AI timeout) and restarts it.
// Only safe repairs happen here; nothing in this file changes code or makes a business decision.
import { q } from "./db.js";
import { monthSpendUSD } from "./llm.js";
import { log, status, problems, problem } from "./events.js";
import { run as runLead } from "./workflows/sales.js";
import { prepare, evaluate } from "./workflows/hiring.js";
import { startEngineering, promote } from "./workflows/engineering.js";
import { triage } from "./workflows/support.js";
import { execute as runTests } from "./workflows/testing.js";
import { repairable } from "./repair.js";

const STUCK_AFTER = "3 minutes";
const MAX_TRIES = 2;
const tries = new Map(); // "lead:4" -> attempts, so a flow that keeps failing isn't retried forever

async function stuckWork() {
  const [leads, candidates, projects, tickets, testRuns] = await Promise.all([
    q(`SELECT l.* FROM leads l WHERE l.created_at < now() - interval '${STUCK_AFTER}'
       AND (l.status = 'new' OR (l.status = 'qualified' AND NOT EXISTS
         (SELECT 1 FROM approvals a WHERE a.kind = 'project' AND a.ref_id = l.id)))`),
    q(`SELECT c.* FROM candidates c WHERE c.created_at < now() - interval '${STUCK_AFTER}'
       AND (c.status = 'new' OR c.status = 'evaluating' OR (c.kind = 'ai' AND c.status = 'interview_sent'))`),
    q(`SELECT * FROM projects WHERE created_at < now() - interval '${STUCK_AFTER}'
       AND (stage IN ('Work order', 'Planning') OR (stage = 'Live' AND marketing IS NULL))`),
    q(`SELECT * FROM tickets WHERE status = 'new' AND created_at < now() - interval '${STUCK_AFTER}'`),
    q(`SELECT r.id, p.company FROM test_runs r JOIN projects p ON p.id = r.project_id WHERE r.status = 'running' AND r.created_at < now() - interval '${STUCK_AFTER}'`)
  ]);
  return [
    ...leads.rows.map(l => ({ key: `lead:${l.id}`, label: `lead ${l.company}`, fix: () => runLead(l) })),
    ...candidates.rows.map(c => ({ key: `cand:${c.id}`, label: `candidate ${c.name}`,
      fix: () => c.status === "evaluating" ? evaluate(c.id) : prepare(c) })),
    ...projects.rows.map(p => ({ key: `proj:${p.id}`, label: `project ${p.company}`,
      fix: () => p.stage === "Live" ? promote(p) : startEngineering(p.id) })),
    ...tickets.rows.map(t => ({ key: `ticket:${t.id}`, label: `ticket #${t.id} from ${t.customer}`, fix: () => triage(t) })),
    ...testRuns.rows.map(r => ({ key: `test:${r.id}`, label: `tests for ${r.company}`, fix: () => runTests(r.id) }))
  ];
}

/**
 * Returns a report Dia can read out. With repair=true she also restarts stuck work.
 * getHealth is passed in by the server so this file doesn't need to know how the database connects.
 */
export async function selfCheck({ repair = true, getHealth } = {}) {
  const health = getHealth?.() || {};
  const findings = [];
  if (health.db && !health.db.ok) return { ok: false, findings: [{ level: "bad", text: `Database: ${health.db.hint}` }], repaired: [] };

  if (health.admin_token && health.admin_token !== "ok") findings.push({ level: "warn", text: "ADMIN_TOKEN is not set in .env. Run npm run setup and restart." });
  const provider = process.env.LLM_PROVIDER || "mock";
  if (provider === "mock") findings.push({ level: "info", text: "AI is in free test mode (mock). Answers are canned." });
  if (provider === "ollama") {
    try { const r = await fetch(`${process.env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error(r.status); }
    catch (e) { findings.push({ level: "bad", text: `Ollama is not answering at ${process.env.OLLAMA_URL}. Start it with "ollama serve".` }); }
  }
  if (provider === "bedrock" && /^(paste-|$)/.test(process.env.BEDROCK_FAST_MODEL_ID || ""))
    findings.push({ level: "bad", text: "BEDROCK_FAST_MODEL_ID is not set in .env. Copy the Haiku inference profile ID from the Bedrock console." });
  const budget = parseFloat(process.env.MONTHLY_AI_BUDGET_USD || "0");
  if (budget > 0 && provider !== "mock") {
    const spent = await monthSpendUSD();
    if (spent >= budget) findings.push({ level: "bad", text: `AI budget used up ($${spent.toFixed(2)} of $${budget}). AI work is paused.` });
    else if (spent >= budget * 0.8) findings.push({ level: "warn", text: `AI budget at ${Math.round(spent / budget * 100)}% ($${spent.toFixed(2)} of $${budget}).` });
  }
  const recent = problems.filter(p => Date.now() - Date.parse(p.at) < 60 * 60 * 1000);
  if (recent.length) findings.push({ level: "warn", text: `${recent.length} problem${recent.length > 1 ? "s" : ""} in the last hour. Latest: ${recent[0].text} (${recent[0].error})` });

  const stuck = await stuckWork();
  const repaired = [], gaveUp = [];
  for (const s of stuck) {
    const n = tries.get(s.key) || 0;
    if (n >= MAX_TRIES) { gaveUp.push(s.label); continue; }
    if (!repair) continue;
    tries.set(s.key, n + 1);
    repaired.push(s.label);
    s.fix().catch(e => problem(`self-check could not restart ${s.label}`, e));
  }
  if (stuck.length && !repair) findings.push({ level: "warn", text: `${stuck.length} piece${stuck.length > 1 ? "s" : ""} of work stopped half-way: ${stuck.map(s => s.label).join(", ")}.` });
  if (gaveUp.length) findings.push({ level: "bad", text: `Still stuck after ${MAX_TRIES} restarts: ${gaveUp.join(", ")}. Check the error above or the server terminal.` });
  if (repaired.length) await log("dia", `restarted work that had stopped half-way: ${repaired.join(", ")}.`, null, false);

  const codeErrors = repairable();
  if (codeErrors.length) findings.push({ level: "warn", text: `${codeErrors.length} recent error${codeErrors.length > 1 ? "s" : ""} came from the office code. I can draft a fix for you to approve.` });
  return { ok: !findings.some(f => f.level === "bad"), findings, repaired, can_repair: codeErrors.length > 0 };
}

// Run once shortly after start (picks up work lost in a restart), then every 5 minutes.
export function scheduleSelfCheck(getHealth) {
  const tick = () => getHealth().db.ok && selfCheck({ getHealth })
    .then(r => r.repaired.length && status("dia", `Fixed ${r.repaired.length} stuck item${r.repaired.length > 1 ? "s" : ""}`, false))
    .catch(e => problem("self-check failed", e));
  setTimeout(tick, 5000);
  setInterval(tick, 5 * 60 * 1000).unref();
}
