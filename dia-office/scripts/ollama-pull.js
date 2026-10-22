// Downloads every Ollama model named in .env: npm run ollama:pull
// Ollama must be running (it starts with the Ollama app, or run: ollama serve).
import "dotenv/config";

const url = process.env.OLLAMA_URL || "http://localhost:11434";
const models = [...new Set(["OLLAMA_FAST_MODEL", "OLLAMA_SMART_MODEL", "OLLAMA_CODE_MODEL", "OLLAMA_EMBED_MODEL"]
  .map(k => process.env[k]).filter(Boolean))];
if (!models.length) { console.log("No Ollama models in .env. Run: npm run setup -- ollama"); process.exit(1); }

for (const model of models) {
  process.stdout.write(`${model}: starting...`);
  let res;
  try { res = await fetch(`${url}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }) }); }
  catch { console.log(`\nOllama is not answering at ${url}. Open the Ollama app (or run: ollama serve) and try again.`); process.exit(1); }
  if (!res.ok) { console.log(`\n${model}: ${res.status} ${await res.text()}`); process.exit(1); }
  let buf = "", last = "";
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.error) { console.log(`\n${model}: ${j.error}`); process.exit(1); }
      const pct = j.total ? ` ${Math.floor((j.completed || 0) / j.total * 100)}%` : "";
      const msg = `${j.status}${pct}`;
      if (msg !== last) { process.stdout.write(`\r${model}: ${msg}`.padEnd(70)); last = msg; }
    }
  }
  console.log(`\r${model}: ready`.padEnd(70));
}
console.log("All models downloaded. Start the office with: npm start");
