// Requests: you tell Dia what you need ("research EV charging in Pune and make a poster and a 30-second reel").
// Dia reads the requirement, splits it into tasks for the right departments, and each team delivers its part:
// research briefs, pictures, video storyboards, build plans with a starter page, and written content.
import { q, one } from "../db.js";
import { ask } from "../llm.js";
import { context } from "../kb.js";
import { COMPANY } from "../agents.js";
import { status, idle, log, handoff, refresh, problem } from "../events.js";
import { generateImage, mediaUrl } from "../media.js";

const err = (status, message) => Object.assign(new Error(message), { status });

// Which team does each kind of work. A department hired on floor 2 (R&D, Design, Content) takes over from the core team.
export const KINDS = {
  research: { label: "Research", depts: ["rnd", "data"], fallback: "meera" },
  image: { label: "Image", depts: ["design"], fallback: "isha" },
  video: { label: "Video", depts: ["content"], fallback: "pooja" },
  build: { label: "Build", depts: [], fallback: "neel" },
  content: { label: "Writing", depts: ["content"], fallback: "isha" }
};
const MAX_TASKS = 6;

export async function newRequest({ brief, source = "office" }) {
  const text = String(brief || "").trim().slice(0, 4000);
  if (text.length < 4) throw err(400, "Tell Dia what you need in a sentence or two.");
  const r = await one("INSERT INTO requests (brief, source) VALUES ($1,$2) RETURNING *", [text, ["app", "api"].includes(source) ? source : "office"]);
  await log("dia", `got a new request: "${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"`, { request_id: r.id }, false);
  refresh("requests");
  runRequest(r.id).catch(e => problem(`could not finish request #${r.id}`, e));
  return r;
}

// Dia's plan, without AI: pick the kinds of work the words ask for.
function mockPlan(brief) {
  const m = brief.toLowerCase();
  // "Research the chai cafe market in Pune and make a poster" -> "chai cafe market in Pune"
  const topic = brief.replace(/^(please|can you|could you|dia,?)\s+/i, "").replace(/^(research|find out about|study|make|create|build|design|write|plan|prepare)\s+(the\s+|a\s+|an\s+)?/i, "")
    .split(/\s*(?:,|;|\band\b|\bthen\b)\s*/i)[0].slice(0, 80) || brief.slice(0, 80);
  const tasks = [];
  const want = (kind, title, detail) => tasks.push({ kind, title, detail });
  want("research", `Research: ${topic}`, `Find out what matters about "${brief}": the audience, competitors, facts and numbers, risks and what to do first.`);
  if (/image|picture|photo|poster|banner|logo|design|graphic|thumbnail/.test(m)) want("image", "Make the picture", `A picture for: ${brief}`);
  if (/video|reel|youtube|short|animation|ad film|clip/.test(m)) want("video", "Plan the video", `A short video for: ${brief}. Script, scenes and voice-over.`);
  if (/website|web site|app|portal|landing|software|build|dashboard|tool|platform|page/.test(m)) want("build", "Plan and start the build", `Build plan and a starter page for: ${brief}`);
  if (/post|blog|caption|copy|email|article|content|linkedin|instagram|newsletter|write/.test(m) || tasks.length === 1)
    want("content", "Write the content", `Written content for: ${brief}`);
  return { title: topic[0].toUpperCase() + topic.slice(1, 60), summary: `You want: ${brief}. I've split it into ${tasks.length} jobs for the teams.`,
    questions: /budget|price/.test(m) ? [] : ["Is there a budget or deadline I should plan for?"], tasks };
}

async function plan(r) {
  await status("dia", `Reading your request #${r.id}`);
  const kb = await context(r.brief, 3).catch(() => "");
  const out = await ask({
    agent: "dia", tier: "smart", maxTokens: 1200, need: ["title", "tasks"],
    system: COMPANY() + " You are Dia, who runs the office. Read the director's requirement, decide which departments are needed, " +
      "and write one clear task per department. Kinds of work: research (a topic, a market, a competitor, a technology), " +
      "image (a picture, poster, banner, logo idea), video (a short video: script and storyboard), build (software, website, app: a plan and a starter), " +
      "content (posts, emails, articles, captions). Use only the kinds the requirement needs; research comes first when the others depend on facts.",
    prompt: `Company knowledge:\n${kb || "none"}\n\nRequirement from the director:\n${r.brief}\n\n` +
      `Return {"title":"3-6 words","summary":"one or two sentences: what you understood","questions":["what is still unclear, max 3"],` +
      `"tasks":[{"kind":"${Object.keys(KINDS).join("|")}","title":"short","detail":"exactly what this team must deliver"}] (1-${MAX_TASKS} tasks)}`,
    mock: () => mockPlan(r.brief)
  });
  const tasks = (Array.isArray(out.tasks) ? out.tasks : []).filter(t => KINDS[t?.kind]).slice(0, MAX_TASKS);
  if (!tasks.length) tasks.push(...mockPlan(r.brief).tasks.slice(0, 1));
  for (const [i, t] of tasks.entries()) {
    const agent = await pickAgent(t.kind);
    await q("INSERT INTO tasks (request_id, seq, kind, dept, agent_id, title, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [r.id, i + 1, t.kind, agent.dept, agent.id, String(t.title || KINDS[t.kind].label).slice(0, 200), String(t.detail || r.brief).slice(0, 2000)]);
  }
  await q("UPDATE requests SET title=$2, summary=$3, questions=$4, status='working' WHERE id=$1",
    [r.id, String(out.title || "New request").slice(0, 120), String(out.summary || "").slice(0, 1000), JSON.stringify((out.questions || []).slice(0, 3).map(String))]);
  await log("dia", `split request #${r.id} into ${tasks.length} task${tasks.length > 1 ? "s" : ""}: ${tasks.map(t => KINDS[t.kind].label).join(", ")}.`, { request_id: r.id });
  await idle("dia");
}

async function pickAgent(kind) {
  const k = KINDS[kind];
  const hired = await one("SELECT id, dept FROM agents WHERE dept = ANY($1) ORDER BY created_at LIMIT 1", [k.depts]);
  return hired || one("SELECT id, dept FROM agents WHERE id=$1", [k.fallback]);
}

const running = new Set();
export const isRunning = id => running.has(id);
// Safe to call again after a restart: it plans if needed, then does every task that isn't done.
export async function runRequest(id) {
  if (running.has(id)) return;
  running.add(id);
  try {
    let r = await one("SELECT * FROM requests WHERE id=$1", [id]);
    if (!r || r.status === "done") return;
    if (r.status === "planning" || r.status === "failed") {
      const has = await one("SELECT count(*)::int n FROM tasks WHERE request_id=$1", [id]);
      if (!has.n) await plan(r);
      else await q("UPDATE requests SET status='working' WHERE id=$1", [id]);
      r = await one("SELECT * FROM requests WHERE id=$1", [id]);
    }
    refresh("requests");
    const findings = [];
    for (const t of (await q("SELECT * FROM tasks WHERE request_id=$1 ORDER BY seq", [id])).rows) {
      if (t.status === "done") { if (t.kind === "research") findings.push(t.output); continue; }
      try {
        await q("UPDATE tasks SET status='working', error=NULL WHERE id=$1", [t.id]);
        refresh("requests");
        await handoff("dia", t.agent_id, KINDS[t.kind].label);
        const output = await WORK[t.kind](t, r, findings);
        if (t.kind === "research") findings.push(output);
        await q("UPDATE tasks SET status='done', output=$2, done_at=now() WHERE id=$1", [t.id, output]);
        await log(t.agent_id, `finished "${t.title}" for request #${id}.`, { request_id: id, task_id: t.id });
      } catch (e) {
        await q("UPDATE tasks SET status='failed', error=$2 WHERE id=$1", [t.id, e.message.slice(0, 500)]);
        await problem(`${t.agent_id} could not finish "${t.title}" (request #${id})`, e);
      } finally { await idle(t.agent_id); refresh("requests"); }
    }
    const left = await one("SELECT count(*) FILTER (WHERE status <> 'done')::int AS left, count(*)::int AS n FROM tasks WHERE request_id=$1", [id]);
    await q("UPDATE requests SET status=$2, done_at=CASE WHEN $2='done' THEN now() END WHERE id=$1", [id, left.left ? "failed" : "done"]);
    if (!left.left)
      await log("dia", `has everything for request #${id} "${r.title}". It's ready for you.`, { request_id: id });
    refresh("requests");
  } catch (e) {
    await q("UPDATE requests SET status='failed' WHERE id=$1", [id]).catch(() => {});
    refresh("requests");
    throw e;
  } finally { running.delete(id); }
}

const brief = findings => findings.length
  ? "What research found:\n" + findings.map(f => [f.summary, ...(f.key_points || [])].join("\n- ")).join("\n\n") : "No research yet.";

const WORK = {
  async research(t, r) {
    await status(t.agent_id, `Researching: ${t.title}`);
    const kb = await context(`${t.detail} ${r.brief}`, 3).catch(() => "");
    return ask({
      agent: t.agent_id, tier: "fast", maxTokens: 1500, need: ["summary", "sections"],
      system: COMPANY() + " You are the research desk. Write a practical brief for the director. " +
        "You have no live web access: use what you know and the company knowledge, say how current your knowledge is, and mark anything that must be checked.",
      prompt: `Company knowledge:\n${kb || "none"}\n\nRequest: ${r.brief}\nYour task: ${t.detail}\n\n` +
        `Return {"summary":"2-3 sentences","sections":[{"heading":"...","body":"..."}] (3-5 sections),"key_points":["..."] (3-6),"check":["facts to verify before using"]}`,
      mock: () => ({
        summary: `A first look at ${t.title.replace(/^Research:\s*/, "")}. Free test mode writes a template; with Bedrock or Ollama the team writes the real brief.`,
        sections: [
          { heading: "Who it is for", body: "The people who would use or buy this, what they need, and where they look for it." },
          { heading: "What others do", body: "Two or three competitors or examples, what they do well and where there is room." },
          { heading: "Facts and numbers", body: "Market size, prices and dates to confirm from a current source before quoting them." },
          { heading: "What to do first", body: "Start small: one clear offer, one channel, and measure what works within two weeks." }
        ],
        key_points: ["Define the audience in one line", "Pick one competitor to beat", "Confirm numbers from a current source"],
        check: ["Any figure in this brief: it's from AI knowledge, not today's web"]
      })
    });
  },

  async image(t, r, findings) {
    await status(t.agent_id, `Designing: ${t.title}`);
    const p = await ask({
      agent: t.agent_id, tier: "fast", maxTokens: 500, need: ["prompt"],
      system: COMPANY() + " You are the designer. Turn the task into one detailed prompt for an image model: subject, setting, style, light, colours, composition. " +
        "No text in the picture unless asked; image models spell badly.",
      prompt: `Request: ${r.brief}\nYour task: ${t.detail}\n${brief(findings)}\n\nReturn {"prompt":"under 900 characters","caption":"a short caption for the director"}`,
      mock: () => ({ prompt: `Clean, modern poster illustration for: ${t.detail}. Warm light, Indian context, bold colours, plenty of space.`, caption: r.title || t.title })
    });
    await status(t.agent_id, "Drawing the picture");
    const m = await generateImage({ taskId: t.id, prompt: p.prompt, caption: p.caption, agent: t.agent_id });
    return { media_id: m.id, mime: m.mime, prompt: p.prompt, caption: p.caption || t.title, provider: process.env.IMAGE_PROVIDER || "mock" };
  },

  async video(t, r, findings) {
    await status(t.agent_id, `Storyboarding: ${t.title}`);
    return ask({
      agent: t.agent_id, tier: "fast", maxTokens: 1400, need: ["scenes"],
      system: COMPANY() + " You are the video producer. Write a short video a small team can shoot or generate: hook in the first 3 seconds, clear message, call to action.",
      prompt: `Request: ${r.brief}\nYour task: ${t.detail}\n${brief(findings)}\n\n` +
        `Return {"title":"...","length_seconds":number,"format":"9:16 reel|16:9|1:1","scenes":[{"seconds":number,"visual":"what we see","voiceover":"what we hear","on_screen_text":"..."}],"music":"mood","call_to_action":"..."}`,
      mock: () => ({ title: r.title || t.title, length_seconds: 30, format: "9:16 reel", music: "upbeat, light",
        scenes: [
          { seconds: 3, visual: "Close-up that shows the problem", voiceover: "Still doing this the hard way?", on_screen_text: "There's a better way" },
          { seconds: 10, visual: "The product or idea in use", voiceover: `Here's how ${r.title || "it"} helps.`, on_screen_text: "" },
          { seconds: 10, visual: "A happy customer, the result", voiceover: "Faster, simpler, made for you.", on_screen_text: "" },
          { seconds: 7, visual: "Logo and contact", voiceover: "Talk to Inveon today.", on_screen_text: "inveon.in" }
        ], call_to_action: "Message us to get started" })
    }).then(v => ({ ...v, render: "storyboard" }));
  },

  async build(t, r, findings) {
    await status(t.agent_id, `Planning the build: ${t.title}`);
    return ask({
      agent: t.agent_id, tier: "smart", maxTokens: 4000, need: ["stack", "steps", "starter_html"],
      system: COMPANY() + " You are the solution architect. Plan the build the team will do, and write a working single-file starter page " +
        "(HTML with inline CSS and a little JavaScript, no external files, mobile-friendly, under 150 lines) the director can open right away.",
      prompt: `Request: ${r.brief}\nYour task: ${t.detail}\n${brief(findings)}\n\n` +
        `Return {"stack":["..."],"features":["..."],"steps":[{"title":"...","dept":"eng|design|qa|cloud","days":number}],"deploy":"how it goes live on AWS","starter_html":"<!doctype html>..."}`,
      mock: () => {
        const name = (r.title || t.title).replace(/[<>&"]/g, "");
        return { stack: ["HTML + CSS + JavaScript", "Node.js API", "Postgres", "AWS (S3 + CloudFront, App Runner)"],
          features: ["Home page with the offer", "Contact form", "Admin login", "Mobile layout"],
          steps: [{ title: "Wireframes", dept: "design", days: 2 }, { title: "Build pages and API", dept: "eng", days: 6 }, { title: "Test on phones and browsers", dept: "qa", days: 2 }, { title: "Deploy to AWS", dept: "cloud", days: 1 }],
          deploy: "Static pages on S3 + CloudFront, the API on App Runner, Postgres on RDS or Neon.",
          starter_html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title>` +
            `<style>body{margin:0;font-family:system-ui,sans-serif;background:#f6f4ef;color:#1d2a24}header{background:#1f5f46;color:#fff;padding:48px 20px;text-align:center}` +
            `main{max-width:720px;margin:auto;padding:24px 16px}.card{background:#fff;border-radius:12px;padding:18px;margin:12px 0;box-shadow:0 1px 4px #0001}button{background:#1f5f46;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:16px}</style></head>` +
            `<body><header><h1>${name}</h1><p>Starter page drafted by Neel. Replace this text with the real offer.</p></header><main>` +
            `<div class="card"><h2>What we do</h2><p>One sentence about the product and who it is for.</p></div>` +
            `<div class="card"><h2>Get in touch</h2><form onsubmit="event.preventDefault();this.innerHTML='<p>Thanks! We will call you soon.</p>'"><p><input placeholder="Your name" required style="width:100%;padding:10px"></p><button>Send</button></form></div>` +
            `</main></body></html>` };
      }
    });
  },

  async content(t, r, findings) {
    await status(t.agent_id, `Writing: ${t.title}`);
    return ask({
      agent: t.agent_id, tier: "fast", maxTokens: 1400, need: ["pieces"],
      system: COMPANY() + " You write marketing and business content: clear, warm, specific, no hype words, Indian English.",
      prompt: `Request: ${r.brief}\nYour task: ${t.detail}\n${brief(findings)}\n\nReturn {"pieces":[{"channel":"LinkedIn|Instagram|Email|Blog|WhatsApp|...","title":"...","text":"..."}] (1-4)}`,
      mock: () => ({ pieces: [
        { channel: "LinkedIn", title: r.title || t.title, text: `We're working on something new: ${r.brief}\n\nIf this is a problem you face too, message us. We'd love to hear how you handle it today.` },
        { channel: "WhatsApp", title: "Short message", text: `Hi! Quick update from Inveon: ${r.title || r.brief}. Want to see it? Reply YES.` }
      ] })
    });
  }
};

// What the apps see: the request, its tasks and links to the pictures.
export async function getRequest(id) {
  const r = await one("SELECT * FROM requests WHERE id=$1", [id]);
  if (!r) throw err(404, "No request with that number.");
  const tasks = (await q(`SELECT t.id, t.seq, t.kind, t.dept, t.agent_id, g.name AS agent, t.title, t.detail, t.status, t.output, t.error, t.done_at
    FROM tasks t LEFT JOIN agents g ON g.id = t.agent_id WHERE t.request_id=$1 ORDER BY t.seq`, [id])).rows;
  for (const t of tasks) if (t.output?.media_id) t.output.url = mediaUrl(t.output.media_id);
  return { ...r, tasks };
}

export async function listRequests(limit = 30) {
  return (await q(`SELECT r.id, r.title, r.brief, r.status, r.source, r.created_at, r.done_at,
      count(t.id)::int AS tasks, count(t.id) FILTER (WHERE t.status = 'done')::int AS tasks_done
    FROM requests r LEFT JOIN tasks t ON t.request_id = r.id GROUP BY r.id ORDER BY r.created_at DESC LIMIT $1`, [limit])).rows;
}
