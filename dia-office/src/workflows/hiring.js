// Candidate -> AI interview + task -> scoring -> reporting manager -> Dia -> human approval -> onboarding + billing.
// Human candidates answer on /interview.html?t=<token>. AI-agent candidates are interviewed automatically.
import { randomBytes } from "node:crypto";
import { q, one } from "../db.js";
import { ask } from "../llm.js";
import { context } from "../kb.js";
import { COMPANY } from "../agents.js";
import { status, idle, log, handoff, refresh } from "../events.js";
import { requestApproval, onDecision } from "./approvals.js";
import { sendMail } from "../mail.js";

export async function newCandidate(input) {
  const token = randomBytes(16).toString("hex");
  const c = await one(
    `INSERT INTO candidates (name,email,role,dept,kind,resume,monthly_cost,token) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [input.name, input.email || null, input.role, input.dept, input.kind === "ai" ? "ai" : "human", input.resume || "", input.monthly_cost || 0, token]);
  prepare(c).catch(e => log("dia", `could not start interview for ${c.name}: ${e.message}`, null, false));
  return c;
}

async function prepare(c) {
  await status("asha", `Preparing interview for ${c.name}`);
  const iv = await ask({
    agent: "asha", tier: "fast",
    system: COMPANY() + " You are Asha, hiring agent. Write a fair, practical interview.",
    prompt: `Role: ${c.role}. Candidate type: ${c.kind}. Resume/notes: ${c.resume || "none"}\n` +
      `Return {"questions":["5 questions"],"task":"one practical task answerable in writing within 30 minutes"}`,
    mock: () => ({ questions: [`Why do you want to work as ${c.role}?`, "Describe a project you are proud of.", "How do you handle a missed deadline?",
      "What tools do you use daily?", "How would you explain your work to a non-technical client?"], task: `Write a short plan for your first week as ${c.role} at Inveon.` })
  });
  await q("UPDATE candidates SET questions=$2, status='interview_sent' WHERE id=$1", [c.id, iv]);
  await log("asha", `prepared an interview and task for ${c.name} (${c.role}).`);
  await idle("asha");

  if (c.kind === "ai") {
    await status("asha", `Interviewing AI agent ${c.name}…`);
    const ans = await ask({
      agent: "asha", tier: "fast", maxTokens: 1500,
      system: `You are ${c.name}, an AI agent applying for the role of ${c.role} at ${process.env.COMPANY_NAME}. Answer honestly and concretely.`,
      prompt: `Questions: ${JSON.stringify(iv.questions)}\nTask: ${iv.task}\nReturn {"answers":["one per question"],"task_answer":"..."}`,
      mock: () => ({ answers: iv.questions.map(() => "I would approach this step by step and report progress daily."), task_answer: "Day 1: learn the stack. Day 2-5: ship a small fix." })
    });
    await submitAnswers(c.token, ans.answers, ans.task_answer);
  } else {
    await sendMail("asha", c.email, `Your interview for ${c.role} at ${process.env.COMPANY_NAME}`,
      `Hello ${c.name},\n\nPlease complete your interview and task here:\n${process.env.PUBLIC_URL}/interview.html?t=${c.token}\n\nRegards,\nAsha, HR`);
    await log("asha", `sent the interview link to ${c.name}. Waiting for answers.`, { link: `/interview.html?t=${c.token}` }, false);
  }
}

export async function getInterview(token) {
  const c = await one("SELECT name, role, questions, status FROM candidates WHERE token=$1", [token]);
  if (!c) throw Object.assign(new Error("Interview link not found."), { status: 404 });
  return c;
}

export async function submitAnswers(token, answers, taskAnswer) {
  const c = await one("SELECT * FROM candidates WHERE token=$1", [token]);
  if (!c) throw Object.assign(new Error("Interview link not found."), { status: 404 });
  if (c.status !== "interview_sent") throw Object.assign(new Error("This interview was already submitted."), { status: 409 });
  await q("UPDATE candidates SET answers=$2, status='evaluating' WHERE id=$1", [c.id, { answers, task: taskAnswer }]);
  evaluate(c.id).catch(e => log("dia", `could not evaluate ${c.name}: ${e.message}`, null, false));
}

async function evaluate(id) {
  const c = await one("SELECT * FROM candidates WHERE id=$1", [id]);
  await status("asha", `Scoring ${c.name}…`);
  const policy = await context(`hiring criteria ${c.role}`, 2);
  const e = await ask({
    agent: "asha", tier: "smart",
    system: COMPANY() + " You are Asha, hiring agent. Score fairly on the answers only; ignore name, gender, religion, caste, age.",
    prompt: `Hiring guidance:\n${policy}\n\nRole: ${c.role}\nQuestions: ${JSON.stringify(c.questions)}\nAnswers: ${JSON.stringify(c.answers)}\n` +
      `Return {"interview_score":0-100,"task_score":0-100,"pass":true|false,"strengths":["..."],"concerns":["..."],"summary":"2 sentences"}. Pass needs both scores >= 65.`,
    mock: () => { const a = 55 + Math.floor(Math.random() * 40), b = 55 + Math.floor(Math.random() * 40);
      return { interview_score: a, task_score: b, pass: a >= 65 && b >= 65, strengths: ["Clear communication"], concerns: ["Limited detail"], summary: "Solid candidate." }; }
  });
  await q("UPDATE candidates SET evaluation=$2, status=$3 WHERE id=$1", [c.id, e, e.pass ? "passed" : "failed"]);
  await log("asha", `scored ${c.name}: interview ${e.interview_score}, task ${e.task_score} — ${e.pass ? "passed" : "did not pass"}.`, { evaluation: e });
  await idle("asha");
  if (!e.pass) {
    await sendMail("rohan", c.email, `Your application for ${c.role}`,
      `Hello ${c.name},\n\nThank you for your time. We won't move forward this time.\nFeedback: ${(e.concerns || []).join("; ")}\n\nRegards,\nHR, ${process.env.COMPANY_NAME}`);
    return;
  }
  await handoff("asha", "vikram", "Scorecard");
  await status("vikram", `Reviewing ${c.name}…`);
  const v = await ask({
    agent: "vikram", tier: "fast",
    system: COMPANY() + " You are Vikram, reporting manager.",
    prompt: `Candidate ${c.name} for ${c.role}. Evaluation: ${JSON.stringify(e)}\nReturn {"recommend":true|false,"first_tasks":["3 tasks for week one"],"note":"1 sentence"}`,
    mock: () => ({ recommend: true, first_tasks: ["Set up accounts", "Shadow a live project", "Ship one small task"], note: "Ready to contribute." })
  });
  await log("vikram", v.recommend ? `recommends hiring ${c.name}. ${v.note}` : `does not recommend ${c.name}. ${v.note}`);
  await idle("vikram");
  if (!v.recommend) return;
  await handoff("vikram", "dia", "Hire request");
  await requestApproval("hire", c.id, `Hire ${c.name} as ${c.role}?`, {
    name: c.name, kind: c.kind, role: c.role, dept: c.dept, monthly_cost: c.monthly_cost,
    interview_score: e.interview_score, task_score: e.task_score, summary: e.summary, first_tasks: v.first_tasks
  });
}

onDecision("hire", async (a, approved) => {
  const c = await one("SELECT * FROM candidates WHERE id=$1", [a.ref_id]);
  if (!approved) {
    await q("UPDATE candidates SET status='rejected' WHERE id=$1", [c.id]);
    await sendMail("rohan", c.email, `Your application for ${c.role}`, `Hello ${c.name},\n\nThank you for interviewing with us. We won't move forward this time.\n\nRegards,\nHR`);
    return;
  }
  await handoff("dia", "rohan", "Offer");
  await status("rohan", `Onboarding ${c.name}`);
  const policies = await context("company policy leave working hours code of conduct", 4);
  await sendMail("rohan", c.email, `Welcome to ${process.env.COMPANY_NAME}!`,
    `Hello ${c.name},\n\nWe're happy to offer you the role of ${c.role}.\n\nCompany policies:\n${policies}\n\nRegards,\nRohan, HR`);
  const agentId = "c" + c.id;
  const skins = [0, 1, 2, 3, 4, 5], styles = ["short", "long", "bun", "curly"], shirts = ["#2b6cb0", "#2f8a4c", "#7b4bb7", "#c2264b", "#d9930f", "#3a7d8c"];
  const pick = x => x[Math.floor(Math.random() * x.length)];
  await q(`INSERT INTO agents (id,name,role,dept,kind,monthly_cost,look) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
    [agentId, c.name, c.role, c.dept, c.kind, c.monthly_cost, { skin: pick(skins), style: pick(styles), shirt: pick(shirts) }]);
  await q("UPDATE candidates SET status='hired' WHERE id=$1", [c.id]);
  await log("rohan", `onboarded ${c.name}. Billing starts at ₹${Number(c.monthly_cost).toLocaleString("en-IN")}/month.`);
  await idle("rohan");
  refresh("agents"); refresh("stats");
  await status("vikram", `Assigning tasks to ${c.name}`);
  await log("vikram", `assigned ${c.name}'s first tasks: ${(a.body.first_tasks || []).join("; ")}.`);
  await idle("vikram");
});
