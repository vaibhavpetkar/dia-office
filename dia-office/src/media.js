// Pictures for the teams. IMAGE_PROVIDER: mock | bedrock.
// mock draws a simple poster (SVG) so the whole flow runs free; bedrock uses Amazon Nova Canvas.
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { createHmac } from "node:crypto";
import { q, one } from "./db.js";
import { seeded } from "./llm.js";

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
    `<text x="512" y="960" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="rgba(255,255,255,.7)">Test image · set IMAGE_PROVIDER=bedrock for real pictures</text></svg>`;
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
  } else {
    mime = "image/svg+xml"; data = Buffer.from(mockPoster(prompt, caption));
  }
  // Counted with the AI spend so the monthly budget covers pictures too.
  await q("INSERT INTO llm_usage (agent_id,model,input_tokens,output_tokens,cost_usd) VALUES ($1,$2,0,0,$3)",
    [agent, P() === "bedrock" ? process.env.BEDROCK_IMAGE_MODEL_ID || "amazon.nova-canvas-v1:0" : "mock-image", cost]);
  return one("INSERT INTO media (task_id, mime, data, prompt) VALUES ($1,$2,$3,$4) RETURNING id, mime", [taskId, mime, data, prompt]);
}

// <img> tags can't send a key, so media links carry a signature made with ADMIN_TOKEN instead.
export const mediaSig = id => createHmac("sha256", process.env.ADMIN_TOKEN || "").update(`media:${id}`).digest("base64url").slice(0, 32);
export const mediaUrl = id => `/api/v1/media/${id}?sig=${mediaSig(id)}`;
export const getMedia = id => one("SELECT mime, data FROM media WHERE id=$1", [id]);
