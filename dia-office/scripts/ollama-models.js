// Ollama model sets, sized by how much memory the PC has. Used by: npm run setup -- ollama [small|medium|large]
// fast  = everyday team work and chatting with you (Gemma: strongest local model for Hindi and Marathi)
// smart = Dia's big decisions (reasoning models that think first)
// code  = websites and code fixes
// embed = knowledge-base search, 100+ languages (shrunk to EMBED_DIM numbers, so the database never changes)
// ctx   = how much text a model can read at once; more needs more memory
import { totalmem } from "node:os";

export const PRESETS = {
  small: { label: "under 16 GB memory", fast: "gemma3:4b", smart: "qwen3:8b", code: "qwen2.5-coder:7b", embed: "qwen3-embedding:0.6b", ctx: 8192 },
  medium: { label: "16-31 GB memory", fast: "gemma3:12b", smart: "gpt-oss:20b", code: "qwen2.5-coder:14b", embed: "qwen3-embedding:0.6b", ctx: 16384 },
  large: { label: "32 GB+ memory or a 24 GB graphics card", fast: "gemma3:12b", smart: "qwen3.5:27b", code: "qwen3-coder:30b", embed: "qwen3-embedding:4b", ctx: 32768 }
};

export const presetFor = (gb = totalmem() / 2 ** 30) => (gb < 15 ? "small" : gb < 31 ? "medium" : "large");

export const ENV_KEYS = { fast: "OLLAMA_FAST_MODEL", smart: "OLLAMA_SMART_MODEL", code: "OLLAMA_CODE_MODEL", embed: "OLLAMA_EMBED_MODEL", ctx: "OLLAMA_NUM_CTX" };
