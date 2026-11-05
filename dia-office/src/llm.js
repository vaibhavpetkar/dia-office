// One door to the AI. Swap providers with LLM_PROVIDER: mock | ollama | anthropic | openrouter | bedrock.
// tier "fast" = everyday worker model (Sonnet / Haiku / small local), tier "smart" = strongest model for big decisions.
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import Anthropic from "@anthropic-ai/sdk";
import { q, one } from "./db.js";

const P = () => process.env.LLM_PROVIDER || "mock";
let bedrock;
const br = () => (bedrock ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION }));
let anthropic;
const an = () => (anthropic ??= new Anthropic()); // reads ANTHROPIC_API_KEY

// OpenRouter: one key (openrouter.ai/keys) for Claude, GPT, Gemini, Llama and more, through an OpenAI-style chat API.
export const OPENROUTER_URL = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
export const OPENROUTER_DEFAULTS = { fast: "anthropic/claude-sonnet-5.5", smart: "anthropic/claude-opus-5.5" };
// Each person on the team can have their own model, e.g. OPENROUTER_MODEL_TARA=qwen/qwen3-coder:free for websites,
// and each department too (OPENROUTER_MODEL_DEPT_QA), so people hired later get the right one automatically.
// Otherwise they use the fast or smart model. `npm run openrouter:models` suggests the best free model per role.
export function openRouterModel(tier, agent, dept) {
  const own = agent && process.env[`OPENROUTER_MODEL_${String(agent).toUpperCase()}`];
  if (own?.trim()) return own.trim();
  const team = agent === "dia" || !dept ? "" : process.env[`OPENROUTER_MODEL_DEPT_${String(dept).toUpperCase()}`];
  if (team?.trim()) return team.trim();
  return (tier === "smart" ? process.env.OPENROUTER_SMART_MODEL || OPENROUTER_DEFAULTS.smart : process.env.OPENROUTER_FAST_MODEL || OPENROUTER_DEFAULTS.fast).trim();
}
// Models OpenRouter tries next when the first is busy or out of free requests (comma separated, at most 2).
const openRouterFallbacks = () => (process.env.OPENROUTER_FALLBACK_MODELS || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 2);

const depts = new Map();
const deptOf = async agent => {
  if (!agent) return null;
  if (!depts.has(agent)) depts.set(agent, (await one("SELECT dept FROM agents WHERE id=$1", [agent]).catch(() => null))?.dept || null);
  return depts.get(agent);
};

const modelFor = async (tier, agent) => {
  if (P() === "openrouter") return openRouterModel(tier, agent, await deptOf(agent));
  if (P() === "bedrock") return tier === "smart" ? process.env.BEDROCK_SMART_MODEL_ID : process.env.BEDROCK_FAST_MODEL_ID;
  if (P() === "anthropic") return tier === "smart" ? process.env.ANTHROPIC_SMART_MODEL || "claude-opus-5-5" : process.env.ANTHROPIC_FAST_MODEL || "claude-sonnet-5-5";
  if (P() === "ollama") return tier === "smart" ? process.env.OLLAMA_SMART_MODEL : process.env.OLLAMA_FAST_MODEL;
  return "mock";
};

export async function monthSpendUSD() {
  const r = await one("SELECT COALESCE(SUM(cost_usd),0)::float AS s FROM llm_usage WHERE created_at >= date_trunc('month', now())");
  return r.s;
}

// Repeatable "random" numbers for mock mode: the same input always gives the same answer.
export function seeded(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Free models often wrap the JSON in thinking, ```json fences or a sentence before and after it,
// so this finds the first complete {...} object that parses, wherever it is in the reply.
export function parseJSON(text) {
  const t = String(text || "").replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/^[\s\S]*<\/think(?:ing)?>/i, "");
  try { const j = JSON.parse(t.trim()); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch {}
  let firstError;
  for (let a = t.indexOf("{"); a >= 0; a = t.indexOf("{", a + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(t.slice(a, i + 1)); } catch (e) { firstError ??= e; }
        break;
      }
    }
  }
  if (firstError) throw firstError;
  const said = t.replace(/\s+/g, " ").trim().slice(0, 80);
  throw new Error(`AI did not return JSON (${said ? `it said: "${said}${t.length > 80 ? "..." : ""}"` : "the reply was empty"})`);
}

/**
 * ask({ agent, tier, system, prompt, mock, maxTokens, need })
 * Returns parsed JSON. `mock` is a function returning the canned answer used in mock mode.
 * `need` lists keys the answer must have; a reply that isn't valid JSON or misses one is retried once.
 */
export async function ask({ agent, tier = "fast", system, prompt, mock, maxTokens = 900, need = [] }) {
  const budget = parseFloat(process.env.MONTHLY_AI_BUDGET_USD || "0");
  if (P() !== "mock" && budget > 0 && (await monthSpendUSD()) >= budget)
    throw new Error(`Monthly AI budget of $${budget} reached. Raise MONTHLY_AI_BUDGET_USD to continue.`);

  const model = await modelFor(tier, agent);
  const sys = system + "\nReply with ONE JSON object only, no markdown, no extra text.";
  const check = text => {
    const j = parseJSON(text);
    const miss = need.filter(k => j[k] === undefined || j[k] === null);
    if (miss.length) throw new Error(`AI answer is missing ${miss.join(", ")}`);
    return j;
  };
  try { return check(await callModel(agent, tier, model, sys, prompt, maxTokens, mock)); }
  catch (e) {
    if (P() === "mock" || !/JSON|missing|Unexpected|position/.test(e.message)) throw e;
    const retry = `${prompt}\n\nYour previous reply could not be used (${e.message}). Reply again with exactly the JSON object asked for.`;
    // A model that couldn't give JSON once usually can't twice, so with OpenRouter the retry goes to a backup
    // model first, with more room in case the first one spent its tokens thinking.
    const next = P() === "openrouter" ? openRouterFallbacks().find(m => m !== model) || model : model;
    return check(await callModel(agent, tier, next, sys, retry, maxTokens * 2, mock));
  }
}

async function callModel(agent, tier, model, sys, prompt, maxTokens, mock) {
  let text, inTok = 0, outTok = 0, reportedCost = null;
  if (P() === "mock") {
    await new Promise(r => setTimeout(r, process.env.MOCK_DELAY_MS ? Number(process.env.MOCK_DELAY_MS) : 900));
    text = JSON.stringify(mock ? mock() : {});
  } else if (P() === "ollama") {
    const res = await fetch(`${process.env.OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: false, format: "json", options: { temperature: 0.3, num_predict: maxTokens },
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] })
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    const j = await res.json();
    text = j.message?.content || "";
    inTok = j.prompt_eval_count || 0; outTok = j.eval_count || 0;
  } else if (P() === "anthropic") {
    // These models always think a little first; effort keeps that short, and the extra max_tokens leaves room for it
    // (only tokens actually used are billed). Fallbacks re-run a declined request on another Claude model.
    const effort = process.env[tier === "smart" ? "ANTHROPIC_SMART_EFFORT" : "ANTHROPIC_FAST_EFFORT"] || (tier === "smart" ? "medium" : "low");
    const res = await an().beta.messages.create({
      model, max_tokens: maxTokens + 8000,
      system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: { effort },
      ...(process.env.ANTHROPIC_FALLBACKS === "false" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    });
    if (res.stop_reason === "refusal") throw new Error(`Claude declined this request (${res.stop_details?.category || "policy"}).`);
    text = res.content.filter(c => c.type === "text").map(c => c.text).join("");
    const u = res.usage || {};
    inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    outTok = u.output_tokens || 0;
  } else if (P() === "openrouter") {
    const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${(process.env.OPENROUTER_API_KEY || "").trim()}`,
        "HTTP-Referer": process.env.PUBLIC_URL || "http://localhost:8080", // shows the app on your OpenRouter activity page
        "X-Title": "Dia Office"
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature: 0.3,
        ...(openRouterFallbacks().length ? { models: [model, ...openRouterFallbacks().filter(m => m !== model)] } : {}),
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        response_format: { type: "json_object" }, // models that can't force JSON ignore this; the retry above still covers them
        reasoning: { effort: "low" }, // thinking models: think briefly so the answer fits; others ignore this
        usage: { include: true } // ask OpenRouter to report the real cost of each call
      })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) {
      const msg = j.error?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error(`OpenRouter rejected the key (${msg}). Check OPENROUTER_API_KEY in .env.`);
      if (res.status === 429) throw new Error(`OpenRouter says ${model} is busy or its free requests for today are used up (${msg}). Set OPENROUTER_FALLBACK_MODELS, or add $10 of credits to raise the free limit.`);
      if (res.status === 402) throw new Error(`OpenRouter credits are used up (${msg}). Add credits at openrouter.ai/settings/credits.`);
      throw new Error(`OpenRouter error ${res.status} for model ${model}: ${msg}`);
    }
    const msg = j.choices?.[0]?.message || {};
    // Thinking models can spend all their tokens thinking and leave the answer empty; the JSON may still be there.
    text = msg.content || msg.reasoning || "";
    if (j.model) model = j.model; // the model that actually answered (a fallback, if the first was busy)
    inTok = j.usage?.prompt_tokens || 0; outTok = j.usage?.completion_tokens || 0;
    if (typeof j.usage?.cost === "number") reportedCost = j.usage.cost;
  } else {
    const system = [{ text: sys }];
    if (process.env.BEDROCK_PROMPT_CACHE === "true") system.push({ cachePoint: { type: "default" } });
    const res = await br().send(new ConverseCommand({
      modelId: model, system,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens, temperature: 0.3 }
    }));
    text = res.output?.message?.content?.map(c => c.text || "").join("") || "";
    inTok = res.usage?.inputTokens || 0; outTok = res.usage?.outputTokens || 0;
  }

  const pin = parseFloat(process.env[tier === "smart" ? "PRICE_SMART_IN" : "PRICE_FAST_IN"] || "0");
  const pout = parseFloat(process.env[tier === "smart" ? "PRICE_SMART_OUT" : "PRICE_FAST_OUT"] || "0");
  const cost = reportedCost ?? (["bedrock", "anthropic", "openrouter"].includes(P()) ? (inTok * pin + outTok * pout) / 1e6 : 0);
  await q("INSERT INTO llm_usage (agent_id,model,input_tokens,output_tokens,cost_usd) VALUES ($1,$2,$3,$4,$5)",
    [agent, model, inTok, outTok, cost]);
  return text;
}

// Embeddings for the company knowledge base.
export async function embed(text) {
  const dim = parseInt(process.env.EMBED_DIM || "768", 10);
  if (P() === "mock" || P() === "anthropic" || P() === "openrouter") {
    // Cheap hashed bag-of-words vector so search still roughly works without any AI
    // (the Anthropic API has no embeddings model, so it uses this too; so does OpenRouter, to keep one setup).
    const v = new Array(dim).fill(0);
    for (const w of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
      let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % dim] += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map(x => x / n);
  }
  if (P() === "ollama") {
    const res = await fetch(`${process.env.OLLAMA_URL}/api/embeddings`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.OLLAMA_EMBED_MODEL, prompt: text })
    });
    if (!res.ok) throw new Error(`Ollama embed error ${res.status}`);
    return (await res.json()).embedding;
  }
  const res = await br().send(new InvokeModelCommand({
    modelId: process.env.BEDROCK_EMBED_MODEL_ID, contentType: "application/json", accept: "application/json",
    body: JSON.stringify({ inputText: text.slice(0, 8000), dimensions: dim, normalize: true })
  }));
  return JSON.parse(new TextDecoder().decode(res.body)).embedding;
}
