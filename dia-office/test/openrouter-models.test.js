// The free-model picker: reads OpenRouter's model list (a fake one here) and never picks stealth, music or paid models.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const free = { prompt: "0", completion: "0" }, text = { input_modalities: ["text"], output_modalities: ["text"] };
const MODELS = [
  { id: "stealth/crouton-alpha", name: "Crouton Alpha", pricing: free, context_length: 1000000, architecture: text },
  { id: "google/lyria-3-pro-preview", name: "Lyria 3", pricing: free, context_length: 900000, architecture: { input_modalities: ["text"], output_modalities: ["audio", "text"] } },
  { id: "anthropic/claude-sonnet-5.5", pricing: { prompt: "0.000003", completion: "0.000015" }, context_length: 1000000, architecture: text },
  { id: "google/gemma-4-26b-a4b-it:free", pricing: free, context_length: 128000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
  { id: "openai/gpt-oss-120b:free", pricing: free, context_length: 128000, architecture: text },
  { id: "qwen/qwen3-coder:free", pricing: free, context_length: 256000, architecture: text },
  { id: "meta-llama/llama-3.3-70b-instruct:free", pricing: free, context_length: 64000, architecture: text }
];

test("the picker skips stealth, music and paid models, and backs up with real chat models", async () => {
  const server = createServer((_req, res) => res.end(JSON.stringify({ data: MODELS }))).listen(0);
  const port = server.address().port;
  try {
    const out = await new Promise((resolve, reject) => execFile(process.execPath, ["scripts/openrouter-models.js"],
      { cwd: root, env: { ...process.env, OPENROUTER_BASE_URL: `http://localhost:${port}` } }, (e, so, se) => (e ? reject(new Error(se || e.message)) : resolve(so))));
    const pick = k => out.match(new RegExp(`^\\s*${k}=(\\S*)`, "m"))?.[1];
    assert.match(out, /4 free text models/);
    assert.doesNotMatch(out.split("Models that make pictures")[0], /stealth|lyria|claude/);
    assert.equal(pick("OPENROUTER_MODEL_TARA"), "qwen/qwen3-coder:free");
    assert.equal(pick("OPENROUTER_SMART_MODEL"), "openai/gpt-oss-120b:free");
    assert.ok(pick("OPENROUTER_FALLBACK_MODELS").split(",").every(id => MODELS.find(m => m.id === id)?.architecture.output_modalities.join() === "text"));
  } finally { server.close(); }
});
