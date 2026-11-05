// Picks the best FREE OpenRouter model for each kind of work: npm run openrouter:models
// Reads OpenRouter's live model list (no key needed), so the picks follow whatever is free today.
//   npm run openrouter:models            shows the picks
//   npm run openrouter:models -- --save  also writes them into .env (and sets LLM_PROVIDER=openrouter)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENTS } from "../src/agents.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = root + ".env";

// Who does what. Anyone not listed (and anyone you hire later) uses OPENROUTER_FAST_MODEL.
const KIND = {
  code: ["tara", "neel", "om", "sneha", "aditya"], // websites, plans, deploys, tests, UI checks
  writing: ["pooja", "isha", "meera", "sameer", "kavya", "asha", "vikram", "arjun"] // marketing, content, sales, support, HR, billing
};
// Departments, so people hired into them later get the right model too.
const DEPT_KIND = {
  code: ["eng", "qa", "design", "mobile", "cloud", "security", "data", "rnd"],
  writing: ["hr", "sales", "mkt", "support", "fin", "product", "success", "content", "events", "partners", "ops", "admin", "training"],
  smart: ["legal"] // contracts and compliance need careful reasoning, so legal gets the same model as Dia's big decisions
};
// Model families to prefer for each kind, best first. A model matches if its id contains the text.
// The list only orders what OpenRouter offers free right now; models that aren't free are never picked.
const PREFER = {
  smart: ["deepseek-r1", "deepseek-v3", "deepseek-chat-v3", "qwen3-235b", "kimi-k2", "gpt-oss-120b", "glm-4", "llama-4-maverick", "qwen3", "deepseek", "llama-3.3-70b"],
  code: ["qwen3-coder", "kimi-k2", "deepseek-v3", "deepseek-chat-v3", "devstral", "glm-4", "gpt-oss-120b", "qwen3-235b", "deepseek", "qwen3", "llama-3.3-70b"],
  writing: ["deepseek-v3", "deepseek-chat-v3", "llama-3.3-70b", "qwen3-235b", "gemma-3-27b", "kimi-k2", "mistral-small", "gpt-oss", "llama-4", "qwen3", "gemma"],
  fast: ["deepseek-v3", "deepseek-chat-v3", "gpt-oss-120b", "llama-3.3-70b", "qwen3-235b", "gemma-3-27b", "mistral-small", "qwen3", "llama", "gemma"]
};

const res = await fetch(`${(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "")}/models`);
if (!res.ok) { console.log(`Could not read OpenRouter's model list (HTTP ${res.status}). Check your internet and try again.`); process.exit(1); }
const all = (await res.json()).data;
const isFree = m => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
const makesText = m => (m.architecture?.output_modalities || ["text"]).includes("text");
const free = all.filter(m => isFree(m) && makesText(m) && (m.context_length || 0) >= 16000);
const json = m => (m.supported_parameters || []).some(p => p === "response_format" || p === "structured_outputs");

function best(kind) {
  const rank = m => { const i = PREFER[kind].findIndex(p => m.id.includes(p)); return i < 0 ? 99 : i; };
  return [...free].sort((a, b) => rank(a) - rank(b) || json(b) - json(a) || (b.context_length || 0) - (a.context_length || 0))[0];
}

if (!free.length) { console.log("OpenRouter has no free text models right now. Use paid ones (see openrouter.ai/models)."); process.exit(1); }
const picks = { OPENROUTER_SMART_MODEL: best("smart"), OPENROUTER_FAST_MODEL: best("fast") };
for (const kind of ["code", "writing"]) for (const id of KIND[kind]) picks[`OPENROUTER_MODEL_${id.toUpperCase()}`] = best(kind);
for (const kind of ["code", "writing", "smart"]) for (const d of DEPT_KIND[kind]) picks[`OPENROUTER_MODEL_DEPT_${d.toUpperCase()}`] = best(kind);
// If the first choice is busy or out of free requests, OpenRouter tries these.
const backups = [...new Set(Object.values(picks).map(m => m.id))].slice(0, 3);
const fallback = free.filter(m => !backups.includes(m.id)).sort((a, b) => (b.context_length || 0) - (a.context_length || 0)).slice(0, 2).map(m => m.id);

const who = id => AGENTS.find(a => a.id === id);
console.log(`${free.length} free text models on OpenRouter today. Best pick for each job:\n`);
for (const [k, m] of Object.entries(picks)) {
  const a = who(k.replace("OPENROUTER_MODEL_", "").toLowerCase());
  const label = k === "OPENROUTER_SMART_MODEL" ? "Dia's big decisions" : k === "OPENROUTER_FAST_MODEL" ? "everyone else"
    : k.startsWith("OPENROUTER_MODEL_DEPT_") ? `anyone hired into ${k.slice(22).toLowerCase()}` : `${a.name}, ${a.role}`;
  console.log(`  ${(k + "=" + m.id).padEnd(72)} ${label}`);
}
console.log(`  ${("OPENROUTER_FALLBACK_MODELS=" + fallback.join(",")).padEnd(72)} backups when a model is busy`);

const images = all.filter(m => (m.architecture?.output_modalities || []).includes("image"));
if (images.length) {
  console.log("\nModels that make pictures (set IMAGE_PROVIDER=openrouter and OPENROUTER_IMAGE_MODEL):");
  for (const m of images.slice(0, 10)) console.log(`  ${m.id.padEnd(48)} ${isFree(m) ? "free" : "paid"}  ${m.name || ""}`);
}
console.log("\nFree models: about 50 requests a day in total, or about 1,000 a day once you've added $10 of credits.");

if (process.argv.includes("--save")) {
  let env = readFileSync(existsSync(envPath) ? envPath : root + ".env.example", "utf8");
  const set = (key, value) => { env = new RegExp(`^${key}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${key}=.*$`, "m"), () => `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`; };
  set("LLM_PROVIDER", "openrouter");
  for (const [k, m] of Object.entries(picks)) set(k, m.id);
  set("OPENROUTER_FALLBACK_MODELS", fallback.join(","));
  writeFileSync(envPath, env);
  console.log("\nSaved to .env. Restart the office (npm start) to use them.");
} else console.log("\nTo use these, run: npm run openrouter:models -- --save");
