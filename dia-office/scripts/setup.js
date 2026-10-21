// First-time setup that works the same on Windows, macOS and Linux: npm run setup
// Creates .env from .env.example with a fresh ADMIN_TOKEN.
// Optional: npm run setup -- "postgres://..."   sets the database
//           npm run setup -- anthropic           asks for your Anthropic API key (typed hidden) and turns Claude on
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = root + ".env";
const args = process.argv.slice(2);
const useAnthropic = args.includes("anthropic");
const dbUrl = args.find(a => a !== "anthropic");

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

if (existsSync(envPath) && !dbUrl && !useAnthropic) {
  const key = readFileSync(envPath, "utf8").match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
  if (key && key !== "change-me-to-a-long-random-string") {
    console.log(`.env already exists, so nothing was changed.\n  Director key: ${key}\nTo set the database, run: npm run setup -- "postgres://user:pass@host/db?sslmode=require"\nTo use Claude with an Anthropic API key, run: npm run setup -- anthropic`);
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
if (useAnthropic) {
  const key = await askHidden("Paste your Anthropic API key (it stays hidden) and press Enter: ");
  if (!key.startsWith("sk-ant-")) {
    console.log("That doesn't look like an Anthropic key (they start with sk-ant-). Nothing was changed.");
    process.exit(1);
  }
  env = setVar(env, "LLM_PROVIDER", "anthropic");
  env = setVar(env, "ANTHROPIC_API_KEY", key);
  if (!/^ANTHROPIC_FAST_MODEL=/m.test(env)) env = setVar(env, "ANTHROPIC_FAST_MODEL", "claude-sonnet-5-5");
  if (!/^ANTHROPIC_SMART_MODEL=/m.test(env)) env = setVar(env, "ANTHROPIC_SMART_MODEL", "claude-opus-5-5");
}
writeFileSync(envPath, env);

const k = env.match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim() || "";
console.log(`Saved .env
  Director key (paste it into the office page): ${token}
  Database: ${env.match(/^DATABASE_URL=(.*)$/m)?.[1]}
  AI: ${env.match(/^LLM_PROVIDER=(.*)$/m)?.[1]} (mock = free canned answers)${k.startsWith("sk-ant-") ? `\n  Anthropic key: saved (ending ...${k.slice(-4)})` : ""}

Next: npm start, then open http://localhost:${env.match(/^PORT=(.*)$/m)?.[1] || 8080}`);
