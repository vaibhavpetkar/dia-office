// Engineering plans the build; a person moves it through Building -> Testing -> Deploying -> Live.
// Testing hands the build to the QA department (testing.js); going Live hands the project to Marketing.
import { q, one } from "../db.js";
import { ask } from "../llm.js";
import { context } from "../kb.js";
import { COMPANY } from "../agents.js";
import { status, idle, log, handoff, refresh, problem } from "../events.js";
import { draftInvoice } from "./finance.js";
import { startTesting } from "./testing.js";

export const STAGES = ["Won", "Work order", "Planning", "Building", "Testing", "Deploying", "Live", "Promoted"];

export async function startEngineering(projectId) {
  const p = await one("SELECT * FROM projects WHERE id=$1", [projectId]);
  await q("UPDATE projects SET stage='Planning' WHERE id=$1", [p.id]); refresh("projects");
  await status("neel", `Planning ${p.wo}…`);
  const kb = await context(p.need);
  const plan = await ask({
    agent: "neel", tier: "smart", maxTokens: 1500, need: ["tasks", "stack"],
    system: COMPANY() + " You are Neel, solution architect. Plan a real build the team can execute.",
    prompt: `Company knowledge:\n${kb}\n\nProject: ${p.company} needs ${p.need}. Budget ${p.value} INR.\n` +
      `Return {"stack":["..."],"architecture":"3-4 sentences","modules":["..."],` +
      `"tasks":[{"title":"...","owner":"tara"|"om","days":number}],"deploy":"where and how on AWS","risks":["..."]}`,
    mock: () => ({ stack: ["Node.js", "React", "PostgreSQL", "AWS"], architecture: "React front end, Node API, Postgres. Deployed on one EC2 with nginx and daily backups.",
      modules: ["Auth", "Admin panel", "Customer app", "Payments (Razorpay)"],
      tasks: [{ title: "Set up repo, CI and database", owner: "om", days: 1 }, { title: "Auth and roles", owner: "tara", days: 2 },
        { title: "Core screens", owner: "tara", days: 5 }, { title: "Payments integration", owner: "tara", days: 2 }, { title: "Deploy to AWS", owner: "om", days: 1 }],
      deploy: "EC2 + RDS in ap-south-1", risks: ["Payment gateway approval time"] })
  });
  await q("UPDATE projects SET plan=$2, stage='Building' WHERE id=$1", [p.id, plan]);
  await log("neel", `planned ${p.wo} for ${p.company}: ${(plan.tasks || []).length} tasks on ${(plan.stack || []).join(", ")}.`, { plan });
  await idle("neel");
  await handoff("neel", "tara", "Tasks");
  const days = (plan.tasks || []).filter(t => t.owner === "tara").reduce((s, t) => s + (t.days || 0), 0);
  await status("tara", `Building ${p.wo} (${days} days planned)`);
  await log("tara", `picked up ${p.wo}. Mark the project as Testing in the office when the build is done.`, null, false);
  refresh("projects");
}

export async function setStage(projectId, stage) {
  if (!STAGES.includes(stage)) throw Object.assign(new Error(`Stage must be one of: ${STAGES.join(", ")}`), { status: 400 });
  const p = await one("UPDATE projects SET stage=$2 WHERE id=$1 RETURNING *", [projectId, stage]);
  if (!p) throw Object.assign(new Error("Project not found"), { status: 404 });
  refresh("projects"); refresh("stats");
  if (stage === "Testing") {
    await idle("tara"); await log("tara", `finished building ${p.wo}; handed it to QA.`);
    startTesting(p.id).catch(e => e.status === 409 || problem(`QA could not start testing ${p.company}`, e));
  }
  if (stage === "Deploying") { await idle("tara"); await handoff("tara", "om", "Release"); await status("om", `Deploying ${p.wo} to AWS`); }
  if (stage === "Live") {
    await idle("om"); await log("om", `${p.company} is live.`);
    await handoff("om", "pooja", "Go-live");
    promote(p).catch(e => problem(`marketing step failed for ${p.company}`, e));
    draftInvoice(p.id, "balance").catch(e => problem(`could not draft the balance invoice for ${p.company}`, e));
  }
  return p;
}

export async function promote(p) {
  await status("pooja", `Planning campaign for ${p.company}`);
  const c = await ask({
    agent: "pooja", tier: "fast", need: ["channels"],
    system: COMPANY() + " You are Pooja, digital marketing. Promote a project we just delivered (with client permission).",
    prompt: `Project: ${p.company} — ${p.need}.\nReturn {"channels":["..."],"audience":"...","monthly_budget_inr":number,"ad_copy":["3 short ads"]}`,
    mock: () => ({ channels: ["LinkedIn", "Google Ads", "Instagram"], audience: "SME owners in Maharashtra", monthly_budget_inr: 15000,
      ad_copy: [`We built ${p.need} for ${p.company}. Yours next?`, "From idea to live in weeks.", "Pune-built software, used worldwide."] })
  });
  await log("pooja", `planned a ${c.channels?.join(" + ")} campaign for the ${p.company} launch.`, { campaign: c });
  await idle("pooja");
  await handoff("pooja", "isha", "Brief");
  await status("isha", "Writing case study…");
  const s = await ask({
    agent: "isha", tier: "fast", need: ["title", "case_study"],
    system: COMPANY() + " You are Isha, content writer.",
    prompt: `Write a case study for: ${p.company} — ${p.need}. Return {"title":"...","case_study":"150 words","linkedin_post":"under 80 words"}`,
    mock: () => ({ title: `How ${p.company} went digital`, case_study: `${p.company} needed ${p.need}. Inveon delivered it end to end.`,
      linkedin_post: `Proud to launch ${p.need} for ${p.company}! 🚀` })
  });
  await q("UPDATE projects SET marketing=$2, stage='Promoted' WHERE id=$1", [p.id, { campaign: c, content: s }]);
  await log("isha", `drafted the case study "${s.title}" and a LinkedIn post. Review before publishing.`, { content: s });
  await idle("isha");
  refresh("projects");
}
