// One door to the AI. Swap providers with LLM_PROVIDER: mock | ollama | anthropic | bedrock.
// tier "fast" = everyday worker model (Sonnet / Haiku / small local), tier "smart" = strongest model for big decisions,
// tier "code" = websites and code fixes (its own model on Ollama, the smart model everywhere else).
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import Anthropic from "@anthropic-ai/sdk";
import { q, one } from "./db.js";

const P = () => process.env.LLM_PROVIDER || "mock";
let bedrock;
const br = () => (bedrock ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION }));
let anthropic;
const an = () => (anthropic ??= new Anthropic()); // reads ANTHROPIC_API_KEY

const big = tier => tier !== "fast"; // "smart" and "code" both get the strong model, its effort and its prices

const modelFor = tier => {
  if (P() === "bedrock") return big(tier) ? process.env.BEDROCK_SMART_MODEL_ID : process.env.BEDROCK_FAST_MODEL_ID;
  if (P() === "anthropic") return big(tier) ? process.env.ANTHROPIC_SMART_MODEL || "claude-opus-5-5" : process.env.ANTHROPIC_FAST_MODEL || "claude-sonnet-5-5";
  if (P() === "ollama") {
    if (tier === "code") return process.env.OLLAMA_CODE_MODEL || process.env.OLLAMA_SMART_MODEL;
    return tier === "smart" ? process.env.OLLAMA_SMART_MODEL : process.env.OLLAMA_FAST_MODEL;
  }
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

function parseJSON(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("AI did not return JSON");
  return JSON.parse(text.slice(a, b + 1));
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

  const model = modelFor(tier);
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
    return check(await callModel(agent, tier, model, sys, retry, maxTokens, mock));
  }
}

async function callModel(agent, tier, model, sys, prompt, maxTokens, mock) {
  let text, inTok = 0, outTok = 0;
  if (P() === "mock") {
    await new Promise(r => setTimeout(r, process.env.MOCK_DELAY_MS ? Number(process.env.MOCK_DELAY_MS) : 900));
    text = JSON.stringify(mock ? mock() : {});
  } else if (P() === "ollama") {
    ({ text, inTok, outTok } = await ollamaChat(model, tier, sys, prompt, maxTokens));
  } else if (P() === "anthropic") {
    // These models always think a little first; effort keeps that short, and the extra max_tokens leaves room for it
    // (only tokens actually used are billed). Fallbacks re-run a declined request on another Claude model.
    const effort = process.env[big(tier) ? "ANTHROPIC_SMART_EFFORT" : "ANTHROPIC_FAST_EFFORT"] || (big(tier) ? "medium" : "low");
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

  const pin = parseFloat(process.env[big(tier) ? "PRICE_SMART_IN" : "PRICE_FAST_IN"] || "0");
  const pout = parseFloat(process.env[big(tier) ? "PRICE_SMART_OUT" : "PRICE_FAST_OUT"] || "0");
  const cost = P() === "bedrock" || P() === "anthropic" ? (inTok * pin + outTok * pout) / 1e6 : 0;
  await q("INSERT INTO llm_usage (agent_id,model,input_tokens,output_tokens,cost_usd) VALUES ($1,$2,$3,$4,$5)",
    [agent, model, inTok, outTok, cost]);
  return text;
}

// Local models through Ollama. Three things make them answer far better than Ollama's defaults:
// a big context window (the default 4K cuts off long prompts without saying so), letting reasoning models
// think before the smart and code steps, and keeping models loaded between steps. The answer is streamed
// so a slow PC never hits a timeout while the model is still working.
const ollamaOpts = () => ({ keep_alive: process.env.OLLAMA_KEEP_ALIVE || "30m" });

async function ollamaChat(model, tier, sys, prompt, maxTokens) {
  const wantThink = big(tier) && process.env.OLLAMA_THINK !== "false";
  const send = think => fetch(`${process.env.OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, format: "json", ...ollamaOpts(), ...(think ? { think: true } : {}),
      // Thinking counts toward num_predict, so leave it room.
      options: { temperature: 0.3, num_predict: maxTokens + (think ? 4000 : 0), num_ctx: parseInt(process.env.OLLAMA_NUM_CTX || "16384", 10) },
      messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] })
  });
  let res = await send(wantThink);
  if (!res.ok && wantThink && res.status === 400) {
    const err = await res.text();
    if (!/think/i.test(err)) throw new Error(`Ollama error 400: ${err}`);
    res = await send(false); // this model can't think; ask it plainly
  }
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);

  let text = "", buf = "", last = {};
  const dec = new TextDecoder();
  const line = l => {
    if (!l.trim()) return;
    const j = JSON.parse(l);
    if (j.error) throw new Error(`Ollama error: ${j.error}`);
    text += j.message?.content || "";
    if (j.done) last = j;
  };
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  line(buf);
  return { text, inTok: last.prompt_eval_count || 0, outTok: last.eval_count || 0 };
}

// Which embedder made a stored vector. Vectors from different embedders can't be compared, so the
// knowledge base re-embeds its documents when this changes (for example after switching to Ollama).
export const embedderId = () =>
  P() === "ollama" ? `ollama:${process.env.OLLAMA_EMBED_MODEL}` :
  P() === "bedrock" ? `bedrock:${process.env.BEDROCK_EMBED_MODEL_ID}` : "words";

// Embeddings for the company knowledge base.
export async function embed(text) {
  const dim = parseInt(process.env.EMBED_DIM || "768", 10);
  if (P() === "mock" || P() === "anthropic") {
    // Cheap hashed bag-of-words vector so search still roughly works without any AI
    // (the Anthropic API has no embeddings model, so it uses this too).
    const v = new Array(dim).fill(0);
    for (const w of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
      let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % dim] += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map(x => x / n);
  }
  if (P() === "ollama") {
    // Ask for exactly EMBED_DIM numbers so the database never needs changing (qwen3-embedding can shrink its
    // vectors to any size). Models that can't, like nomic-embed-text, are asked again without it.
    const model = process.env.OLLAMA_EMBED_MODEL;
    const send = sized => fetch(`${process.env.OLLAMA_URL}/api/embed`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: text, truncate: true, ...ollamaOpts(), ...(sized ? { dimensions: dim } : {}) })
    });
    let res = await send(true);
    if (res.status === 400) res = await send(false);
    if (!res.ok) throw new Error(`Ollama embed error ${res.status}: ${await res.text()}`);
    const v = (await res.json()).embeddings?.[0] || [];
    if (v.length !== dim) throw new Error(`${model} gives ${v.length} numbers per text but EMBED_DIM is ${dim}. Use qwen3-embedding, or set EMBED_DIM to ${v.length} before the first run.`);
    return v;
  }
  const res = await br().send(new InvokeModelCommand({
    modelId: process.env.BEDROCK_EMBED_MODEL_ID, contentType: "application/json", accept: "application/json",
    body: JSON.stringify({ inputText: text.slice(0, 8000), dimensions: dim, normalize: true })
  }));
  return JSON.parse(new TextDecoder().decode(res.body)).embedding;
}
