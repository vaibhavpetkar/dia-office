// OpenRouter provider against a fake OpenRouter server: model per team member, backups, real cost, pictures.
// Needs the same throwaway Postgres as office.test.js (TEST_DATABASE_URL), and wipes it first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import pg from "pg";

const DB = process.env.TEST_DATABASE_URL || "postgres://dia:dia@localhost:5432/dia_test";
const seen = [];
let fake, llm, media, dbm;

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

before(async () => {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();

  fake = createServer((req, res) => {
    let body = "";
    req.on("data", d => (body += d));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      seen.push({ auth: req.headers.authorization, ...j });
      res.setHeader("content-type", "application/json");
      if (j.model === "busy/model:free") { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day" } })); }
      if (j.model === "chatty/model:free")
        return res.end(JSON.stringify({ model: j.model, choices: [{ message: { content: "Sure! I can help with that lead." } }], usage: {} }));
      if (j.model === "thinker/model:free")
        return res.end(JSON.stringify({ model: j.model, choices: [{ message: { content: "", reasoning: 'Plan {draft}. Final: {"reply":"from thinking"}' } }], usage: {} }));
      if (j.modalities?.includes("image"))
        return res.end(JSON.stringify({ model: j.model, choices: [{ message: { content: "", images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } }] } }], usage: { cost: 0.039 } }));
      res.end(JSON.stringify({ model: j.models?.[1] || j.model, choices: [{ message: { content: '{"reply":"hello"}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 8, cost: j.model.endsWith(":free") ? 0 : 0.0012 } }));
    });
  });
  await new Promise(r => fake.listen(0, "127.0.0.1", r));

  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: "/nonexistent", DATABASE_URL: DB, LLM_PROVIDER: "openrouter", IMAGE_PROVIDER: "openrouter",
    OPENROUTER_BASE_URL: `http://127.0.0.1:${fake.address().port}/api/v1`, OPENROUTER_API_KEY: "sk-or-test-key",
    OPENROUTER_FAST_MODEL: "openai/gpt-oss-120b", OPENROUTER_SMART_MODEL: "deepseek/deepseek-r1:free",
    OPENROUTER_MODEL_TARA: "qwen/qwen3-coder:free", MONTHLY_AI_BUDGET_USD: "0"
  });
  dbm = await import("../src/db.js");
  await dbm.migrate();
  llm = await import("../src/llm.js");
  media = await import("../src/media.js");
});
after(async () => { fake?.close(); await dbm?.pool.end(); });

const lastUsage = () => dbm.one("SELECT agent_id, model, input_tokens, output_tokens, cost_usd::float AS cost FROM llm_usage ORDER BY id DESC LIMIT 1");

test("fast and smart tiers use their own models and the key", async () => {
  const a = await llm.ask({ agent: "pooja", tier: "fast", system: "s", prompt: "p", need: ["reply"] });
  assert.equal(a.reply, "hello");
  const call = seen.at(-1);
  assert.equal(call.model, "openai/gpt-oss-120b");
  assert.equal(call.auth, "Bearer sk-or-test-key");
  assert.deepEqual(call.response_format, { type: "json_object" });
  assert.equal(call.models, undefined, "no backups unless set");
  const u = await lastUsage();
  assert.equal(u.model, "openai/gpt-oss-120b");
  assert.equal(u.input_tokens, 120);
  assert.equal(u.cost, 0.0012, "uses the cost OpenRouter reports");

  await llm.ask({ agent: "dia", tier: "smart", system: "s", prompt: "p" });
  assert.equal(seen.at(-1).model, "deepseek/deepseek-r1:free");
  assert.equal((await lastUsage()).cost, 0, "free models cost nothing");
});

test("a team member can have their own model", async () => {
  await llm.ask({ agent: "tara", tier: "fast", system: "s", prompt: "p" });
  assert.equal(seen.at(-1).model, "qwen/qwen3-coder:free");
});

test("people hired into a department use that department's model", async () => {
  await dbm.q("INSERT INTO agents (id,name,role,dept,kind,monthly_cost,look) VALUES ('rhea','Rhea','UI Tester','qa','ai',0,'{}') ON CONFLICT (id) DO NOTHING");
  process.env.OPENROUTER_MODEL_DEPT_QA = "qwen/qwen3-coder:free";
  try {
    await llm.ask({ agent: "rhea", tier: "fast", system: "s", prompt: "p" });
    assert.equal(seen.at(-1).model, "qwen/qwen3-coder:free");
    await llm.ask({ agent: "dia", tier: "fast", system: "s", prompt: "p" });
    assert.equal(seen.at(-1).model, "openai/gpt-oss-120b", "Dia keeps the fast/smart models");
  } finally { delete process.env.OPENROUTER_MODEL_DEPT_QA; }
});

test("backups are sent, and the model that answered is recorded", async () => {
  process.env.OPENROUTER_FALLBACK_MODELS = "meta-llama/llama-3.3-70b-instruct:free, google/gemma-3-27b-it:free, x/y";
  try {
    await llm.ask({ agent: "kavya", tier: "fast", system: "s", prompt: "p" });
    assert.deepEqual(seen.at(-1).models, ["openai/gpt-oss-120b", "meta-llama/llama-3.3-70b-instruct:free", "google/gemma-3-27b-it:free"]);
    assert.equal((await lastUsage()).model, "meta-llama/llama-3.3-70b-instruct:free");
  } finally { delete process.env.OPENROUTER_FALLBACK_MODELS; }
});

test("out of free requests gives a clear message", async () => {
  process.env.OPENROUTER_MODEL_KAVYA = "busy/model:free";
  try {
    await assert.rejects(llm.ask({ agent: "kavya", tier: "fast", system: "s", prompt: "p" }), /free requests for today are used up/);
  } finally { delete process.env.OPENROUTER_MODEL_KAVYA; }
});

test("pictures come from the OpenRouter image model", async () => {
  const m = await media.generateImage({ taskId: null, prompt: "red shoe poster", caption: "Shoe", agent: "pooja" });
  assert.equal(m.mime, "image/png");
  const call = seen.at(-1);
  assert.equal(call.model, "google/gemini-2.5-flash-image");
  assert.deepEqual(call.modalities, ["image", "text"]);
  const saved = await media.getMedia(m.id);
  assert.deepEqual(Buffer.from(saved.data), PNG);
  const u = await lastUsage();
  assert.equal(u.model, "google/gemini-2.5-flash-image");
  assert.equal(u.cost, 0.039);
});

test("JSON is found inside thinking, fences and chatter", () => {
  assert.deepEqual(llm.parseJSON('<think>maybe {a} or {"x":1}</think>\nHere you go:\n```json\n{"reply":"hi","n":{"a":"}"}}\n```\nThanks!'), { reply: "hi", n: { a: "}" } });
  assert.deepEqual(llm.parseJSON('Note {not json} then {"ok":true}'), { ok: true });
  assert.throws(() => llm.parseJSON("Sure! I can help."), /did not return JSON \(it said: "Sure! I can help\."\)/);
  assert.throws(() => llm.parseJSON(""), /reply was empty/);
});

test("a model that answers without JSON is retried on a backup model", async () => {
  process.env.OPENROUTER_MODEL_SAMEER = "chatty/model:free";
  process.env.OPENROUTER_FALLBACK_MODELS = "openai/gpt-oss-120b";
  try {
    const a = await llm.ask({ agent: "sameer", tier: "fast", system: "s", prompt: "p", need: ["reply"], maxTokens: 500 });
    assert.equal(a.reply, "hello");
    assert.equal(seen.at(-1).model, "openai/gpt-oss-120b");
    assert.equal(seen.at(-1).max_tokens, 1000, "the retry gets more room");
    assert.deepEqual(seen.at(-1).reasoning, { effort: "low" });
  } finally { delete process.env.OPENROUTER_MODEL_SAMEER; delete process.env.OPENROUTER_FALLBACK_MODELS; }
});

test("a thinking model's answer is used when its reply text is empty", async () => {
  process.env.OPENROUTER_MODEL_SAMEER = "thinker/model:free";
  try {
    const a = await llm.ask({ agent: "sameer", tier: "fast", system: "s", prompt: "p", need: ["reply"] });
    assert.equal(a.reply, "from thinking");
  } finally { delete process.env.OPENROUTER_MODEL_SAMEER; }
});
