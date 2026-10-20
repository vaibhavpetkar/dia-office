// Lead -> analysis -> manager -> Dia -> human approval -> sale order + work order -> Engineering
import { q, one } from "../db.js";
import { ask } from "../llm.js";
import { context } from "../kb.js";
import { COMPANY } from "../agents.js";
import { status, idle, log, handoff, refresh } from "../events.js";
import { requestApproval, onDecision } from "./approvals.js";
import { startEngineering } from "./engineering.js";
import { sendMail } from "../mail.js";

const inr = n => (n ? "₹" + Number(n).toLocaleString("en-IN") : "unknown");

export async function newLead(input) {
  const lead = await one(
    `INSERT INTO leads (company,contact,email,need,budget,source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.company, input.contact || null, input.email || null, input.need, input.budget || null, input.source || "Manual"]);
  refresh("stats");
  run(lead).catch(e => log("dia", `could not finish lead ${lead.company}: ${e.message}`, null, false));
  return lead;
}

async function run(lead) {
  await status("kabir", `Capturing ${lead.company} (${lead.source})`);
  await log("kabir", `captured a lead from ${lead.source}: ${lead.company} needs ${lead.need}.`);
  await idle("kabir");
  await handoff("kabir", "meera", "Lead");

  // 1. Requirement analysis (cheap model + company knowledge)
  await status("meera", "Analysing requirement…");
  const kb = await context(lead.need);
  const r = await ask({
    agent: "meera", tier: "fast",
    system: COMPANY() + " You are Meera, requirement analyst. Score how good this lead is for us.",
    prompt: `Company knowledge:\n${kb}\n\nLead:\n${JSON.stringify({ company: lead.company, need: lead.need, budget_inr: lead.budget, source: lead.source })}\n\n` +
      `Return {"score":0-100,"temperature":"hot"|"warm"|"cold","summary":"2 sentences","scope":["module",...],` +
      `"questions_for_client":["..."],"risks":["..."],"estimate_inr":number,"timeline_weeks":number}. ` +
      `Hot = clear need, realistic budget, we can deliver.`,
    mock: () => { const s = 50 + Math.floor(Math.random() * 46); return { score: s, temperature: s >= 70 ? "hot" : s >= 55 ? "warm" : "cold",
      summary: `${lead.company} wants ${lead.need}. Requirement is clear enough to quote.`, scope: ["Admin panel", "Customer app", "Payments"],
      questions_for_client: ["Who are the main users?", "Any existing system to integrate?"], risks: ["Scope may grow"],
      estimate_inr: lead.budget || 300000, timeline_weeks: 6 }; }
  });
  await q("UPDATE leads SET score=$2, temperature=$3, report=$4, status=$5 WHERE id=$1",
    [lead.id, r.score, r.temperature, r, r.temperature === "hot" ? "qualified" : "nurture"]);
  await log("meera", `finished the report for ${lead.company}: ${String(r.temperature).toUpperCase()} (${r.score}/100).`, { report: r });
  await idle("meera");
  refresh("stats");

  if (r.temperature !== "hot") {
    await status("kabir", `Nurturing ${lead.company}`);
    await sendMail("kabir", lead.email, `Thanks for talking to ${process.env.COMPANY_NAME}`,
      `Hello ${lead.contact || ""},\n\nThank you for your interest. We'd love to understand a few more details:\n- ${(r.questions_for_client || []).join("\n- ")}\n\nRegards,\nKabir`);
    await idle("kabir");
    return;
  }

  // 2. Sales manager review
  await handoff("meera", "sameer", "Hot lead");
  await status("sameer", "Reviewing hot lead…");
  const m = await ask({
    agent: "sameer", tier: "fast",
    system: COMPANY() + " You are Sameer, sales manager. Decide if this hot lead should go to Dia, the owner.",
    prompt: `Analyst report:\n${JSON.stringify(r)}\nClient budget: ${inr(lead.budget)}\nReturn {"escalate":true|false,"proposed_price_inr":number,"note":"1-2 sentences"}`,
    mock: () => ({ escalate: true, proposed_price_inr: r.estimate_inr, note: "Good fit, team has capacity." })
  });
  await log("sameer", m.escalate ? `escalated ${lead.company} to Dia at ${inr(m.proposed_price_inr)}.` : `held ${lead.company}: ${m.note}`);
  await idle("sameer");
  if (!m.escalate) { await q("UPDATE leads SET status='held' WHERE id=$1", [lead.id]); return; }

  // 3. Dia prepares the decision (smart model)
  await handoff("sameer", "dia", "Escalation");
  await status("dia", `Reviewing ${lead.company}…`, false);
  const d = await ask({
    agent: "dia", tier: "smart",
    system: COMPANY() + " You are Dia, the owner. Prepare a decision for the human director. Choose how to contact the client.",
    prompt: `Lead: ${JSON.stringify({ company: lead.company, contact: lead.contact, need: lead.need, budget: lead.budget })}\n` +
      `Analyst: ${JSON.stringify(r)}\nManager: ${JSON.stringify(m)}\n` +
      `Return {"recommendation":"take"|"decline","reason":"2 sentences","contact_channel":"call"|"email"|"dia_connect",` +
      `"client_message":"short message to send the client if approved"}`,
    mock: () => ({ recommendation: "take", reason: "Clear scope and budget fits. Similar to past projects.", contact_channel: "email",
      client_message: `Hello ${lead.contact || ""}, we've reviewed your requirement and would be glad to build it. Proposal attached.` })
  });
  await log("dia", `recommends you ${d.recommendation} ${lead.company}. ${d.reason}`, null, false);
  await requestApproval("project", lead.id, `Take the ${lead.company} project?`, {
    company: lead.company, contact: lead.contact, need: lead.need, budget: lead.budget,
    price: m.proposed_price_inr, score: r.score, summary: r.summary, timeline_weeks: r.timeline_weeks,
    recommendation: d.recommendation, reason: d.reason, channel: d.contact_channel, client_message: d.client_message
  });
}

onDecision("project", async (a, approved) => {
  const lead = await one("SELECT * FROM leads WHERE id=$1", [a.ref_id]);
  if (!approved) {
    await q("UPDATE leads SET status='declined' WHERE id=$1", [lead.id]);
    await sendMail("sameer", lead.email, `Regarding your ${lead.need} requirement`,
      `Hello ${lead.contact || ""},\n\nThank you for considering us. We can't take this project on right now, but we'd be glad to stay in touch.\n\nRegards,\nSameer`);
    return;
  }
  await q("UPDATE leads SET status='won' WHERE id=$1", [lead.id]);
  await sendMail("dia", lead.email, `Your ${lead.need} project`, a.body.client_message || "We are happy to start your project.");
  await handoff("dia", "sameer", "Approved");
  await status("sameer", "Creating sale order & work order");
  const p = await one(`INSERT INTO projects (lead_id,company,need,value,stage) VALUES ($1,$2,$3,$4,'Work order') RETURNING *`,
    [lead.id, lead.company, lead.need, a.body.price || lead.budget]);
  const so = `SO-${1000 + p.id}`, wo = `WO-${2200 + p.id}`;
  await q("UPDATE projects SET so=$2, wo=$3 WHERE id=$1", [p.id, so, wo]);
  await log("sameer", `created sale order ${so} and work order ${wo} for ${lead.company} (${inr(a.body.price)}).`);
  await idle("sameer");
  refresh("projects");
  await handoff("sameer", "neel", wo);
  await startEngineering(p.id);
});
