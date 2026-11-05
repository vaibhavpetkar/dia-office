// First-time setup that works the same on Windows, macOS and Linux: npm run setup
// Creates .env from .env.example with a fresh ADMIN_TOKEN.
// Optional: npm run setup -- "postgres://..."   sets the database
//           npm run setup -- anthropic           asks for your Anthropic API key (typed hidden) and turns Claude on
//           npm run setup -- openrouter          asks for your OpenRouter key (typed hidden) and turns OpenRouter on
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = root + ".env";
const args = process.argv.slice(2);
const useAnthropic = args.includes("anthropic");
const useOpenRouter = args.includes("openrouter");
const dbUrl = args.find(a => a !== "anthropic" && a !== "openrouter");

// Reads a line without showing it, so the key never appears on screen or in shell history.
function askHidden(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (!rl.muted) rl.output.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
    rl.muted = true;
  });
}

// Sets KEY=value, adding the line if an older .env doesn't have it yet.
const setVar = (env, key, value) => new RegExp(`^${key}=.*$`, "m").test(env)
  ? env.replace(new RegExp(`^${key}=.*$`, "m"), () => `${key}=${value}`)
  : `${env.trimEnd()}\n${key}=${value}\n`;

if (existsSync(envPath) && !dbUrl && !useAnthropic && !useOpenRouter) {
  const key = readFileSync(envPath, "utf8").match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
  if (key && key !== "change-me-to-a-long-random-string") {
    console.log(`.env already exists, so nothing was changed.\n  Director key: ${key}\nTo set the database, run: npm run setup -- "postgres://user:pass@host/db?sslmode=require"\nTo use Claude with an Anthropic API key, run: npm run setup -- anthropic\nTo use OpenRouter (free and paid models), run: npm run setup -- openrouter`);
    process.exit(0);
  }
}

let env = readFileSync(existsSync(envPath) ? envPath : root + ".env.example", "utf8");
let token = env.match(/^ADMIN_TOKEN=(.*)$/m)?.[1];
if (!token || token === "change-me-to-a-long-random-string") {
  token = randomBytes(24).toString("hex");
  env = env.replace(/^ADMIN_TOKEN=.*$/m, `ADMIN_TOKEN=${token}`);
}
if (dbUrl) env = env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${dbUrl}`);
// Asks for a key, or keeps the one already in .env when you just press Enter. Pasting on Windows can add
// invisible characters (bracketed-paste markers, a stray \r), so the key is picked out of whatever arrived.
async function askKey(name, prefix, envKey) {
  const saved = env.match(new RegExp(`^${envKey}=(.*)$`, "m"))?.[1]?.trim() || "";
  const have = saved.startsWith(prefix);
  const typed = await askHidden(`Paste your ${name} key (it stays hidden; right-click pastes in cmd) and press Enter${have ? ` to replace the saved one, or just Enter to keep it (ending ...${saved.slice(-4)})` : ""}: `);
  const key = typed.match(new RegExp(`${prefix.replace(/-/g, "\\-")}[A-Za-z0-9_\\-]+`))?.[0];
  if (key) return key;
  if (!typed && have) return saved;
  console.log(`${typed ? `That doesn't look like a ${name} key (they start with ${prefix}).` : "Nothing was pasted."} Nothing was changed.\n` +
    `Another way: open .env in Notepad, put the key after ${envKey}= and save, then run this again and just press Enter.`);
  process.exit(1);
}
if (useAnthropic) {
  const key = await askKey("Anthropic API", "sk-ant-", "ANTHROPIC_API_KEY");
  env = setVar(env, "LLM_PROVIDER", "anthropic");
  env = setVar(env, "ANTHROPIC_API_KEY", key);
  if (!/^ANTHROPIC_FAST_MODEL=/m.test(env)) env = setVar(env, "ANTHROPIC_FAST_MODEL", "claude-sonnet-5-5");
  if (!/^ANTHROPIC_SMART_MODEL=/m.test(env)) env = setVar(env, "ANTHROPIC_SMART_MODEL", "claude-opus-5-5");
}
if (useOpenRouter) {
  const key = await askKey("OpenRouter", "sk-or-", "OPENROUTER_API_KEY");
  env = setVar(env, "LLM_PROVIDER", "openrouter");
  env = setVar(env, "OPENROUTER_API_KEY", key);
}
writeFileSync(envPath, env);

const k = env.match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim() || "";
const ork = env.match(/^OPENROUTER_API_KEY=(.*)$/m)?.[1]?.trim() || "";
console.log(`Saved .env
  Director key (paste it into the office page): ${token}
  Database: ${env.match(/^DATABASE_URL=(.*)$/m)?.[1]}
  AI: ${env.match(/^LLM_PROVIDER=(.*)$/m)?.[1]} (mock = free canned answers)${k.startsWith("sk-ant-") ? `\n  Anthropic key: saved (ending ...${k.slice(-4)})` : ""}${ork.startsWith("sk-or-") ? `\n  OpenRouter key: saved (ending ...${ork.slice(-4)})` : ""}

${useOpenRouter ? "Pick the best free model for each job: npm run openrouter:models -- --save\n" : ""}Next: npm start, then open http://localhost:${env.match(/^PORT=(.*)$/m)?.[1] || 8080}`);
