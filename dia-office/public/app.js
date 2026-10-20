// The Dia app: talk to Dia, give her jobs, see what the teams made, and make decisions from a phone or laptop.
// It uses only the /api/v1 API, so a native phone or desktop app can do exactly the same.
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  let KEY = store.get("diaAppKey") || "", me = null, lang = store.get("diaLang") || "en", voiceOn = store.get("diaVoice") !== "0";
  const chatLog = [];

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", authorization: "Bearer " + KEY, ...(opts.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Error ${r.status}`), { status: r.status });
    return j;
  }

  // ---------- Screens ----------
  const PANES = ["connect", "talk", "jobs", "job", "decisions", "settings"];
  let tab = "talk", poll;
  function show(name) {
    PANES.forEach(p => ($(p).hidden = p !== name));
    $("tabs").hidden = name === "connect";
    const t = name === "job" ? "jobs" : name;
    document.querySelectorAll("[data-tab]").forEach(b => b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
    clearTimeout(poll);
    if (name === "jobs") loadJobs();
    if (name === "decisions") loadDecisions();
    if (name === "settings") loadSettings();
    if (name !== "job" && location.hash.startsWith("#job=")) window.history.replaceState(null, "", location.pathname);
  }
  $("tabs").onclick = e => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; show(tab); } };

  async function connect() {
    try {
      me = await api("/api/v1/me");
      $("state").textContent = me.role === "director" ? "Your virtual owner · director" : `Your virtual owner · ${me.name}`;
      const m = location.hash.match(/^#job=(\d+)/);
      if (m) openJob(+m[1]); else show(tab);
      refreshDecisionCount();
      if (!$("msgs").children.length) addMsg("dia", HELLO[lang]);
    } catch (e) {
      if (e.status === 401 || e.status === 429) { $("keyErr").textContent = KEY ? e.message : ""; KEY = ""; store.set("diaAppKey", null); }
      else $("keyErr").textContent = e.message;
      show("connect");
    }
  }
  $("fKey").onsubmit = e => { e.preventDefault(); KEY = $("key").value.trim(); store.set("diaAppKey", KEY); $("key").value = ""; connect(); };

  // ---------- Voice ----------
  const LANGS = { en: { code: "en-IN", want: /neerja|heera|veena|kajal|female/i }, hi: { code: "hi-IN", want: /swara|kalpana|female/i }, mr: { code: "mr-IN", want: /aarohi|female/i } };
  const HELLO = { en: "Namaskar! I'm Dia. Tell me what you need: research, a picture, a video plan, a website or a post, and I'll give it to the right team.",
    hi: "नमस्ते! मैं दिया हूँ। बताइए आपको क्या चाहिए, मैं सही टीम को काम दे दूँगी।", mr: "नमस्कार! मी दिया. सांगा तुम्हाला काय हवं आहे, मी योग्य टीमला काम देईन." };
  function pickVoice() {
    const vs = speechSynthesis?.getVoices() || [], L = LANGS[lang], base = L.code.slice(0, 2);
    const same = vs.filter(v => v.lang.replace("_", "-").toLowerCase().startsWith(base)), nat = v => /natural|online|neural/i.test(v.name);
    return same.find(v => nat(v) && L.want.test(v.name)) || same.find(nat) || same.find(v => L.want.test(v.name)) || same[0] || null;
  }
  function talking(on, level) { document.body.classList.toggle("speaking", on); window.DiaFace?.speak(on, level); }
  let audio;
  function stopVoice() { window.speechSynthesis?.cancel(); if (audio) { audio.pause(); audio = null; } talking(false); }
  async function speak(text) {
    stopVoice();
    if (!voiceOn) return;
    const clean = text.replace(/₹\s?([\d,]+)/g, (m, n) => n + (lang === "en" ? " rupees" : " रुपये")).replace(/[*_#`]/g, "");
    if (me?.tts === "azure") {
      try {
        const r = await fetch("/api/v1/tts", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + KEY }, body: JSON.stringify({ text: clean, lang }) });
        if (!r.ok) throw new Error();
        audio = new Audio(URL.createObjectURL(await r.blob()));
        audio.onplay = () => talking(true); audio.onended = audio.onerror = () => talking(false);
        return await audio.play();
      } catch {}
    }
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(clean), v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = LANGS[lang].code;
    u.onstart = () => talking(true); u.onend = u.onerror = () => talking(false); u.onboundary = () => window.DiaFace?.word?.();
    speechSynthesis.speak(u);
  }
  $("bVoice").setAttribute("aria-pressed", voiceOn);
  $("bVoice").onclick = () => { voiceOn = !voiceOn; store.set("diaVoice", voiceOn ? "1" : "0"); $("bVoice").setAttribute("aria-pressed", voiceOn); $("bVoice").textContent = voiceOn ? "🔊" : "🔈"; if (!voiceOn) stopVoice(); };
  const setLang = l => { lang = l; store.set("diaLang", l); document.documentElement.lang = l; document.querySelectorAll("[data-lang]").forEach(b => b.setAttribute("aria-pressed", b.dataset.lang === l)); };
  document.querySelector(".langs").onclick = e => { const b = e.target.closest("[data-lang]"); if (b) { setLang(b.dataset.lang); speak(HELLO[lang]); } };
  setLang(lang);

  // Speech to text, where the browser has it (Chrome, Edge, Safari).
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function mic(button, onText) {
    if (!SR) return;
    button.hidden = false;
    button.onclick = () => {
      const r = new SR(); r.lang = LANGS[lang].code; r.interimResults = false;
      button.classList.add("rec"); stopVoice();
      r.onresult = e => onText(e.results[0][0].transcript);
      r.onend = r.onerror = () => button.classList.remove("rec");
      r.start();
    };
  }
  mic($("bMic"), t => sendChat(t));
  mic($("bMicJob"), t => { $("brief").value = ($("brief").value + " " + t).trim(); });

  // ---------- Talk ----------
  function addMsg(who, text, actions = []) {
    const d = document.createElement("div");
    d.className = `m ${who}`; d.textContent = text;
    if (actions.length) {
      const box = document.createElement("div"); box.className = "acts";
      for (const a of actions) {
        const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = a.label;
        b.onclick = () => runAction(a, b); box.append(b);
      }
      d.append(box);
    }
    $("msgs").append(d); d.scrollIntoView({ block: "end", behavior: "smooth" });
    return d;
  }
  async function runAction(a, b) {
    b.disabled = true;
    try {
      const r = await api(a.path, { method: a.method, body: JSON.stringify(a.body || {}) });
      b.textContent = "✓ " + a.label;
      if (a.path === "/api/v1/requests" && r.id) { addMsg("dia", "Done. I'm splitting it into jobs now. I'll show you each team's work as it comes in."); openJob(r.id); }
    } catch (e) {
      b.disabled = false;
      addMsg("dia", e.status === 401 && me?.role === "app" ? "That needs the director key; an app key can't do it. Open the office to do this one." : e.message);
    }
  }
  async function sendChat(text) {
    text = String(text || "").trim(); if (!text) return;
    $("msg").value = ""; addMsg("me", text);
    const wait = addMsg("dia", "…"); wait.classList.add("typing");
    try {
      const r = await api("/api/v1/chat", { method: "POST", body: JSON.stringify({ message: text, lang, history: chatLog.slice(-8) }) });
      wait.remove(); chatLog.push({ role: "me", text }, { role: "dia", text: r.reply });
      addMsg("dia", r.reply, r.actions || []); speak(r.reply);
    } catch (e) { wait.remove(); addMsg("dia", e.message); }
  }
  $("fChat").onsubmit = e => { e.preventDefault(); sendChat($("msg").value); };

  // ---------- Jobs ----------
  const COL = { planning: "marigold", working: "eng", done: "ok", failed: "kumkum", queued: "muted" };
  const pill = s => `<span class="pill" style="--c:var(--${COL[s] || "eng"})">${esc(s)}</span>`;
  const when = t => t ? new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  $("fJob").onsubmit = async e => {
    e.preventDefault();
    const b = e.submitter || $("fJob").querySelector(".primary"); b.disabled = true;
    try { const r = await api("/api/v1/requests", { method: "POST", body: JSON.stringify({ brief: $("brief").value }) }); $("brief").value = ""; openJob(r.id); }
    catch (err) { alert(err.message); } finally { b.disabled = false; }
  };
  async function loadJobs() {
    try {
      const rows = await api("/api/v1/requests");
      $("jobList").innerHTML = rows.length ? rows.map(r => `<button type="button" class="card job" data-job="${r.id}">
        <span><b>${esc(r.title || "Dia is reading it…")}</b><br><small>${esc(r.brief.slice(0, 120))}</small></span>
        <span>${pill(r.status)}<br><small>${r.tasks_done}/${r.tasks} · ${when(r.created_at)}</small></span>
        <span class="bar2"><i style="width:${r.tasks ? Math.round(r.tasks_done / r.tasks * 100) : 5}%"></i></span></button>`).join("")
        : `<p class="muted">No jobs yet. Tell Dia what you need above.</p>`;
      if (rows.some(r => ["planning", "working"].includes(r.status)) && !$("jobs").hidden) poll = setTimeout(loadJobs, 4000);
    } catch (e) { $("jobList").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  $("jobList").onclick = e => { const b = e.target.closest("[data-job]"); if (b) openJob(+b.dataset.job); };

  let jobId = null, lastStatus = null;
  async function openJob(id) {
    if (jobId !== id) lastStatus = null;
    jobId = id; show("job");
    if (location.hash !== `#job=${id}`) window.history.replaceState(null, "", `#job=${id}`);
    try {
      const r = await api(`/api/v1/requests/${id}`);
      if (jobId !== id || $("job").hidden) return;
      // Re-draw only when something changed, so an open preview or a half-read section isn't reset.
      const sig = JSON.stringify([r.status, r.tasks.map(t => t.status)]);
      if (sig !== lastStatus) { renderJob(r); lastStatus = sig; }
      if (["planning", "working"].includes(r.status)) poll = setTimeout(() => openJob(id), 2000);
    } catch (e) { $("job").innerHTML = `<button type="button" class="btn back" data-back>← Jobs</button><p class="err">${esc(e.message)}</p>`; }
  }
  function renderJob(r) {
    const done = r.tasks.filter(t => t.status === "done").length;
    $("job").innerHTML = `<button type="button" class="btn back" data-back>← Jobs</button>
      <div class="card"><h2>${esc(r.title || "Dia is reading your request…")}</h2>
        <p class="muted">${esc(r.brief)}</p>
        ${r.summary ? `<p><b>Dia:</b> ${esc(r.summary)}</p>` : ""}
        ${r.questions?.length ? `<p class="note">Dia would also like to know: ${r.questions.map(esc).join(" · ")}</p>` : ""}
        <p>${pill(r.status)} ${done}/${r.tasks.length} tasks done</p>
        ${r.status === "failed" ? `<div class="row"><button type="button" class="btn primary" data-retry="${r.id}">Try the unfinished tasks again</button></div>` : ""}
      </div>
      ${r.tasks.map(task).join("")}`;
  }
  const list = a => a?.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  const OUT = {
    research: o => `<p>${esc(o.summary)}</p>${(o.sections || []).map(s => `<section><h4>${esc(s.heading)}</h4><p>${esc(s.body)}</p></section>`).join("")}
      ${o.key_points?.length ? `<section><h4>Key points</h4>${list(o.key_points)}</section>` : ""}
      ${o.check?.length ? `<section><h4>Check before using</h4>${list(o.check)}</section>` : ""}`,
    image: o => `<img src="${esc(o.url)}" alt="${esc(o.caption || o.prompt)}" loading="lazy"><p>${esc(o.caption || "")}</p>
      <div class="row"><a class="btn" href="${esc(o.url)}" download="dia-image-${esc(o.media_id)}.${o.mime === "image/png" ? "png" : "svg"}">Download</a></div>
      <details><summary>Prompt the designer used</summary><p>${esc(o.prompt)}</p></details>`,
    video: o => `<p><b>${esc(o.title || "")}</b> · ${esc(o.length_seconds)}s · ${esc(o.format || "")}${o.music ? ` · music: ${esc(o.music)}` : ""}</p>
      <div class="scenes">${(o.scenes || []).map((s, i) => `<div class="scene"><b>${i + 1}. ${esc(s.seconds)}s</b> ${esc(s.visual)}<br>🎙️ ${esc(s.voiceover)}${s.on_screen_text ? `<br>🅰️ ${esc(s.on_screen_text)}` : ""}</div>`).join("")}</div>
      ${o.call_to_action ? `<p><b>Call to action:</b> ${esc(o.call_to_action)}</p>` : ""}
      <p class="note">This is the storyboard. Rendering the video itself comes in the next phase (Amazon Nova Reel).</p>`,
    build: (o, t) => `${o.stack?.length ? `<section><h4>Stack</h4>${list(o.stack)}</section>` : ""}${o.features?.length ? `<section><h4>Features</h4>${list(o.features)}</section>` : ""}
      ${o.steps?.length ? `<section><h4>Steps</h4><table>${o.steps.map(s => `<tr><td>${esc(s.title)}</td><td>${esc(s.dept)}</td><td>${esc(s.days)} days</td></tr>`).join("")}</table></section>` : ""}
      ${o.deploy ? `<section><h4>Going live</h4><p>${esc(o.deploy)}</p></section>` : ""}
      ${o.starter_html ? `<div class="row"><button type="button" class="btn" data-preview="${t.id}">Preview starter page</button><button type="button" class="btn" data-dl="${t.id}">Download .html</button></div><div id="pv${t.id}"></div>` : ""}`,
    content: o => (o.pieces || []).map((p, i) => `<div class="piece"><b>${esc(p.channel)}${p.title ? ` · ${esc(p.title)}` : ""}</b>\n${esc(p.text)}</div>`).join("")
  };
  const KIND = { research: "🔎 Research", image: "🖼️ Image", video: "🎬 Video", build: "🛠️ Build", content: "✍️ Writing" };
  let tasksById = {};
  function task(t) {
    tasksById[t.id] = t;
    const body = t.status === "done" && t.output ? OUT[t.kind](t.output, t) : t.status === "failed" ? `<p class="err">${esc(t.error || "Something went wrong.")}</p>`
      : `<p class="muted">${t.status === "working" ? `${esc(t.agent)} is working on it…` : `Waiting for ${esc(t.agent)}.`}</p>`;
    return `<article class="card task"><header><h3>${esc(t.title)}</h3>${pill(t.status)}</header>
      <p class="note">${KIND[t.kind] || esc(t.kind)} · ${esc(t.agent)} (${esc(t.dept)})</p>${body}</article>`;
  }
  $("job").onclick = async e => {
    if (e.target.closest("[data-back]")) { tab = "jobs"; jobId = null; return show("jobs"); }
    const rt = e.target.closest("[data-retry]");
    if (rt) { rt.disabled = true; try { await api(`/api/v1/requests/${rt.dataset.retry}/retry`, { method: "POST", body: "{}" }); lastStatus = null; openJob(+rt.dataset.retry); } catch (err) { rt.textContent = err.message; } return; }
    const pv = e.target.closest("[data-preview]");
    if (pv) {
      // A sandboxed frame: the page's scripts run, but it can't reach the office, your key or your cookies.
      const box = $("pv" + pv.dataset.preview), f = document.createElement("iframe");
      f.className = "preview"; f.setAttribute("sandbox", "allow-scripts allow-forms"); f.title = "Starter page preview";
      f.srcdoc = tasksById[pv.dataset.preview].output.starter_html; box.replaceChildren(f); return;
    }
    const dl = e.target.closest("[data-dl]");
    if (dl) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([tasksById[dl.dataset.dl].output.starter_html], { type: "text/html" })); a.download = "starter.html"; a.click();
    }
  };

  // ---------- Decisions ----------
  async function refreshDecisionCount() {
    try { const n = (await api("/api/v1/approvals")).length; $("nDec").hidden = !n; $("nDec").textContent = n; } catch {}
  }
  async function loadDecisions() {
    try {
      const rows = await api("/api/v1/approvals");
      $("nDec").hidden = !rows.length; $("nDec").textContent = rows.length;
      $("decisions").innerHTML = rows.length ? rows.map(a => `<div class="card"><h3>${esc(a.title)}</h3>
        <p class="muted">${esc(a.body?.reason || a.body?.summary || a.body?.recommendation || a.body?.reply || "")}</p>
        <div class="row"><button type="button" class="btn" data-dec="${a.id}" data-d="reject">Decline</button><button type="button" class="btn yes" data-dec="${a.id}" data-d="approve">Approve</button></div></div>`).join("")
        : `<div class="card"><p>Nothing is waiting for you. Dia will ask here before any hire, project, email or invoice goes out.</p></div>`;
    } catch (e) { $("decisions").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  $("decisions").onclick = async e => {
    const b = e.target.closest("[data-dec]"); if (!b) return;
    b.parentElement.querySelectorAll("button").forEach(x => (x.disabled = true));
    try { await api(`/api/v1/approvals/${b.dataset.dec}`, { method: "POST", body: JSON.stringify({ decision: b.dataset.d }) }); loadDecisions(); }
    catch (err) { b.textContent = err.message; }
  };

  // ---------- Settings ----------
  let installPrompt;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });
  async function loadSettings() {
    const director = me?.role === "director";
    let keys = [];
    if (director) try { keys = await api("/api/v1/keys"); } catch {}
    $("settings").innerHTML = `<div class="card"><h2>This device</h2>
        <p>Signed in as <b>${esc(me?.name)}</b>${director ? " (director key)" : " (app key)"}.</p>
        <p class="note">AI: ${esc(me?.provider)} · pictures: ${esc(me?.image)} · voice: ${esc(me?.tts)}</p>
        <div class="row">${installPrompt ? `<button type="button" class="btn primary" id="bInstall">Install the app</button>` : ""}<button type="button" class="btn" id="bOut">Sign out</button></div>
        ${installPrompt ? "" : `<p class="note">To install: in Chrome or Edge use the install icon in the address bar; on iPhone, Share → Add to Home Screen.</p>`}</div>
      ${director ? `<div class="card"><h2>App keys</h2>
        <p class="muted">Make one key per phone, laptop or program. It can talk to Dia, give jobs and make decisions, but can't make more keys. Switch it off if a device is lost.</p>
        <form id="fNewKey" class="row"><input id="keyName" placeholder="e.g. Vaibhav's phone" required aria-label="Key name"><button class="btn primary">Make a key</button></form>
        <div id="newKey"></div>
        ${keys.length ? `<table>${keys.map(k => `<tr><td><b>${esc(k.name)}</b><br><small class="muted">${esc(k.prefix)}… · ${k.last_used_at ? "used " + when(k.last_used_at) : "not used yet"}</small></td>
          <td>${k.revoked_at ? `<span class="muted">off</span>` : `<button type="button" class="btn" data-revoke="${k.id}">Switch off</button>`}</td></tr>`).join("")}</table>` : ""}
        <p class="note">Programs and the phone app use the same API: <a href="/api/v1/openapi.json" target="_blank" rel="noopener">API description (OpenAPI)</a>.</p></div>` : ""}`;
    $("bOut").onclick = () => { store.set("diaAppKey", null); KEY = ""; me = null; show("connect"); };
    if ($("bInstall")) $("bInstall").onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; loadSettings(); };
    if ($("fNewKey")) $("fNewKey").onsubmit = async e => {
      e.preventDefault();
      try {
        const k = await api("/api/v1/keys", { method: "POST", body: JSON.stringify({ name: $("keyName").value }) });
        await loadSettings();
        $("newKey").innerHTML = `<p><b>Copy this key now.</b> It won't be shown again. Paste it into the Dia app on the other device.</p><p class="keybox">${esc(k.key)}</p>`;
      } catch (err) { alert(err.message); }
    };
  }
  $("settings").onclick = async e => {
    const b = e.target.closest("[data-revoke]"); if (!b) return;
    b.disabled = true; try { await api(`/api/v1/keys/${b.dataset.revoke}`, { method: "DELETE" }); loadSettings(); } catch (err) { b.textContent = err.message; }
  };

  // ---------- Start ----------
  window.DiaFace?.mount($("face").querySelector("canvas"));
  addEventListener("hashchange", () => { const m = location.hash.match(/^#job=(\d+)/); if (m && me) openJob(+m[1]); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (KEY) connect(); else show("connect");
})();
