// One door to the AI. Swap providers with LLM_PROVIDER: mock | ollama | bedrock.
// tier "fast" = cheap model (Haiku / small local), tier "smart" = Sonnet for big decisions.
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { q, one } from "./db.js";

const P = () => process.env.LLM_PROVIDER || "mock";
let bedrock;
const br = () => (bedrock ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION }));

const modelFor = tier => {
  if (P() === "bedrock") return tier === "smart" ? process.env.BEDROCK_SMART_MODEL_ID : process.env.BEDROCK_FAST_MODEL_ID;
  if (P() === "ollama") return tier === "smart" ? process.env.OLLAMA_SMART_MODEL : process.env.OLLAMA_FAST_MODEL;
  return "mock";
};

export async function monthSpendUSD() {
  const r = await one("SELECT COALESCE(SUM(cost_usd),0)::float AS s FROM llm_usage WHERE created_at >= date_trunc('month', now())");
  return r.s;
}

function parseJSON(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("AI did not return JSON");
  return JSON.parse(text.slice(a, b + 1));
}

/**
 * ask({ agent, tier, system, prompt, mock, maxTokens })
 * Returns parsed JSON. `mock` is a function returning the canned answer used in mock mode.
 */
export async function ask({ agent, tier = "fast", system, prompt, mock, maxTokens = 900 }) {
  const budget = parseFloat(process.env.MONTHLY_AI_BUDGET_USD || "0");
  if (P() !== "mock" && budget > 0 && (await monthSpendUSD()) >= budget)
    throw new Error(`Monthly AI budget of $${budget} reached. Raise MONTHLY_AI_BUDGET_USD to continue.`);

  const model = modelFor(tier);
  const sys = system + "\nReply with ONE JSON object only, no markdown, no extra text.";
  let text, inTok = 0, outTok = 0;

  if (P() === "mock") {
    await new Promise(r => setTimeout(r, 900));
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
  const cost = P() === "bedrock" ? (inTok * pin + outTok * pout) / 1e6 : 0;
  await q("INSERT INTO llm_usage (agent_id,model,input_tokens,output_tokens,cost_usd) VALUES ($1,$2,$3,$4,$5)",
    [agent, model, inTok, outTok, cost]);

  return parseJSON(text);
}

// Embeddings for the company knowledge base.
export async function embed(text) {
  const dim = parseInt(process.env.EMBED_DIM || "768", 10);
  if (P() === "mock") {
    // Cheap hashed bag-of-words vector so search still roughly works without any AI.
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
