// Ollama provider tests against a fake Ollama server: per-task models, context size, thinking (and the retry for
// models that can't think), streamed answers, sized embeddings and the knowledge-base re-embed after a switch.
// Needs the same throwaway Postgres as office.test.js (TEST_DATABASE_URL), and wipes it first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const DB = process.env.TEST_DATABASE_URL || "postgres://dia:dia@localhost:5432/dia_test";
const PORT = 8098;
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: "/nonexistent", DATABASE_URL: DB, LLM_PROVIDER: "ollama", OLLAMA_URL: `http://localhost:${PORT}`,
  OLLAMA_FAST_MODEL: "fast-model", OLLAMA_SMART_MODEL: "plain-model", OLLAMA_CODE_MODEL: "coder-model",
  OLLAMA_EMBED_MODEL: "fixed-embed", EMBED_DIM: "768", MONTHLY_AI_BUDGET_USD: "0"
});
const { migrate, pool } = await import("../src/db.js");
const { ask, embed, embedderId } = await import("../src/llm.js");
const { addDoc, search, reindex } = await import("../src/kb.js");

// Word-hash vectors, so texts sharing words land close together.
const vector = (text, dim) => {
  const v = new Array(dim).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) || []) { let h = 7; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % dim] += 1; }
  return v;
};

const seen = [];
let fake;
before(async () => {
  fake = createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    seen.push({ path: req.url, body });
    if (req.url === "/api/chat") {
      // plain-model can't think, like Gemma: Ollama refuses the think flag with a 400.
      if (body.think && body.model === "plain-model") { res.writeHead(400); return res.end(JSON.stringify({ error: `"plain-model" does not support thinking` })); }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(JSON.stringify({ message: { role: "assistant", content: '{"reply":' } }) + "\n");
      return res.end(JSON.stringify({ message: { role: "assistant", content: `"from ${body.model}"}` }, done: true, prompt_eval_count: 11, eval_count: 4 }) + "\n");
    }
    if (req.url === "/api/embed") {
      // fixed-embed can't shrink its vectors (like nomic-embed-text), so a sized request is refused.
      if (body.dimensions) { res.writeHead(400); return res.end(JSON.stringify({ error: "this model does not support dimensions" })); }
      return res.end(JSON.stringify({ embeddings: [vector(body.input, 768)] }));
    }
    res.writeHead(404); res.end("{}");
  }).listen(PORT);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
});
after(async () => { fake?.close(); await pool.end(); });

const lastChat = () => seen.filter(s => s.path === "/api/chat").at(-1).body;

test("fast tier: its own model, big context, no thinking, streamed JSON put back together", async () => {
  const out = await ask({ agent: "dia", tier: "fast", system: "s", prompt: "hi", need: ["reply"] });
  assert.equal(out.reply, "from fast-model");
  const b = lastChat();
  assert.equal(b.stream, true); assert.equal(b.format, "json"); assert.equal(b.think, undefined);
  assert.equal(b.options.num_ctx, 16384); assert.equal(b.keep_alive, "30m");
  const u = (await pool.query("SELECT model, input_tokens, output_tokens, cost_usd::float AS cost_usd FROM llm_usage ORDER BY id DESC LIMIT 1")).rows[0];
  assert.deepEqual(u, { model: "fast-model", input_tokens: 11, output_tokens: 4, cost_usd: 0 });
});

test("code tier thinks with the code model; smart tier retries without thinking when the model can't", async () => {
  assert.equal((await ask({ agent: "tara", tier: "code", system: "s", prompt: "build", need: ["reply"] })).reply, "from coder-model");
  assert.equal(lastChat().think, true);
  assert.ok(lastChat().options.num_predict > 4000, "room left for thinking");
  const before = seen.length;
  assert.equal((await ask({ agent: "dia", tier: "smart", system: "s", prompt: "decide", need: ["reply"] })).reply, "from plain-model");
  const tries = seen.slice(before).filter(s => s.path === "/api/chat").map(s => s.body.think);
  assert.deepEqual(tries, [true, undefined]);
});

test("embeddings ask for EMBED_DIM numbers and fall back for models that can't resize", async () => {
  const before = seen.length;
  const v = await embed("paid leaves");
  assert.equal(v.length, 768);
  assert.deepEqual(seen.slice(before).map(s => s.body.dimensions), [768, undefined]);
});

test("knowledge base re-embeds documents made by another embedder", async () => {
  await addDoc("Leave policy", "18 paid leaves a year.");
  // A chunk left over from the free word-match search, before switching to Ollama.
  await pool.query("INSERT INTO kb_chunks (title, content, embedding, embedder) VALUES ('Hours', 'Office hours are 10am to 7pm.', $1, 'words')",
    [`[${new Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",")}]`]);
  assert.equal(await reindex(), 1);
  assert.equal(await reindex(), 0, "nothing left to redo");
  const { rows } = await pool.query("SELECT DISTINCT embedder FROM kb_chunks");
  assert.deepEqual(rows.map(r => r.embedder), [embedderId()]);
  assert.equal((await search("office hours", 1))[0].title, "Hours");
});
