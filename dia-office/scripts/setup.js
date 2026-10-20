// First-time setup that works the same on Windows, macOS and Linux: npm run setup
// Creates .env from .env.example with a fresh ADMIN_TOKEN. Optional: npm run setup -- "postgres://..."
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = root + ".env";
const dbUrl = process.argv[2];

if (existsSync(envPath) && !dbUrl) {
  const key = readFileSync(envPath, "utf8").match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
  if (key && key !== "change-me-to-a-long-random-string") {
    console.log(`.env already exists, so nothing was changed.\n  Director key: ${key}\nTo set the database, run: npm run setup -- "postgres://user:pass@host/db?sslmode=require"`);
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
writeFileSync(envPath, env);

console.log(`Saved .env
  Director key (paste it into the office page): ${token}
  Database: ${env.match(/^DATABASE_URL=(.*)$/m)?.[1]}
  AI: ${env.match(/^LLM_PROVIDER=(.*)$/m)?.[1]} (mock = free canned answers)

Next: npm start, then open http://localhost:${env.match(/^PORT=(.*)$/m)?.[1] || 8080}`);
