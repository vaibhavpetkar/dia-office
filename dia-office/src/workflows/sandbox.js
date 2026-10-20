// The sandbox: Tara turns the build plan into a real website that runs live inside the office,
// so anyone can click through it before it goes to AWS. Each change request makes a new version.
import { randomBytes } from "node:crypto";
import { q, one } from "../db.js";
import { ask, seeded } from "../llm.js";
import { COMPANY } from "../agents.js";
import { status, idle, log, refresh, problem } from "../events.js";

const FILE = /^[a-z0-9][a-z0-9-]{0,40}\.(html|css|js|svg)$/;
const MAX_BYTES = 400 * 1024;
const TYPES = { html: "text/html", css: "text/css", js: "text/javascript", svg: "image/svg+xml" };
export const contentType = path => `${TYPES[path.split(".").pop()]}; charset=utf-8`;

// Generated sites run in an opaque origin: no access to the office, its key or its API, and no network calls out.
export const SANDBOX_CSP = ["sandbox allow-scripts allow-forms allow-modals allow-popups",
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:", "font-src 'self' data: https://fonts.gstatic.com", "connect-src 'none'", "form-action 'none'",
  "frame-ancestors 'self'", "base-uri 'none'"].join("; ");

// Added to every page: forms say what they would have sent instead of failing silently, and the viewer learns which page is open.
const HELPER = `<script>(()=>{const say=m=>{try{parent.postMessage(Object.assign({sandbox:1},m),"*")}catch{}};
say({page:location.pathname.split("/").pop()||"index.html",title:document.title});
document.addEventListener("submit",e=>{e.preventDefault();const f=e.target,d=[...new FormData(f)].filter(([,v])=>typeof v==="string"&&v).map(([k,v])=>k+": "+v);
say({form:d});const t=document.createElement("div");t.textContent="Sandbox: this form works, but nothing was sent."+(d.length?" It would send "+d.join(", ")+".":"");
t.style.cssText="position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:90vw;background:#1b2a26;color:#fff;padding:10px 16px;border-radius:10px;font:14px system-ui;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.3)";
document.body.appendChild(t);setTimeout(()=>t.remove(),5000);f.reset?.()},true);})();</script>`;
export const withHelper = html => /<\/body>/i.test(html) ? html.replace(/<\/body>/i, HELPER + "</body>") : html + HELPER;

const err = (message, s) => Object.assign(new Error(message), { status: s });

export async function sitesFor(projectId) {
  return (await q(`SELECT id, version, token, guide, feedback, status, error, created_at,
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(files) k) AS pages FROM sites WHERE project_id=$1 ORDER BY version DESC`, [projectId])).rows
    .map(s => ({ ...s, pages: (s.pages || []).filter(p => p.endsWith(".html")) }));
}

// What the viewer page needs for one version: the site's guide plus enough of the project to explain it.
export async function siteByToken(token) {
  const s = await one(`SELECT s.id, s.project_id, s.version, s.token, s.guide, s.feedback, s.status, s.error, s.created_at,
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s.files) k) AS files, p.company, p.need, p.stage, p.plan,
      (SELECT token FROM sites l WHERE l.project_id = s.project_id AND l.status = 'ready' ORDER BY version DESC LIMIT 1) AS latest
    FROM sites s JOIN projects p ON p.id = s.project_id WHERE s.token=$1`, [token]);
  if (!s) throw err("This sandbox link doesn't exist. Ask for a fresh link from the office.", 404);
  const pages = (s.files || []).filter(f => f.endsWith(".html"));
  return { project_id: s.project_id, version: s.version, status: s.status, error: s.error, created_at: s.created_at, feedback: s.feedback, guide: s.guide,
    pages: pages.sort((a, b) => (b === "index.html") - (a === "index.html")), company: s.company, need: s.need, stage: s.stage,
    stack: s.plan?.stack || [], latest: s.latest && s.latest !== s.token ? s.latest : null };
}

export async function siteFile(token, path) {
  if (!FILE.test(path)) return null;
  const r = await one("SELECT files->>$2 AS body FROM sites WHERE token=$1 AND status='ready'", [token, path]);
  return r?.body ?? null;
}

/** Tara builds a new version of the project's website. `feedback` is what the person asked to change. */
export async function buildSite(projectId, feedback = null) {
  const p = await one("SELECT * FROM projects WHERE id=$1", [projectId]);
  if (!p) throw err("Project not found", 404);
  const prev = await one("SELECT * FROM sites WHERE project_id=$1 ORDER BY version DESC LIMIT 1", [projectId]);
  if (prev?.status === "building") throw err("Tara is already building a version of this site. Wait for it to finish.", 409);
  const version = (prev?.version || 0) + 1, token = randomBytes(18).toString("base64url");
  const site = await one("INSERT INTO sites (project_id, version, token, feedback) VALUES ($1,$2,$3,$4) RETURNING id, version, token, status",
    [projectId, version, token, feedback]);
  refresh("projects");
  make(p, site, prev?.status === "ready" ? prev : null, feedback).catch(e => problem(`could not build the ${p.company} website`, e));
  return site;
}

async function make(p, site, prev, feedback) {
  await status("tara", feedback ? `Updating the ${p.company} site (v${site.version})` : `Building the ${p.company} website`);
  try {
    const out = await ask({
      agent: "tara", tier: "smart", maxTokens: 12000, need: ["files", "guide"],
      system: COMPANY() + " You are Tara, full-stack developer. You build a working, good-looking front-end website (static HTML, CSS and " +
        "vanilla JS, no build step) that the client can click through in a sandbox before the real build is deployed. " +
        "Use relative links between pages. Forms can stay as they are; the sandbox shows what they would send. " +
        "No external scripts and no network calls; Google Fonts and https images are allowed.",
      prompt: `Client: ${p.company}\nThey need: ${p.need}\nBuild plan: ${JSON.stringify(p.plan || {})}\n` +
        (prev ? `\nCurrent version ${prev.version} files:\n${JSON.stringify(prev.files).slice(0, 60000)}\n\nChange requested: ${feedback || "polish it"}\n` +
          "Return the complete new set of files (every file, not only the changed ones).\n" : "") +
        `Return {"files":{"index.html":"<!doctype html>...","styles.css":"...","app.js":"...", "other-page.html":"..."},` +
        `"guide":{"summary":"2 sentences a non-technical person understands","sections":[{"page":"index.html","name":"...","what":"what it does for the client's customers"}],` +
        `"try":["3-5 things to click or try"],"changes":["what changed in this version"],"not_real_yet":["what is mocked until the real build, e.g. payments"]}}\n` +
        "File names: lowercase letters, digits and dashes, ending in .html, .css, .js or .svg. index.html is the home page.",
      mock: () => mockSite(p, site.version, feedback)
    });
    const files = clean(out.files);
    await q("UPDATE sites SET files=$2, guide=$3, status='ready' WHERE id=$1", [site.id, files, out.guide]);
    await log("tara", `put version ${site.version} of the ${p.company} website live in the sandbox (${Object.keys(files).filter(f => f.endsWith(".html")).length} pages). ` +
      "Open it from the project card to click through it.", { sandbox: `/sandbox.html?s=${site.token}`, guide: out.guide });
  } catch (e) {
    await q("UPDATE sites SET status='failed', error=$2 WHERE id=$1", [site.id, e.message]);
    throw e;
  } finally {
    await idle("tara");
    refresh("projects");
  }
}

function clean(files) {
  if (!files || typeof files !== "object") throw new Error("Tara's answer had no files");
  const out = {};
  let bytes = 0;
  for (const [name, body] of Object.entries(files)) {
    const path = String(name).replace(/^\.?\/+/, "").toLowerCase();
    if (!FILE.test(path) || typeof body !== "string") continue;
    bytes += Buffer.byteLength(body);
    if (bytes > MAX_BYTES) throw new Error("The website is bigger than the 400 KB sandbox limit");
    out[path] = body;
  }
  if (!out["index.html"]) throw new Error("The website has no index.html home page");
  return out;
}

// ---- Mock mode: a real multi-page site built from the project, so the sandbox works without any AI ----
const PALETTES = [
  { brand: "#0f6e6a", accent: "#d9930f", soft: "#e6f2f0" }, { brand: "#2b4fa8", accent: "#e0603a", soft: "#e9eefa" },
  { brand: "#7b2d5b", accent: "#2f9e8f", soft: "#f6e9f1" }, { brand: "#1f5132", accent: "#e2b33c", soft: "#e8f2ea" },
  { brand: "#30343f", accent: "#e4572e", soft: "#eceef2" }
];
const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function mockSite(p, version, feedback) {
  const pal = PALETTES[(Math.floor(seeded(p.company)() * PALETTES.length) + version - 1) % PALETTES.length];
  const name = p.company, need = p.need;
  const modules = (p.plan?.modules?.length ? p.plan.modules : ["Online booking", "Customer accounts", "Admin dashboard", "Payments"]).slice(0, 6);
  const nav = cur => [["index.html", "Home"], ["features.html", "Features"], ["contact.html", "Contact"]]
    .map(([f, t]) => `<a href="${f}"${f === cur ? ' aria-current="page"' : ""}>${t}</a>`).join("");
  const page = (file, title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)} · ${h(name)}</title><link rel="stylesheet" href="styles.css"></head>
<body><header class="top"><a class="logo" href="index.html"><span>${h(name.slice(0, 1).toUpperCase())}</span>${h(name)}</a>
<button class="menu" aria-expanded="false" aria-controls="nav">Menu</button><nav id="nav">${nav(file)}</nav></header>
<main>${body}</main>
<footer><p>© ${new Date().getFullYear()} ${h(name)} · Built by Inveon Technologies</p></footer>
<script src="app.js"></script></body></html>`;

  const icons = ["◆", "●", "▲", "■", "★", "✦"];
  const files = {
    "styles.css": `:root{--brand:${pal.brand};--accent:${pal.accent};--soft:${pal.soft};--ink:#1d2433;--muted:#5b6475;--line:#e3e6ec}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:#fff}
a{color:var(--brand)}h1,h2,h3{line-height:1.15;margin:0 0 .5em}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 5vw;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff;z-index:5}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;text-decoration:none;color:var(--ink)}
.logo span{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:var(--brand);color:#fff}
nav{display:flex;gap:22px}nav a{text-decoration:none;color:var(--muted);font-weight:600}nav a[aria-current]{color:var(--brand)}
.menu{display:none;border:1px solid var(--line);background:#fff;border-radius:8px;padding:6px 12px;font:inherit}
.hero{padding:72px 5vw 64px;background:linear-gradient(135deg,var(--soft),#fff);display:grid;gap:18px;max-width:1100px;margin:0 auto}
.hero h1{font-size:clamp(2rem,5vw,3.2rem);max-width:18ch}.hero p{font-size:1.15rem;color:var(--muted);max-width:52ch;margin:0}
.cta{display:flex;gap:12px;flex-wrap:wrap}.btn{display:inline-block;padding:12px 22px;border-radius:999px;background:var(--brand);color:#fff;text-decoration:none;font-weight:600;border:0;font:inherit;cursor:pointer}
.btn.ghost{background:transparent;color:var(--brand);border:2px solid var(--brand)}
section{padding:56px 5vw;max-width:1100px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}
.card{border:1px solid var(--line);border-radius:16px;padding:22px;background:#fff}
.card i{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:var(--soft);color:var(--brand);font-style:normal;margin-bottom:12px}
.steps{counter-reset:s;display:grid;gap:14px;padding:0;list-style:none}.steps li{counter-increment:s;display:flex;gap:14px;align-items:flex-start}
.steps li::before{content:counter(s);flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700}
.band{background:var(--brand);color:#fff;border-radius:20px;padding:36px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between}
.band .btn{background:#fff;color:var(--brand)}
details{border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:10px}summary{font-weight:600;cursor:pointer}
form{display:grid;gap:14px;max-width:520px}label{display:grid;gap:6px;font-weight:600}
input,textarea,select{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px}
.counter{font-size:2.2rem;font-weight:800;color:var(--brand)}
footer{padding:28px 5vw;color:var(--muted);border-top:1px solid var(--line);text-align:center}
@media(max-width:700px){.menu{display:block}nav{display:none;position:absolute;top:62px;left:0;right:0;background:#fff;flex-direction:column;padding:16px 5vw;border-bottom:1px solid var(--line)}nav.open{display:flex}}`,
    "app.js": `const b=document.querySelector(".menu"),n=document.getElementById("nav");
b?.addEventListener("click",()=>{const o=n.classList.toggle("open");b.setAttribute("aria-expanded",o)});
document.querySelectorAll(".counter[data-to]").forEach(el=>{const to=+el.dataset.to;let v=0;const t=setInterval(()=>{v=Math.min(to,v+Math.ceil(to/40));el.textContent=v.toLocaleString("en-IN");if(v>=to)clearInterval(t)},30)});`,
    "index.html": page("index.html", "Home", `<div class="hero"><h1>${h(need.charAt(0).toUpperCase() + need.slice(1))}, made simple.</h1>
<p>${h(name)} brings everything your customers need into one place, on any phone or laptop.</p>
<div class="cta"><a class="btn" href="contact.html">Get started</a><a class="btn ghost" href="features.html">See features</a></div></div>
<section><h2>What you can do</h2><div class="grid">${modules.map((m, i) => `<div class="card"><i>${icons[i % icons.length]}</i><h3>${h(m)}</h3><p>${h(m)} for ${h(name)}'s customers, ready from day one.</p></div>`).join("")}</div></section>
<section><h2>How it works</h2><ol class="steps"><li><div><b>Sign up</b><br>Create an account in under a minute.</div></li>
<li><div><b>Choose what you need</b><br>Pick from ${modules.length} ready modules.</div></li><li><div><b>You're live</b><br>We handle hosting, updates and backups.</div></li></ol></section>
<section><div class="grid"><div class="card"><div class="counter" data-to="1200">0</div>happy customers</div><div class="card"><div class="counter" data-to="99">0</div>% uptime on AWS</div>
<div class="card"><div class="counter" data-to="24">0</div>hour support</div></div></section>
<section><div class="band"><h2 style="margin:0">Ready to try ${h(name)}?</h2><a class="btn" href="contact.html">Talk to us</a></div></section>`),
    "features.html": page("features.html", "Features", `<section><h1>Features</h1><p>Everything in version ${version}. Click a feature to read more.</p>
${modules.map(m => `<details><summary>${h(m)}</summary><p>${h(m)} is part of ${h(need)}. In the real build it connects to the database and AWS; here in the sandbox it shows how it will look and feel.</p></details>`).join("")}</section>`),
    "contact.html": page("contact.html", "Contact", `<section><h1>Contact ${h(name)}</h1><p>Leave your details and the team will call you back.</p>
<form><label>Your name<input name="name" required autocomplete="name"></label><label>Phone or email<input name="contact" required></label>
<label>Interested in<select name="interest">${modules.map(m => `<option>${h(m)}</option>`).join("")}</select></label>
<label>Message<textarea name="message" rows="4"></textarea></label><button class="btn" type="submit">Send</button></form></section>`)
  };
  const changes = feedback
    ? [`New colour scheme (version ${version}).`, `Your note "${feedback.slice(0, 200)}" is saved with this version. The office is in mock AI mode, so Tara can't rewrite pages yet; with a real AI provider she rebuilds the site from it.`]
    : ["First version built from Neel's plan."];
  return { files, guide: {
    summary: `A ${modules.length}-feature website for ${name}: ${need}. Visitors can read what ${name} offers, open each feature, and leave their details.`,
    sections: [{ page: "index.html", name: "Home", what: "First thing customers see: what the service is, the main features and a button to get started." },
      { page: "features.html", name: "Features", what: `Each of the ${modules.length} features with a short explanation. Click a feature to open it.` },
      { page: "contact.html", name: "Contact form", what: "Where a customer leaves their name and number so the team can call back." }],
    try: ["Click Get started on the home page", "Open a feature on the Features page", "Fill in the contact form and press Send", "Switch to Phone view and use the Menu button"],
    changes, not_real_yet: ["Sign-up and login", "Payments", "Saving the contact form (the sandbox shows what it would send)"] } };
}
