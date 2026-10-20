// Company knowledge base (RAG) on Postgres + pgvector. Costs nothing beyond your own database.
import { q } from "./db.js";
import { embed } from "./llm.js";

const vec = v => `[${v.join(",")}]`;

function chunk(text, size = 1200) {
  const parts = [], paras = text.split(/\n\s*\n/);
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) { parts.push(cur.trim()); cur = ""; }
    cur += "\n\n" + p;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export async function addDoc(title, content) {
  const parts = chunk(content);
  for (const c of parts) await q("INSERT INTO kb_chunks (title,content,embedding) VALUES ($1,$2,$3)", [title, c, vec(await embed(c))]);
  return parts.length;
}

export async function search(query, k = 4) {
  const { rows } = await q(
    "SELECT title, content FROM kb_chunks ORDER BY embedding <=> $1 LIMIT $2", [vec(await embed(query)), k]);
  return rows;
}

// One row per document, for the office page.
export async function listDocs() {
  const { rows } = await q("SELECT title, count(*)::int AS chunks, min(id) AS id FROM kb_chunks GROUP BY title ORDER BY min(id) DESC");
  return rows;
}

// Text block to paste into a prompt.
export async function context(query, k = 4) {
  const rows = await search(query, k).catch(() => []);
  if (!rows.length) return "No company documents found.";
  return rows.map(r => `### ${r.title}\n${r.content}`).join("\n\n");
}
