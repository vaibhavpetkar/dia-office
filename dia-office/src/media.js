// Pictures for the teams. IMAGE_PROVIDER: mock | bedrock | openrouter.
// mock draws a simple poster (SVG) so the whole flow runs free; bedrock uses Amazon Nova Canvas;
// openrouter uses any image model there, e.g. Google's Nano Banana (OPENROUTER_IMAGE_MODEL).
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { createHmac } from "node:crypto";
import { q, one } from "./db.js";
import { seeded, OPENROUTER_URL } from "./llm.js";

export const OPENROUTER_IMAGE_DEFAULT = "google/gemini-2.5-flash-image";

const P = () => process.env.IMAGE_PROVIDER || "mock";
let client;
// Nova Canvas is only offered in a few regions (us-east-1, eu-west-1, ap-northeast-1), so it gets its own.
const br = () => (client ??= new BedrockRuntimeClient({ region: process.env.IMAGE_AWS_REGION || "us-east-1" }));

const xml = s => String(s).replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

function mockPoster(prompt, caption) {
  const r = seeded(prompt), hue = Math.floor(r() * 360), hue2 = (hue + 40 + Math.floor(r() * 80)) % 360;
  const words = String(caption || prompt).split(/\s+/), lines = [];
  for (const w of words) { const last = lines[lines.length - 1]; if (last && (last + " " + w).length <= 26) lines[lines.length - 1] += " " + w; else lines.push(w); }
  const shapes = Array.from({ length: 7 }, () =>
    `<circle cx="${Math.floor(r() * 1024)}" cy="${Math.floor(r() * 1024)}" r="${60 + Math.floor(r() * 220)}" fill="hsla(${(hue + Math.floor(r() * 120)) % 360},70%,70%,0.25)"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,32%)"/><stop offset="1" stop-color="hsl(${hue2},60%,22%)"/></linearGradient></defs>` +
    `<rect width="1024" height="1024" fill="url(#g)"/>${shapes}` +
    lines.slice(0, 5).map((l, i) => `<text x="512" y="${430 + i * 70}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="700" fill="#fff">${xml(l)}</text>`).join("") +
    `<text x="512" y="960" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="rgba(255,255,255,.7)">Test image · set IMAGE_PROVIDER=openrouter or bedrock for real pictures</text></svg>`;
}

export async function generateImage({ taskId, prompt, caption, agent }) {
  let mime, data, cost = 0;
  if (P() === "bedrock") {
    const res = await br().send(new InvokeModelCommand({
      modelId: process.env.BEDROCK_IMAGE_MODEL_ID || "amazon.nova-canvas-v1:0", contentType: "application/json", accept: "application/json",
      body: JSON.stringify({ taskType: "TEXT_IMAGE", textToImageParams: { text: String(prompt).slice(0, 1024) },
        imageGenerationConfig: { numberOfImages: 1, width: 1024, height: 1024, quality: "standard", cfgScale: 7 } })
    }));
    const j = JSON.parse(new TextDecoder().decode(res.body));
    if (!j.images?.[0]) throw new Error(j.error || "Nova Canvas returned no image");
    mime = "image/png"; data = Buffer.from(j.images[0], "base64");
    cost = parseFloat(process.env.PRICE_IMAGE || "0.04");
  } else if (P() === "openrouter") {
    ({ mime, data, cost } = await openRouterImage(prompt));
  } else {
    mime = "image/svg+xml"; data = Buffer.from(mockPoster(prompt, caption));
  }
  // Counted with the AI spend so the monthly budget covers pictures too.
  await q("INSERT INTO llm_usage (agent_id,model,input_tokens,output_tokens,cost_usd) VALUES ($1,$2,0,0,$3)",
    [agent, imageModelName(), cost]);
  return one("INSERT INTO media (task_id, mime, data, prompt) VALUES ($1,$2,$3,$4) RETURNING id, mime", [taskId, mime, data, prompt]);
}

function imageModelName() {
  if (P() === "bedrock") return process.env.BEDROCK_IMAGE_MODEL_ID || "amazon.nova-canvas-v1:0";
  if (P() === "openrouter") return process.env.OPENROUTER_IMAGE_MODEL || OPENROUTER_IMAGE_DEFAULT;
  return "mock-image";
}

// Image models on OpenRouter answer through the normal chat API and send the picture back as a data: URL.
async function openRouterImage(prompt) {
  const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${(process.env.OPENROUTER_API_KEY || "").trim()}`,
      "HTTP-Referer": process.env.PUBLIC_URL || "http://localhost:8080", "X-Title": "Dia Office" },
    body: JSON.stringify({
      model: imageModelName(), modalities: ["image", "text"], usage: { include: true },
      messages: [{ role: "user", content: `Create one square image: ${String(prompt).slice(0, 2000)}` }]
    })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`OpenRouter image error ${res.status} for ${imageModelName()}: ${j.error?.message || "no details"}`);
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url || "";
  const m = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error(`${imageModelName()} returned no picture. Pick a model that makes images (npm run openrouter:models lists them).`);
  return { mime: m[1], data: Buffer.from(m[2], "base64"), cost: typeof j.usage?.cost === "number" ? j.usage.cost : parseFloat(process.env.PRICE_IMAGE || "0.04") };
}

// <img> tags can't send a key, so media links carry a signature made with ADMIN_TOKEN instead.
export const mediaSig = id => createHmac("sha256", process.env.ADMIN_TOKEN || "").update(`media:${id}`).digest("base64url").slice(0, 32);
export const mediaUrl = id => `/api/v1/media/${id}?sig=${mediaSig(id)}`;
export const getMedia = id => one("SELECT mime, data FROM media WHERE id=$1", [id]);
