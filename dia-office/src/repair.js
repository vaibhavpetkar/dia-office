// Dia proposes code fixes for errors she hit. A fix is only ever a proposal:
// it waits in the director's approvals, and approving it opens a GitHub pull request (or saves the
// fix as a file when GitHub isn't set up). The running office never edits its own code.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative, resolve, sep } from "node:path";
import { ask } from "./llm.js";
import { log, problems } from "./events.js";
import { requestApproval, onDecision } from "./workflows/approvals.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED = ["src", "public"].map(d => resolve(ROOT, d) + sep);
const err = (status, message) => Object.assign(new Error(message), { status });

// The first stack frame that points into our own code, e.g. src/workflows/sales.js:42.
function ownFrame(stack) {
  for (const m of String(stack || "").matchAll(/(?:file:\/\/)?((?:[A-Za-z]:)?[^\s():]+\.(?:js|mjs)):(\d+):\d+/g)) {
    let file = decodeURIComponent(m[1]);
    if (/^\/[A-Za-z]:/.test(file)) file = file.slice(1); // file:///C:/... on Windows
    const abs = resolve(file);
    if (ALLOWED.some(d => abs.startsWith(d)) && !abs.includes("node_modules")) return { abs, line: Number(m[2]) };
  }
  return null;
}

export function repairable() {
  return problems.filter(p => ownFrame(p.stack)).slice(0, 5);
}

export async function proposeFix(problemId) {
  if ((process.env.LLM_PROVIDER || "mock") === "mock")
    throw err(400, "I can't write code fixes in free test mode. Set LLM_PROVIDER to anthropic (or bedrock / ollama) and I'll draft one for you to approve.");
  const p = problemId ? problems.find(x => x.id === Number(problemId)) : repairable()[0];
  if (!p) throw err(404, "I don't have a recent error that points into the office code, so there's nothing to repair.");
  const frame = ownFrame(p.stack);
  if (!frame) throw err(400, "That error happened outside the office code (a network or provider problem), so a code change won't fix it.");
  const file = relative(ROOT, frame.abs).split(sep).join("/");
  const lines = readFileSync(frame.abs, "utf8").split("\n");
  const from = Math.max(0, frame.line - 60), to = Math.min(lines.length, frame.line + 60);
  const excerpt = lines.slice(from, to).map((l, i) => `${String(from + i + 1).padStart(4)}| ${l}`).join("\n");

  const fix = await ask({
    agent: "dia", tier: "smart", maxTokens: 1800, need: ["summary", "find"],
    system: "You are a careful senior JavaScript engineer fixing a bug in a Node.js/Express app. " +
      "Propose the smallest change that fixes the root cause. Never remove approvals, auth checks, budget limits or validation.",
    prompt: `Error: ${p.text}: ${p.error}\nStack:\n${String(p.stack).split("\n").slice(0, 8).join("\n")}\n\n` +
      `File ${file}, lines ${from + 1}-${to} (the error is at line ${frame.line}):\n${excerpt}\n\n` +
      `Return {"summary":"one line","explanation":"2-3 sentences: cause and fix","find":"exact text copied from the file (no line-number prefixes), unique in the file",` +
      `"replace":"the new text","confidence":"high"|"medium"|"low"}. If the bug isn't in this code, return {"summary":"no code fix","explanation":"why","find":"","replace":""}.`
  });
  if (!fix.find) throw err(422, `I looked at ${file} and don't think code is the problem: ${fix.explanation || "no explanation"}`);
  const src = lines.join("\n");
  if (src.split(fix.find).length !== 2) throw err(422, "My fix didn't match the file exactly, so I threw it away. Ask me again and I'll retry.");

  const body = { file, line: frame.line, error: `${p.text}: ${p.error}`, summary: fix.summary, explanation: fix.explanation,
    confidence: fix.confidence, find: fix.find, replace: fix.replace };
  const a = await requestApproval("code_fix", p.id, `Code fix: ${fix.summary}`, body);
  await log("dia", `drafted a code fix for ${file}: ${fix.summary}. It's waiting for your approval.`, null, false);
  return a;
}

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, { ...opts, headers: {
    authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "dia-office", ...(opts.body ? { "content-type": "application/json" } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${j.message || "request failed"}`);
  return j;
}

async function openPullRequest(a) {
  const repo = process.env.GITHUB_REPO, b = a.body;
  const path = (process.env.GITHUB_PATH_PREFIX ?? "dia-office/") + b.file;
  const info = await gh(`/repos/${repo}`), base = info.default_branch;
  const head = await gh(`/repos/${repo}/git/ref/heads/${base}`);
  const branch = `dia/fix-${a.id}-${Date.now().toString(36)}`;
  await gh(`/repos/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: head.object.sha }) });
  const cur = await gh(`/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`);
  const text = Buffer.from(cur.content, "base64").toString("utf8");
  if (text.split(b.find).length !== 2) throw new Error(`${b.file} changed on GitHub since the error, so the fix no longer applies.`);
  await gh(`/repos/${repo}/contents/${encodeURI(path)}`, { method: "PUT", body: JSON.stringify({
    message: `Dia: ${b.summary}`, branch, sha: cur.sha, content: Buffer.from(text.replace(b.find, b.replace)).toString("base64") }) });
  const pr = await gh(`/repos/${repo}/pulls`, { method: "POST", body: JSON.stringify({
    title: `Dia: ${b.summary}`, head: branch, base, draft: true,
    body: `Proposed by Dia after this error and approved in the office.\n\n**Error:** \`${b.error}\`\n\n**Why:** ${b.explanation}\n\n**Confidence:** ${b.confidence || "unknown"}\n\nPlease review and test before merging.` }) });
  return pr.html_url;
}

onDecision("code_fix", async (a, approved) => {
  if (!approved) return log("dia", `discarded the code fix "${a.body.summary}".`, null, false);
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
    const url = await openPullRequest(a);
    return log("dia", `opened a pull request with the fix "${a.body.summary}": ${url}`, { url });
  }
  // No GitHub access: save the change where a developer can apply it.
  const dir = resolve(ROOT, "fixes"); mkdirSync(dir, { recursive: true });
  const out = resolve(dir, `fix-${a.id}.md`);
  writeFileSync(out, `# ${a.body.summary}\n\nFile: \`${a.body.file}\` (error at line ${a.body.line})\n\nError: \`${a.body.error}\`\n\n${a.body.explanation}\n\n` +
    `## Replace this\n\n\`\`\`js\n${a.body.find}\n\`\`\`\n\n## With this\n\n\`\`\`js\n${a.body.replace}\n\`\`\`\n`);
  await log("dia", `saved the approved fix to fixes/fix-${a.id}.md. Set GITHUB_TOKEN and GITHUB_REPO in .env and I'll open pull requests instead.`, null, false);
});
