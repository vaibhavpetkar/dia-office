// Talk to any team member directly, and give them standing instructions they follow in all their AI work.
import { q, one } from "./db.js";
import { ask, forgetInstructions } from "./llm.js";
import { COMPANY } from "./agents.js";
import { status, idle, log } from "./events.js";

const notFound = () => Object.assign(new Error("Nobody with that id works here."), { status: 404 });

export async function conversation(agentId) {
  const a = await one("SELECT id, instructions FROM agents WHERE id=$1", [agentId]);
  if (!a) throw notFound();
  const msgs = (await q("SELECT id, role, text, created_at FROM agent_messages WHERE agent_id=$1 ORDER BY id DESC LIMIT 60", [agentId])).rows.reverse();
  return { instructions: a.instructions || "", messages: msgs };
}

export async function setInstructions(agentId, text) {
  const t = String(text || "").trim().slice(0, 2000);
  const a = await one("UPDATE agents SET instructions=$2 WHERE id=$1 RETURNING id, name", [agentId, t || null]);
  if (!a) throw notFound();
  forgetInstructions(agentId);
  await log(agentId, t ? `got new standing instructions from you: "${t.slice(0, 160)}${t.length > 160 ? "…" : ""}"` : "had their standing instructions cleared.", null, false);
  return { instructions: t };
}

export async function talkTo(agentId, message) {
  const a = await one("SELECT id, name, role, dept, status, instructions FROM agents WHERE id=$1", [agentId]);
  if (!a) throw notFound();
  const text = String(message || "").trim().slice(0, 2000);
  if (!text) throw Object.assign(new Error("Write a message first."), { status: 400 });
  await q("INSERT INTO agent_messages (agent_id, role, text) VALUES ($1,'director',$2)", [a.id, text]);
  const [past, done] = await Promise.all([
    q("SELECT role, text FROM agent_messages WHERE agent_id=$1 ORDER BY id DESC LIMIT 11", [a.id]),
    q("SELECT text, created_at FROM activity WHERE agent_id=$1 ORDER BY id DESC LIMIT 12", [a.id])
  ]);
  const before = a.status && a.status !== "Idle" ? a.status : "";
  if (!before) await status(a.id, "Talking with you", false);
  let out;
  try {
    out = await ask({
      agent: a.id, tier: "fast", maxTokens: 600, need: ["reply"], plain: "reply",
      system: COMPANY() + ` You are ${a.name}, ${a.role} in the ${a.dept} team of this virtual office. The human director is talking to you directly. ` +
        `Answer in 1-4 short, friendly, specific sentences, using what you have been doing. If you don't know something, say so; never invent work you haven't done. ` +
        `If the director gives you a rule or preference to follow from now on, put it in "remember" as one short instruction; otherwise leave "remember" empty.`,
      prompt: `What you are doing now: ${before || "nothing"}\nYour recent work (newest first):\n${done.rows.map(r => `- ${r.text}`).join("\n") || "- nothing yet"}\n` +
        `Your standing instructions: ${a.instructions || "none"}\n\nConversation (oldest first):\n${past.rows.reverse().map(m => `${m.role === "director" ? "Director" : a.name}: ${m.text}`).join("\n")}\n\n` +
        `Return {"reply":"...","remember":"a standing instruction, or empty"}`,
      mock: () => ({ reply: `Hi, I'm ${a.name}. ${before ? `Right now I'm on: ${before}.` : "I'm free right now."} ` +
        `Set an AI provider in .env and I can answer properly; in test mode I only say hello.`, remember: "" })
    });
  } catch (e) {
    if (!/JSON|missing|Unexpected|position/.test(e.message)) throw e;
    out = { reply: "Sorry, my AI model gave a muddled answer just then. Could you ask me again?" };
  } finally { if (!before) await idle(a.id).catch(() => {}); }
  const reply = String(out.reply).slice(0, 2000);
  let remembered = "";
  const rule = typeof out.remember === "string" ? out.remember.trim() : "";
  if (rule && rule.length > 3) {
    const all = [a.instructions, rule].filter(Boolean).join("\n").slice(-2000);
    await setInstructions(a.id, all);
    remembered = rule;
  }
  const row = await one("INSERT INTO agent_messages (agent_id, role, text) VALUES ($1,'agent',$2) RETURNING id, role, text, created_at", [a.id, reply]);
  return { message: row, remembered };
}
