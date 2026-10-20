// Dia's realistic body: a rigged, scanned-quality human (Microsoft Rocketbox, MIT licence) dressed in
// her green blazer, black top and charcoal trousers, with her face from dia.jpg on the head texture.
// Motion-captured clips move the body; facial blendshapes do the talking, blinking and smiling.
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

const DIR = "models/dia/";
const HEIGHT = 1.62; // in the cartoon root's units (it is scaled by 1.32), so about 2.1 in the world

function tex(name, srgb = true) {
  const t = new THREE.TextureLoader().load(DIR + name);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Long, dark, softly wavy hair: ribbons of strands that start under the model's own hair, fall down her
// back and over the front of her shoulders, like in her photos. Built once in the bind pose.
function hairTexture() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 1024;
  const g = c.getContext("2d");
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 520; i++) {
    const x0 = rnd() * 256, len = 700 + rnd() * 324, ph = rnd() * 6, amp = 3 + rnd() * 5;
    const l = 8 + rnd() * 22, hi = rnd() < 0.12;
    g.strokeStyle = hi ? `rgba(92,64,48,${0.5 + rnd() * 0.3})` : `rgba(${l + 6},${l},${l - 3},${0.65 + rnd() * 0.35})`;
    g.lineWidth = 1 + rnd() * 2.2;
    g.beginPath();
    for (let y = 0; y <= len; y += 16) { const x = x0 + Math.sin(y / 120 + ph) * amp * (0.4 + y / len); y ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // Soft sides and wispy ends.
  g.globalCompositeOperation = "destination-in";
  const h = g.createLinearGradient(0, 0, 256, 0);
  h.addColorStop(0, "rgba(0,0,0,0)"); h.addColorStop(0.15, "#000"); h.addColorStop(0.85, "#000"); h.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = h; g.fillRect(0, 0, 256, 1024);
  const v = g.createLinearGradient(0, 0, 0, 1024);
  v.addColorStop(0, "#000"); v.addColorStop(0.8, "#000"); v.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = v; g.fillRect(0, 0, 256, 1024);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Positions are in the model's space at its final size (1.62 tall, facing +Z, head centre about y 1.5).
function longHair() {
  const material = new THREE.MeshStandardMaterial({ map: hairTexture(), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.05 });
  const group = new THREE.Group(), N = 38, SEG = 24;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let layer = 0; layer < 2; layer++) for (let i = 0; i < N; i++) {
    const a = (-1 + 2 * (i + (layer ? 0.5 : 0)) / (N - 1)) * 2.35, side = Math.sign(a) || 1, f = sm(1.05, 1.95, Math.abs(a));
    const jit = Math.sin(i * 12.9898 + layer * 3) * 0.5, out = layer * 0.008, sx = Math.sin(a) * (0.1 + out), sz = -Math.cos(a) * (0.112 + out) - 0.036;
    const back = [[sx, 1.48, sz], [sx * 1.08, 1.4, -0.152 - out], [sx * 1.2, 1.32, -0.168 - out], [sx * 1.25, 1.2, -0.17 - out], [sx * 1.25, 1.06, -0.16 - out], [sx * 1.22, 0.96 + jit * 0.03, -0.152 - out]];
    const s = side * (1 + out * 6);
    const front = [[sx, 1.48, sz], [s * 0.106, 1.4, -0.03 + Math.cos(a) * 0.02], [s * 0.128, 1.35, 0.01], [s * 0.125, 1.28, 0.075 + out], [s * 0.13, 1.16, 0.118 + out], [s * 0.13, 1.03 + jit * 0.03, 0.12 + out]];
    const pts = back.map((b, k) => new THREE.Vector3(...b.map((v, j) => v + (front[k][j] - v) * f)));
    const curve = new THREE.CatmullRomCurve3(pts);
    const pos = [], uv = [], idx = [], w = 0.05 + (1 - f) * 0.012;
    for (let k = 0; k <= SEG; k++) {
      const u = k / SEG, c = curve.getPoint(u), tan = curve.getTangent(u);
      const outward = new THREE.Vector3(c.x, 0, c.z + 0.02).normalize(), across = new THREE.Vector3().crossVectors(tan, outward).normalize();
      c.addScaledVector(across, Math.sin(u * 9 + i) * 0.012 * u).addScaledVector(outward, Math.sin(u * 7 + i * 2) * 0.006 * u);
      const ww = w * (0.7 + u * 0.6);
      for (const e of [-1, 1]) { const q = c.clone().addScaledVector(across, e * ww / 2); pos.push(q.x, q.y, q.z); uv.push(((i * 0.37 + layer * 0.5) % 1) * 0.5 + (e + 1) * 0.25, 1 - u); }
      if (k) { const b = (k - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material); m.castShadow = true; group.add(m);
  }
  return group;
}

function clipsFrom(json) {
  return Object.entries(json).map(([name, c]) => new THREE.AnimationClip(name, c.duration,
    c.tracks.map(t => new THREE.QuaternionKeyframeTrack(t.n, t.t, t.v))));
}

export async function loadRealDia() {
  const manager = new THREE.LoadingManager();
  // The model points at its original .tga files; we use our own textures, so ignore those.
  manager.addHandler(/\.tga$/i, { load: () => new THREE.Texture(), setPath() { return this; }, path: "" });
  const json = name => fetch(DIR + name).then(r => { if (!r.ok) throw new Error(name + " " + r.status); return r.json(); });
  const [model, anims, shape] = await Promise.all([new FBXLoader(manager).loadAsync(DIR + "dia.fbx"), json("animations.json"), json("face_shape.json").catch(() => null)]);

  const skin = new THREE.MeshStandardMaterial({ map: tex("head.webp"), normalMap: tex("head_n.webp", false), roughness: 0.55, metalness: 0 });
  const cloth = new THREE.MeshStandardMaterial({ map: tex("body.webp"), normalMap: tex("body_n.webp", false), roughness: 0.78, metalness: 0 });
  const hair = new THREE.MeshStandardMaterial({ map: tex("hair.webp"), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.5, metalness: 0 });
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    const pick = m => /head/i.test(m.name) ? skin : /opacity/i.test(m.name) ? hair : cloth;
    o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
  });

  // Her face shape: vertex offsets fitted from 468 matching points on her photo and on this head
  // (jaw, cheeks, nose and mouth move to her proportions; the eyes stay where the eyeballs are).
  if (shape) model.traverse(o => {
    if (!o.isMesh || !o.morphTargetDictionary) return;
    const p = o.geometry.attributes.position;
    shape.i.forEach((v, k) => p.setXYZ(v, p.getX(v) + shape.d[k * 3], p.getY(v) + shape.d[k * 3 + 1], p.getZ(v) + shape.d[k * 3 + 2]));
    // The stock model's fringe falls across her forehead; Dia wears a centre parting, so those hair cards go.
    for (const t of shape.hide || []) for (const v of [3 * t + 1, 3 * t + 2]) p.setXYZ(v, p.getX(3 * t), p.getY(3 * t), p.getZ(3 * t));
    p.needsUpdate = true; o.geometry.computeBoundingSphere();
  });
  const box = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(HEIGHT / (box.max.y - box.min.y));
  model.userData.agentId = "dia";
  model.updateMatrixWorld(true);
  const neck = model.getObjectByName("Bip01_Neck");
  if (neck) neck.attach(longHair());

  const clips = clipsFrom(anims);
  const main = animate(model, clips);
  // Another Dia that shares the same body and clips, for example to greet visitors at reception.
  main.copy = () => { const m = clone(model); m.userData.agentId = "dia"; return animate(m, clips); };
  return main;
}

// Body clips, facial blendshapes, blinking and lip-sync for one instance of the model.
function animate(model, clips) {
  let face = null;
  model.traverse(o => { if (o.isMesh && o.morphTargetDictionary && !face) face = o; });
  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(clips.map(c => [c.name, mixer.clipAction(c)]));
  actions.wave?.setLoop(THREE.LoopOnce, 1);
  let current = actions.listen || actions.idle;
  current?.play();
  function to(name, fade = 0.6) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset().play(); current?.crossFadeTo(next, fade, false); current = next;
  }

  const dict = face?.morphTargetDictionary || {}, inf = face?.morphTargetInfluences || [];
  const idx = n => Object.keys(dict).find(k => k.endsWith(n));
  const M = Object.fromEntries(["AA_VI_10_aa", "AA_VI_13_O", "AA_VI_11_E", "AK_25_JawOpen", "AK_09_EyeBlinkLeft", "AK_10_EyeBlinkRight",
    "AK_44_MouthSmileLeft", "AK_45_MouthSmileRight", "AK_03_BrowInnerUp"].map(n => [n, dict[idx(n)]]));
  const set = (n, v) => { if (M[n] !== undefined) inf[M[n]] = v; };

  let waving = 0, t = Math.random() * 5, talking = false;
  return {
    model,
    wave() { if (actions.wave) { waving = actions.wave.getClip().duration; to("wave", 0.3); } },
    update(dt, speaking = false) {
      t += dt;
      mixer.update(dt);
      if (waving > 0) { waving -= dt; if (waving <= 0.4) to(speaking ? "talk" : "listen", 0.5); }
      else if (speaking !== talking) to(speaking ? "talk" : "listen", 0.5);
      talking = speaking;
      // The mouth follows the same voice level that animates the chat portrait.
      const f = window.DiaFace?.debug || {};
      const open = speaking ? f.open || 0 : 0, shape = Math.sin(t * 5.3) * 0.5 + 0.5;
      set("AA_VI_10_aa", open * (0.75 - shape * 0.35));
      set("AA_VI_13_O", open * shape * 0.45);
      set("AA_VI_11_E", open * (1 - shape) * 0.3);
      set("AK_25_JawOpen", open * 0.25);
      set("AK_09_EyeBlinkLeft", f.blink || 0); set("AK_10_EyeBlinkRight", f.blink || 0);
      const smile = speaking ? 0.35 : 0.55 + Math.sin(t * 0.4) * 0.05;
      set("AK_44_MouthSmileLeft", smile); set("AK_45_MouthSmileRight", smile);
      set("AK_03_BrowInnerUp", speaking ? 0.15 + Math.max(0, Math.sin(t * 1.7)) * 0.2 : 0.05);
    }
  };
}
