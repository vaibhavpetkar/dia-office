// Dia's talking face: her portrait (dia.jpg, 640x640) brought to life on a canvas.
// The lower lip and chin drop when she speaks, her eyelids blink and her head moves a little.
// One face is drawn per frame and shared: the chat shows it, and the 3D Dia wears it as a texture.
(() => {
  const S = 640;
  // Landmarks measured on dia.jpg.
  const LIP = 386, CHIN = 470, MOUTH = { x: 319, w: 132 };
  const EYES = [{ x: 252, y: 254, w: 66 }, { x: 376, y: 252, w: 70 }];
  const img = new Image(); img.src = "dia.jpg";

  const canvas = document.createElement("canvas"); canvas.width = canvas.height = S;
  const g = canvas.getContext("2d");
  const work = document.createElement("canvas"); work.width = S; work.height = S; // scratch for feathered pieces
  const w = work.getContext("2d");

  const state = { speaking: false, level: null, open: 0, blink: 0, nextBlink: 2, t: 0, syl: 0, sylSpeed: 11, nod: 0 };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Draw part of the photo through a soft-edged ellipse, so the edit blends into the face.
  function feathered(sx, sy, sw, sh, dx, dy, dw, dh, soft = 0.35) {
    w.clearRect(0, 0, S, S);
    w.globalCompositeOperation = "source-over";
    w.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    w.globalCompositeOperation = "destination-in";
    const cx = dx + dw / 2, cy = dy + dh / 2, r = Math.max(dw, dh) / 2;
    const grad = w.createRadialGradient(cx, cy, r * (1 - soft), cx, cy, r);
    grad.addColorStop(0, "rgba(0,0,0,1)"); grad.addColorStop(1, "rgba(0,0,0,0)");
    w.save(); w.translate(cx, cy); w.scale(dw / (2 * r), dh / (2 * r)); w.translate(-cx, -cy);
    w.fillStyle = grad; w.fillRect(cx - r, cy - r, 2 * r, 2 * r); w.restore();
    w.globalCompositeOperation = "source-over";
    g.drawImage(work, 0, 0);
  }

  // Lower lip and chin, moved down by d and squeezed so the bottom of the chin stays where it is.
  // The mask is crisp across the mouth, and fades everywhere else so no seam shows on the cheeks.
  const JAW = { x0: MOUTH.x - 125, wd: 250, top: LIP + 3, h: CHIN + 70 - LIP - 3 };
  const mask = document.createElement("canvas"); mask.width = mask.height = S;
  {
    const m = mask.getContext("2d"), { x0, wd, top, h } = JAW;
    let gr = m.createLinearGradient(0, top, 0, top + 26);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,1)");
    m.fillStyle = gr; m.fillRect(x0, top, wd, h);
    gr = m.createRadialGradient(MOUTH.x, top, 0, MOUTH.x, top, 70);
    gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.75, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    m.save(); m.translate(MOUTH.x, top); m.scale(1, 0.45); m.translate(-MOUTH.x, -top); m.fillStyle = gr; m.fillRect(MOUTH.x - 70, top - 70, 140, 140); m.restore();
    m.globalCompositeOperation = "destination-in";
    gr = m.createLinearGradient(x0, 0, x0 + wd, 0);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.18, "rgba(0,0,0,1)"); gr.addColorStop(0.82, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    m.fillStyle = gr; m.fillRect(x0, top, wd, h);
    gr = m.createLinearGradient(0, top, 0, top + h);
    gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.7, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    m.fillStyle = gr; m.fillRect(x0, top, wd, h);
  }
  function jaw(d) {
    const { x0, wd, top, h } = JAW;
    w.clearRect(0, 0, S, S);
    w.globalCompositeOperation = "source-over";
    w.drawImage(img, x0, top, wd, h, x0, top + d, wd, h - d);
    w.globalCompositeOperation = "destination-in";
    w.drawImage(mask, 0, d * 0.5);
    w.globalCompositeOperation = "source-over";
    g.drawImage(work, 0, 0);
  }

  function draw(dt) {
    if (!img.complete || !img.naturalWidth) return false;
    const s = state; s.t += dt;
    // Mouth: follow the real audio level when we have it, otherwise a syllable rhythm while the voice speaks.
    let target = 0;
    if (s.speaking) {
      if (s.level) target = Math.min(1, s.level() * 3.2);
      else { s.syl += dt * s.sylSpeed; const v = Math.abs(Math.sin(s.syl)); target = v * v * (0.55 + 0.45 * Math.abs(Math.sin(s.syl * 0.37 + 1))); }
    }
    s.open += (target - s.open) * Math.min(1, dt * (target > s.open ? 22 : 14));
    // Blinks every 2-6 seconds, sometimes twice.
    s.nextBlink -= dt;
    if (s.nextBlink <= 0) { s.blinkT = 0; s.nextBlink = 2 + Math.random() * 4; if (Math.random() < 0.15) s.nextBlink = 0.35; }
    if (s.blinkT !== undefined) { s.blinkT += dt; const k = s.blinkT / 0.16; s.blink = k < 1 ? Math.sin(k * Math.PI) : 0; if (k >= 1) s.blinkT = undefined; }
    if (reduce) { s.blink = 0; }

    // Head: slow sway and breathing; small nods on stressed syllables while talking.
    const t = s.t, talk = s.speaking ? 1 : 0;
    s.nod += ((talk ? Math.sin(t * 4.1) * 0.6 + Math.sin(t * 2.3) * 0.4 : 0) - s.nod) * Math.min(1, dt * 4);
    const rot = reduce ? 0 : (Math.sin(t * 0.5) * 0.9 + Math.sin(t * 0.83) * 0.5 + talk * Math.sin(t * 1.7) * 0.8) * Math.PI / 180;
    const dx = reduce ? 0 : Math.sin(t * 0.37) * 3, dy = reduce ? 0 : Math.sin(t * 1.3) * 1.5 + s.nod * 3;
    const sc = 1.04 + (reduce ? 0 : Math.sin(t * 1.3) * 0.004);

    g.save();
    g.clearRect(0, 0, S, S);
    g.translate(S / 2 + dx, S * 0.92 + dy); g.rotate(rot); g.scale(sc, sc); g.translate(-S / 2, -S * 0.92);
    g.drawImage(img, 0, 0, S, S);

    // Mouth opening: dark gap under the upper teeth, then the lower lip and chin stretched down into place.
    const d = s.open * 15;
    if (d > 0.4) {
      // Dark lens-shaped gap: straight under the upper teeth, curving down to the dropped lower lip.
      const half = MOUTH.w * (0.36 + s.open * 0.04), y0 = LIP - 3;
      g.filter = "blur(0.7px)";
      const mg = g.createLinearGradient(0, y0, 0, y0 + d * 1.6);
      mg.addColorStop(0, "#1c0607"); mg.addColorStop(1, "#5a1a1e");
      g.fillStyle = mg; g.beginPath(); g.moveTo(MOUTH.x - half, y0);
      g.quadraticCurveTo(MOUTH.x, y0 - 2, MOUTH.x + half, y0);
      g.quadraticCurveTo(MOUTH.x, y0 + d * 2.1 + 4, MOUTH.x - half, y0); g.fill();
      g.filter = "none";
      jaw(d);
    }
    // Blink: stretch the skin just above each eye down over it, with a lash line at the edge.
    if (s.blink > 0.02) for (const e of EYES) {
      const h = 24 * s.blink, top = e.y - 14, sx = e.x - e.w / 2 - 6, sw = e.w + 12;
      feathered(sx, top - 10, sw, 10, sx, top - 5, sw, 8 + h, 0.22);
      g.strokeStyle = `rgba(40,22,16,${0.55 * s.blink})`; g.lineWidth = 2.2;
      g.beginPath(); g.ellipse(e.x, top + h * 0.95, e.w * 0.42, 2.5, 0, 0, Math.PI); g.stroke();
    }
    g.restore();
    return true;
  }

  // Everything that shows the face registers here and gets a fresh frame.
  const views = new Set();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (draw(dt)) for (const v of views) v(canvas);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.DiaFace = {
    canvas,
    // Copy the face into a visible <canvas> each frame.
    mount(target) { const c = target.getContext("2d"); const v = src => c.drawImage(src, 0, 0, target.width, target.height); views.add(v); return () => views.delete(v); },
    onFrame(fn) { views.add(fn); return () => views.delete(fn); },
    // speaking: true/false. level: optional function returning 0..1 loudness of the real audio.
    speak(on, level = null) { state.speaking = !!on; state.level = on ? level : null; if (on) state.sylSpeed = 10 + Math.random() * 3; },
    // A word started (from the voice's boundary events): restart the syllable so the mouth stays in time.
    debug: state,
    word() { state.syl = 0.2; state.sylSpeed = 9 + Math.random() * 4; }
  };
})();
