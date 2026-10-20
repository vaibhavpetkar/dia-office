// 3D office floor: rooms, desks and people built from simple shapes with three.js.
// The page talks to it through window.Office3D (see the bottom of this file).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const host = document.getElementById("floor3d");
const SKIN = ["#d39a72", "#c58660", "#e0b08c", "#b77651", "#a96a46", "#dba680"];
const DEPT = {
  dia: { name: "Dia's Cabin", color: "#0f8a84", x: 0, z: -6.2, w: 12, d: 5.6 },
  hr: { name: "HR", color: "#d23a5f", x: -6.6, z: 0.4, w: 12.4, d: 5.6 },
  sales: { name: "Sales", color: "#e0a020", x: 6.6, z: 0.4, w: 12.4, d: 5.6 },
  eng: { name: "Engineering", color: "#3b7dd8", x: -6.6, z: 6.6, w: 12.4, d: 5.6 },
  mkt: { name: "Marketing", color: "#8a5bd0", x: 6.6, z: 6.6, w: 12.4, d: 5.6 },
  support: { name: "Support", color: "#12a39c", x: -6.6, z: 12.8, w: 12.4, d: 5.6 },
  fin: { name: "Finance", color: "#4f8f3a", x: 6.6, z: 12.8, w: 12.4, d: 5.6 }
};
// Floor 2: sixteen more departments, ready for hires. Each has a head's cabin and six open desks.
const MORE = [["product", "Product", "#e4572e"], ["design", "UI/UX Design", "#d6457f"], ["qa", "QA & Testing", "#2a9d8f"], ["data", "Data & AI", "#5b5bd6"],
  ["cloud", "Cloud & DevOps", "#2f80c2"], ["security", "Security", "#4a5568"], ["mobile", "Mobile Apps", "#e09f1f"], ["rnd", "R&D Lab", "#7a4fd0"],
  ["success", "Customer Success", "#16a37a"], ["content", "Content Studio", "#c0507a"], ["events", "Events", "#d9822b"], ["partners", "Partnerships", "#3d8b8b"],
  ["legal", "Legal", "#6b5b4b"], ["ops", "Operations", "#577590"], ["admin", "Admin & Facilities", "#8d6e63"], ["training", "Training", "#6a994e"]];
MORE.forEach(([k, name, color], i) => (DEPT[k] = { name, color, floor: 2, x: -11.1 + (i % 4) * 7.4, z: -1.0 + Math.floor(i / 4) * 4.9, w: 7.2, d: 4.7 }));
const FLOOR_GAP = 8;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Renderer, camera, light ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Three storeys: 0 = ground (canteen, kitchen, reception), 1 = Dia and the core teams, 2 = more departments.
const levels = [0, 1, 2].map(n => { const g = new THREE.Group(); g.position.y = (n - 1) * FLOOR_GAP; g.visible = n === 1; scene.add(g); return g; });
const level1 = levels[1];
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
camera.position.set(0, 17, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 3.4);
controls.enableDamping = true;
controls.minDistance = 8;
controls.maxDistance = 42;
controls.maxPolarAngle = 1.32;
controls.enablePan = true;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight("#fff8ee", "#7a8a84", 1.6));
const sun = new THREE.DirectionalLight("#fff3e0", 2.4);
sun.position.set(-10, 22, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
sun.shadow.bias = -0.0004;
scene.add(sun);
const fill = new THREE.DirectionalLight("#cfe8ff", 0.6);
fill.position.set(12, 8, -6);
scene.add(fill);

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...o });
const mesh = (geo, material, { cast = true, receive = false } = {}) => {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
};

/* ---------- Text as textures ---------- */
function textTexture(lines, { w = 512, h = 128, bg = null, fg = "#1b2a26", font = "600 54px Mukta, system-ui, sans-serif", sub = "500 34px Mukta, system-ui, sans-serif", radius = 24 } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, radius); g.fill(); }
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
  const [a, b] = Array.isArray(lines) ? lines : [lines];
  g.font = font; g.fillText(a, w / 2, b ? h * 0.36 : h / 2, w - 20);
  if (b) { g.font = sub; g.globalAlpha = 0.75; g.fillText(b, w / 2, h * 0.74, w - 20); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/* ---------- The floor and rooms ---------- */
const floorGeo = new THREE.PlaneGeometry(30, 28);
const floor = mesh(floorGeo, mat("#e9ece6", { roughness: 0.9 }), { cast: false, receive: true });
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 4.2);
level1.add(floor);
// Wood-look strips so the floor doesn't read as a flat plane.
for (let i = -14; i <= 14; i += 1) {
  const strip = mesh(new THREE.PlaneGeometry(0.02, 28), mat("#d9ddd5"), { cast: false, receive: true });
  strip.rotation.x = -Math.PI / 2; strip.position.set(i, 0.002, 4.2); level1.add(strip);
}

const rooms = {};
for (const [k, r] of Object.entries(DEPT)) {
  const g = new THREE.Group(); g.position.set(r.x, 0, r.z); levels[r.floor ?? 1].add(g);
  const rug = mesh(new THREE.PlaneGeometry(r.w - 0.3, r.d - 0.3), mat(new THREE.Color(r.color).lerp(new THREE.Color("#ffffff"), 0.82), { roughness: 1 }), { cast: false, receive: true });
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.01; g.add(rug);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(r.w - 0.3, 0.01, r.d - 0.3)), new THREE.LineBasicMaterial({ color: r.color, transparent: true, opacity: 0.55 }));
  edge.position.y = 0.02; g.add(edge);
  // Low glass partition along the back and sides.
  const glass = new THREE.MeshPhysicalMaterial({ color: "#dff3f1", transmission: 0.6, transparent: true, opacity: 0.35, roughness: 0.15, thickness: 0.05 });
  const back = mesh(new THREE.BoxGeometry(r.w - 0.3, 1.1, 0.06), glass, { cast: false });
  back.position.set(0, 0.55, -r.d / 2 + 0.15); g.add(back);
  for (const s of [-1, 1]) {
    const side = mesh(new THREE.BoxGeometry(0.06, 1.1, r.d * 0.45), glass, { cast: false });
    side.position.set(s * (r.w / 2 - 0.15), 0.55, -r.d * 0.27); g.add(side);
  }
  const frame = mesh(new THREE.BoxGeometry(r.w - 0.3, 0.06, 0.1), mat(r.color));
  frame.position.set(0, 1.12, -r.d / 2 + 0.15); g.add(frame);
  // Room sign on the back glass.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(r.floor === 2 ? 2.2 : 2.6, r.floor === 2 ? 0.55 : 0.65), new THREE.MeshBasicMaterial({
    map: textTexture(r.name, { bg: r.color, fg: "#ffffff", font: "700 64px 'Baloo 2', Mukta, system-ui, sans-serif" }), transparent: true }));
  sign.position.set(-r.w / 2 + (r.floor === 2 ? 1.5 : 1.8), 1.55, -r.d / 2 + 0.15); g.add(sign);
  // A plant in the corner (floor 2 has the head's cabin there instead).
  if (!r.floor) {
  const pot = mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.4, 16), mat("#c9774a"));
  pot.position.set(r.w / 2 - 0.6, 0.2, -r.d / 2 + 0.6); g.add(pot);
  for (let i = 0; i < 5; i++) {
    const leaf = mesh(new THREE.SphereGeometry(0.22, 12, 10), mat(i % 2 ? "#3f8f55" : "#2f7a46"));
    leaf.scale.set(1, 1.5, 1); leaf.position.set(r.w / 2 - 0.6 + Math.cos(i * 1.3) * 0.15, 0.62 + i * 0.07, -r.d / 2 + 0.6 + Math.sin(i * 1.3) * 0.15);
    g.add(leaf);
  }
  }
  rooms[k] = { group: g, ...r, level: levels[r.floor ?? 1], slots: 0 };
}

// Dia's cabin: big window, her desk and a sofa.
{
  const r = rooms.dia, g = r.group;
  const sky = document.createElement("canvas"); sky.width = 16; sky.height = 256;
  const sg = sky.getContext("2d"), grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#7fc4e8"); grad.addColorStop(0.65, "#fde2b8"); grad.addColorStop(1, "#f6b26b");
  sg.fillStyle = grad; sg.fillRect(0, 0, 16, 256);
  const skyTex = new THREE.CanvasTexture(sky); skyTex.colorSpace = THREE.SRGBColorSpace;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.6), new THREE.MeshBasicMaterial({ map: skyTex }));
  win.position.set(1.2, 2.2, -r.d / 2 + 0.1); g.add(win);
  for (let i = -3; i <= 4; i++) {
    const bar = mesh(new THREE.BoxGeometry(0.06, 2.7, 0.08), mat("#2b3b38"));
    bar.position.set(1.2 + i * 1, 2.2, -r.d / 2 + 0.12); if (i > -4 && i < 4.5) g.add(bar);
  }
  // City skyline in the window.
  for (let i = 0; i < 12; i++) {
    const h = 0.4 + ((i * 37) % 9) / 10;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.5, h), new THREE.MeshBasicMaterial({ color: i % 2 ? "#5d7e8f" : "#4b6a7a" }));
    b.position.set(-2.1 + i * 0.6, 0.9 + h / 2, -r.d / 2 + 0.11); g.add(b);
  }
  // Her portrait on the cabin wall.
  const photo = new THREE.TextureLoader().load("dia-frame.jpg"); photo.colorSpace = THREE.SRGBColorSpace;
  const frame = mesh(new THREE.BoxGeometry(1.36, 1.44, 0.06), mat("#2b1d14", { roughness: 0.4 }));
  frame.position.set(-4.1, 2.8, -r.d / 2 + 0.14); g.add(frame);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.28), new THREE.MeshBasicMaterial({ map: photo }));
  pic.position.set(-4.1, 2.8, -r.d / 2 + 0.18); g.add(pic);
  const desk = mesh(new THREE.BoxGeometry(3, 0.12, 1.2), mat("#5b3a29", { roughness: 0.45 }), { receive: true });
  desk.position.set(-2.6, 0.8, -0.6); g.add(desk);
  for (const [x, z] of [[-1.35, -0.5], [1.35, -0.5], [-1.35, 0.5], [1.35, 0.5]]) {
    const leg = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8), mat("#2b2b2b"));
    leg.position.set(-2.6 + x, 0.4, -0.6 + z); g.add(leg);
  }
  const lamp = mesh(new THREE.SphereGeometry(0.16, 16, 12), mat("#ffe7b0", { emissive: "#ffcf70", emissiveIntensity: 1.2 }));
  lamp.position.set(-3.7, 1.15, -0.8); g.add(lamp);
  const sofa = mesh(new THREE.BoxGeometry(2.6, 0.45, 0.9), mat("#d9935a"), { receive: true });
  sofa.position.set(3.8, 0.3, 0.6); g.add(sofa);
  const sofaBack = mesh(new THREE.BoxGeometry(2.6, 0.6, 0.25), mat("#c98048"));
  sofaBack.position.set(3.8, 0.75, 0.2); g.add(sofaBack);
}

/* ---------- The building: canteen below, more departments above, lifts and stairs on every floor ---------- */
const glassMat = new THREE.MeshPhysicalMaterial({ color: "#dff3f1", transmission: 0.6, transparent: true, opacity: 0.32, roughness: 0.15, thickness: 0.05 });
const FLOOR_NAMES = ["Ground floor · Canteen & kitchen", "Floor 1 · Dia & core teams", "Floor 2 · Departments"];
// Many identical things (chairs, tables, desks) are drawn as one instanced mesh each, so 100+ seats stay fast.
function instanced(geo, material, list, { cast = false, colors } = {}) {
  const m = new THREE.InstancedMesh(geo, material, list.length), o = new THREE.Object3D();
  list.forEach((t, i) => {
    o.position.set(t[0], t[1], t[2]); o.rotation.set(0, t[3] || 0, 0); o.scale.setScalar(t[4] ?? 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    if (colors) m.setColorAt(i, new THREE.Color(colors[i % colors.length]));
  });
  m.castShadow = cast; m.receiveShadow = true;
  return m;
}
function label(level, text, x, y, z, w = 2.4, color = "#1b2a26") {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({
    map: textTexture(text, { bg: color, fg: "#ffffff", font: "700 60px 'Baloo 2', Mukta, system-ui, sans-serif" }), transparent: true }));
  s.position.set(x, y, z); level.add(s); return s;
}
for (const [n, level] of levels.entries()) {
  // Concrete slab under each floor, so the building reads as storeys when you see all of it.
  const slab = mesh(new THREE.BoxGeometry(30.4, 0.3, 28.4), mat("#b9c0bb", { roughness: 0.95 }), { cast: false, receive: true });
  slab.position.set(0, -0.16, 4.2); level.add(slab);
  if (n !== 1) {
    const f = mesh(new THREE.PlaneGeometry(30, 28), mat(n === 0 ? "#efe6da" : "#e6ebef", { roughness: 0.9 }), { cast: false, receive: true });
    f.rotation.x = -Math.PI / 2; f.position.set(0, 0.001, 4.2); level.add(f);
  }
  // Floor name painted at the front edge.
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.1), new THREE.MeshBasicMaterial({ map: textTexture(FLOOR_NAMES[n].toUpperCase(),
    { w: 1024, h: 128, bg: "#1b2a26", fg: "#ffffff", font: "700 60px 'Baloo 2', Mukta, system-ui, sans-serif" }), transparent: true }));
  plaque.rotation.x = -Math.PI / 2; plaque.position.set(0, 0.02, 17.4); level.add(plaque);
  // Lift core, back left.
  const core = mesh(new THREE.BoxGeometry(3.6, 2.8, 2.4), mat("#8c969c", { roughness: 0.6 }));
  core.position.set(-11.6, 1.4, -7.2); level.add(core);
  for (const dx of [-0.85, 0.85]) {
    const door = mesh(new THREE.BoxGeometry(1.4, 2.2, 0.06), mat("#d5dbe0", { metalness: 0.8, roughness: 0.25 }), { cast: false });
    door.position.set(-11.6 + dx, 1.1, -5.98); level.add(door);
    const seam = mesh(new THREE.BoxGeometry(0.02, 2.2, 0.07), mat("#7a8288"), { cast: false }); seam.position.set(-11.6 + dx, 1.1, -5.96); level.add(seam);
  }
  label(level, `LIFTS · ${n === 0 ? "G" : n}`, -11.6, 2.55, -5.94, 2.2, "#2b3b38");
  // Stairwell, back right: ten steps up toward the next floor.
  for (let i = 0; i < 10; i++) {
    const step = mesh(new THREE.BoxGeometry(2.4, 0.22, 0.42), mat(i % 2 ? "#c8ced2" : "#d6dbde"), { receive: true });
    step.position.set(11.4, 0.11 + i * 0.22, -4.6 - i * 0.42); step.scale.y = 1 + i * 0.0; level.add(step);
  }
  const rail = mesh(new THREE.BoxGeometry(0.06, 0.06, 4.6), mat("#3a4448", { metalness: 0.6 }));
  rail.position.set(10.15, 1.9, -6.5); rail.rotation.x = -0.48; level.add(rail);
  label(level, "STAIRS", 11.4, 1.0, -4.1, 1.6, "#2b3b38");
}
// In the whole-building view, a glass lift shaft and the stair tower join the floors.
const shafts = new THREE.Group(); shafts.visible = false; scene.add(shafts);
for (const [x, w] of [[-11.6, 3.7], [11.4, 2.6]]) {
  const s = mesh(new THREE.BoxGeometry(w, FLOOR_GAP * 3.2 + 3, 2.6), glassMat, { cast: false });
  s.position.set(x, 1.5, -7.0); shafts.add(s);
}

/* Ground floor: reception, kitchen, serving counter and a 128-seat canteen. */
{
  const L = levels[0];
  const counter = mesh(new THREE.BoxGeometry(18, 1, 1.1), mat("#d9dde0", { metalness: 0.5, roughness: 0.3 }), { receive: true });
  counter.position.set(1, 0.5, -8.6); L.add(counter);
  label(L, "KITCHEN", 1, 2.6, -9.6, 2.4, "#b5502c");
  for (let i = 0; i < 4; i++) { // ranges with glowing burners, and hoods above
    const hob = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16), mat("#ff7a3a", { emissive: "#ff5a1a", emissiveIntensity: 0.8 }), { cast: false });
    hob.position.set(-5 + i * 1.3, 1.03, -8.6); L.add(hob);
    const hood = mesh(new THREE.BoxGeometry(1.1, 0.4, 0.9), mat("#aab2b8", { metalness: 0.7, roughness: 0.3 }));
    hood.position.set(-5 + i * 1.3, 2.3, -8.7); L.add(hood);
  }
  for (const x of [7, 8.2]) { const fr = mesh(new THREE.BoxGeometry(1.1, 2.3, 0.9), mat("#eef1f3", { metalness: 0.4, roughness: 0.3 })); fr.position.set(x, 1.15, -8.9); L.add(fr); }
  const serve = mesh(new THREE.BoxGeometry(14, 1, 0.8), mat("#8a5a3b", { roughness: 0.5 }), { receive: true });
  serve.position.set(1, 0.5, -5.6); L.add(serve);
  const glassGuard = mesh(new THREE.BoxGeometry(14, 0.5, 0.04), glassMat, { cast: false }); glassGuard.position.set(1, 1.3, -5.5); L.add(glassGuard);
  const foods = ["#e8b04a", "#c94c2c", "#6f9e3f", "#f2e3b3", "#a3542a", "#e07b39"];
  L.add(instanced(new THREE.BoxGeometry(0.8, 0.12, 0.45), mat("#ffffff", { roughness: 0.4 }), Array.from({ length: 12 }, (_, i) => [-4.6 + i * 1.02, 1.07, -5.6]), { colors: foods }));
  label(L, "FOOD COUNTER", 1, 2.1, -5.3, 2.6, "#b5502c");
  // Tables: 4 x 4, eight chairs each.
  const tables = [], chairs = [];
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    const x = -10.2 + c * 6.8, z = -1.4 + r * 4.1; tables.push([x, 0.74, z]);
    for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) chairs.push([x - 1.2 + k * 0.8, 0.45, z + sd * 0.75, sd > 0 ? Math.PI : 0]);
  }
  L.add(instanced(new THREE.BoxGeometry(3.4, 0.08, 1.0), mat("#c79a6b", { roughness: 0.5 }), tables, { cast: true }));
  L.add(instanced(new THREE.CylinderGeometry(0.06, 0.08, 0.72, 8), mat("#4a4f55"), tables.map(t => [t[0], 0.36, t[2]])));
  L.add(instanced(new THREE.BoxGeometry(0.46, 0.08, 0.42), mat("#2f8a84"), chairs, { colors: ["#2f8a84", "#e0a020", "#d23a5f", "#3b7dd8"] }));
  L.add(instanced(new THREE.BoxGeometry(0.46, 0.45, 0.06), mat("#2f8a84"), chairs.map(c => [c[0], 0.7, c[2] + (c[3] ? 0.2 : -0.2), c[3]]), { colors: ["#2f8a84", "#e0a020", "#d23a5f", "#3b7dd8"] }));
  // People having lunch, and three servers behind the counter (simple figures, drawn in one go).
  const diners = chairs.filter((_, i) => (i * 7) % 3 === 0).slice(0, 40), servers = [[-2.5, 0, -6.6], [1, 0, -6.6], [4.5, 0, -6.6]];
  const bodies = [...diners.map(c => [c[0], 0.78, c[2] + (c[3] ? 0.05 : -0.05)]), ...servers.map(s => [s[0], 1.0, s[2]])];
  const shirts = [...diners.map((_, i) => ["#c2264b", "#334a7a", "#2f8a4c", "#d9930f", "#7b4bb7", "#3a7d8c", "#8a5a2b"][i % 7]), ...servers.map(() => "#f4f4f2")];
  L.add(instanced(new THREE.CapsuleGeometry(0.2, 0.35, 4, 10), mat("#ffffff", { roughness: 0.7 }), bodies, { cast: true, colors: shirts }));
  L.add(instanced(new THREE.SphereGeometry(0.17, 14, 10), mat("#ffffff", { roughness: 0.5 }), bodies.map(b => [b[0], b[1] + 0.48, b[2]]), { colors: SKIN }));
  L.add(instanced(new THREE.CylinderGeometry(0.16, 0.13, 0.22, 12), mat("#ffffff"), servers.map(s => [s[0], 1.78, s[2]])));
  label(L, "CANTEEN · 128 SEATS", -10.2, 1.4, -3.6, 3, "#2f8a84");
  // Reception at the front door.
  const rec = mesh(new THREE.BoxGeometry(5, 1.1, 1), mat("#1b5e57", { roughness: 0.4 }), { receive: true }); rec.position.set(0, 0.55, 14.6); L.add(rec);
  const recTop = mesh(new THREE.BoxGeometry(5.2, 0.06, 1.2), mat("#f2c14e", { metalness: 0.5, roughness: 0.3 })); recTop.position.set(0, 1.13, 14.6); L.add(recTop);
  label(L, "INVEON TECHNOLOGIES · RECEPTION", 0, 1.9, 13.9, 4.6, "#0f6e6a");
}

/* Floor 2: a glass board room, and each department's head cabin and open desks. */
const openDesks = new Map(); // dept -> { meshes, slots: [{x,z}] }
{
  const L = levels[2];
  const board = mesh(new THREE.BoxGeometry(9, 1.6, 4), glassMat, { cast: false }); board.position.set(0, 0.8, -6.6); L.add(board);
  const table = mesh(new THREE.BoxGeometry(6, 0.1, 1.6), mat("#5b3a29", { roughness: 0.4 })); table.position.set(0, 0.75, -6.6); L.add(table);
  const bc = []; for (let i = 0; i < 6; i++) for (const sd of [-1, 1]) bc.push([-2.5 + i, 0.45, -6.6 + sd * 1.1, sd > 0 ? Math.PI : 0]);
  L.add(instanced(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat("#2b3b38"), bc));
  label(L, "BOARD ROOM", 0, 1.9, -4.55, 2.2, "#0f6e6a");
  const tops = [], legs = [], seats = [], screens = [], cabins = [], cabinDesks = [], heads = [];
  const zones = Object.entries(DEPT).filter(([, r]) => r.floor === 2);
  for (const [k, r] of zones) {
    const slots = [[-2.3, -0.9], [-0.2, -0.9], [-2.3, 1.2], [-0.2, 1.2], [1.9, 1.2]].map(([dx, dz]) => ({ x: r.x + dx, z: r.z + dz }));
    const first = tops.length;
    for (const s of slots) {
      tops.push([s.x, 0.74, s.z + 0.55]); seats.push([s.x, 0.45, s.z - 0.2]); screens.push([s.x, 1.0, s.z + 0.75]);
      for (const dx of [-0.7, 0.7]) legs.push([s.x + dx, 0.37, s.z + 0.55]);
    }
    openDesks.set(k, { first, slots });
    cabins.push([r.x + 2.55, 0.85, r.z - 1.35]); cabinDesks.push([r.x + 2.55, 0.74, r.z - 1.1]); heads.push(r.color);
  }
  const dTop = instanced(new THREE.BoxGeometry(1.6, 0.06, 0.8), mat("#e8e2d6", { roughness: 0.6 }), tops, { cast: true });
  const dLeg = instanced(new THREE.BoxGeometry(0.05, 0.72, 0.7), mat("#9aa5a0"), legs);
  const dSeat = instanced(new THREE.BoxGeometry(0.55, 0.5, 0.55), mat("#3b4148"), seats);
  const dScreen = instanced(new THREE.BoxGeometry(0.6, 0.38, 0.04), mat("#22282c", { roughness: 0.3 }), screens);
  for (const m of [dTop, dLeg, dSeat, dScreen]) L.add(m);
  openDesks.meshes = { dTop, dLeg, dSeat, dScreen };
  L.add(instanced(new THREE.BoxGeometry(1.9, 1.7, 1.9), glassMat, cabins));
  L.add(instanced(new THREE.BoxGeometry(1.3, 0.06, 0.6), mat("#5b3a29", { roughness: 0.45 }), cabinDesks, { colors: heads }));
}
// A new hire on floor 2 sits at the next open desk of their department, which stops being drawn as empty.
function openDesk(r, i) {
  const z = [...openDesks.entries()].find(([k]) => DEPT[k] === r);
  const info = z?.[1], slot = info?.slots[i % 5] || { x: r.x, z: r.z };
  if (info && i < 5) {
    const hide = new THREE.Matrix4().makeScale(0, 0, 0), { dTop, dLeg, dSeat, dScreen } = openDesks.meshes, n = info.first + i;
    for (const [m, idx] of [[dTop, n], [dSeat, n], [dScreen, n], [dLeg, n * 2], [dLeg, n * 2 + 1]]) { m.setMatrixAt(idx, hide); m.instanceMatrix.needsUpdate = true; }
  }
  return { x: slot.x, z: slot.z + (i >= 5 ? 0.3 * Math.floor(i / 5) : 0) };
}

/* ---------- People ---------- */
function hair(style, color, scale = 1) {
  const g = new THREE.Group(), m = mat(color, { roughness: 0.38, metalness: 0.05 });
  const cap = mesh(new THREE.SphereGeometry(0.385, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), m);
  cap.rotation.x = -0.42; cap.position.set(0, 0.04, -0.03); g.add(cap);
  // Side-swept fringe with a parting, so the forehead and eyes stay visible.
  const fringe = mesh(new THREE.SphereGeometry(0.395, 24, 10, -Math.PI * 0.05, Math.PI * 0.5, Math.PI * 0.2, Math.PI * 0.13), m);
  fringe.rotation.set(-0.15, 0, 0.18); g.add(fringe);
  if (style === "long" || style === "dia") {
    const back = mesh(new THREE.CapsuleGeometry(0.33, style === "dia" ? 0.95 : 0.55, 8, 20), m);
    back.position.set(0, style === "dia" ? -0.55 : -0.35, -0.16); back.scale.set(1.08, 1, 0.62); g.add(back);
    for (const s of [-1, 1]) {
      const lock = mesh(new THREE.CapsuleGeometry(0.1, style === "dia" ? 0.7 : 0.35, 6, 12), m);
      lock.position.set(s * 0.31, style === "dia" ? -0.42 : -0.25, 0.06); lock.rotation.z = s * 0.08; g.add(lock);
      // Soft waves: a chain of curls down the front of each shoulder.
      if (style === "dia") for (let i = 0; i < 3; i++) {
        const c = mesh(new THREE.CapsuleGeometry(0.075 - i * 0.012, 0.32, 6, 12), m);
        c.position.set(s * (0.34 + i * 0.03), -0.3 - i * 0.28, 0.1 - i * 0.02); c.rotation.z = s * (i % 2 ? -0.18 : 0.12); c.scale.z = 0.7; g.add(c);
      }
    }
  }
  if (style === "bun") { const bun = mesh(new THREE.SphereGeometry(0.17, 16, 12), m); bun.position.set(0, 0.38, -0.18); g.add(bun); }
  if (style === "curly") for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2, c = mesh(new THREE.SphereGeometry(0.12, 12, 10), m);
    c.position.set(Math.cos(a) * 0.3, 0.22 + Math.sin(i * 2.1) * 0.05, Math.sin(a) * 0.26 - 0.04); g.add(c);
  }
  g.scale.setScalar(scale);
  return g;
}

function makePerson(a, { scale = 1, dia = false } = {}) {
  const look = a.look || {};
  const skin = mat(dia ? "#c98a64" : SKIN[look.skin ?? 0] || SKIN[0], { roughness: 0.5 });
  const shirtColor = dia ? "#1f6b45" : look.shirt || "#2b6cb0";
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body); root.userData.agentId = a.id;

  const torso = mesh(new THREE.CapsuleGeometry(0.33, 0.48, 8, 20), mat(shirtColor, { roughness: 0.7 }));
  torso.position.y = 0.95; torso.scale.set(1, 1, 0.78); body.add(torso);
  if (dia) {
    // Green blazer over a black satin top, slim trousers and a fine silver pendant (from her portrait).
    const lapelMat = mat("#1a5236", { roughness: 0.75 });
    const top = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.15, 0), new THREE.Vector2(0.15, 0), new THREE.Vector2(0, -0.36)])),
      mat("#111214", { roughness: 0.25, metalness: 0.2 }));
    top.position.set(0, 1.4, 0.262); body.add(top);
    const skin2 = mat("#c98a64", { roughness: 0.5 });
    const chest = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.12, 0), new THREE.Vector2(0.12, 0), new THREE.Vector2(0, -0.12)])), skin2);
    chest.position.set(0, 1.43, 0.264); body.add(chest);
    for (const s of [-1, 1]) {
      const lapel = mesh(new THREE.BoxGeometry(0.075, 0.46, 0.03), lapelMat);
      lapel.position.set(s * 0.1, 1.22, 0.272); lapel.rotation.set(0.05, s * 0.25, -s * 0.3); body.add(lapel);
    }
    const button = mesh(new THREE.SphereGeometry(0.024, 10, 8), mat("#0d2d1e")); button.position.set(0, 0.86, 0.262); body.add(button);
    const hem = mesh(new THREE.CylinderGeometry(0.34, 0.37, 0.22, 24), mat("#1f6b45", { roughness: 0.7 })); hem.position.y = 0.6; hem.scale.z = 0.8; body.add(hem);
    for (const s of [-0.13, 0.13]) {
      const leg = mesh(new THREE.CapsuleGeometry(0.11, 0.42, 6, 12), mat("#15161a"));
      leg.position.set(s, 0.32, 0); body.add(leg);
    }
    const silver = mat("#e3e6ea", { metalness: 0.9, roughness: 0.2 });
    for (const s of [-1, 1]) {
      const chain = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), silver, { cast: false });
      chain.position.set(s * 0.05, 1.38, 0.268); chain.rotation.z = s * 0.5; body.add(chain);
    }
    const pendant = mesh(new THREE.OctahedronGeometry(0.022), silver); pendant.position.set(0, 1.29, 0.275); body.add(pendant);
  } else {
    const collar = mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 20), mat(new THREE.Color(shirtColor).lerp(new THREE.Color("#ffffff"), 0.35)));
    collar.position.y = 1.43; collar.rotation.x = Math.PI / 2; body.add(collar);
    for (const s of [-0.13, 0.13]) {
      const leg = mesh(new THREE.CapsuleGeometry(0.11, 0.4, 6, 12), mat("#2f3640"));
      leg.position.set(s, 0.32, 0); body.add(leg);
    }
  }
  const neck = mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.16, 12), skin);
  neck.position.y = 1.48; body.add(neck);

  // Arms hinge at the shoulder so they can type or wave.
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.4, 1.32, 0); body.add(pivot);
    const upper = mesh(new THREE.CapsuleGeometry(0.095, 0.42, 6, 12), mat(shirtColor, { roughness: 0.7 }));
    upper.position.y = -0.28; pivot.add(upper);
    const hand = mesh(new THREE.SphereGeometry(0.1, 12, 10), skin); hand.position.y = -0.56; pivot.add(hand);
    pivot.rotation.z = s * 0.12;
    arms.push(pivot);
  }

  // Head with a friendly face.
  const head = new THREE.Group(); head.position.y = 1.86; body.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.36, 32, 24), skin); skull.scale.set(1, 1.04, 0.98); head.add(skull);
  for (const s of [-1, 1]) { const ear = mesh(new THREE.SphereGeometry(0.075, 10, 8), skin); ear.position.set(s * 0.35, -0.02, 0); ear.scale.set(0.6, 1, 0.8); head.add(ear); }
  const eyes = new THREE.Group(); eyes.position.set(0, 0.03, 0.3); head.add(eyes);
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.x = s * 0.125; eyes.add(e);
    const white = new THREE.Mesh(new THREE.SphereGeometry(dia ? 0.078 : 0.068, 16, 12), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3 }));
    white.scale.set(1, dia ? 1.1 : 1, 0.55); e.add(white);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(dia ? 0.054 : 0.046, 16, 12), new THREE.MeshStandardMaterial({ color: dia ? "#3b2416" : "#2a1d16", roughness: 0.2 }));
    iris.position.z = 0.03; iris.scale.z = 0.5; e.add(iris);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    glint.position.set(0.016, 0.018, 0.055); e.add(glint);
    if (dia) for (let i = -1; i <= 1; i++) {
      const lash = mesh(new THREE.BoxGeometry(0.012, 0.045, 0.01), mat("#1a1210"), { cast: false });
      lash.position.set(s * 0.03 + i * 0.03, 0.07, 0.03); lash.rotation.z = -s * 0.35 + i * 0.25; e.add(lash);
    }
    const brow = mesh(new THREE.BoxGeometry(0.12, 0.022, 0.02), mat(look.hair || "#2a1a14"), { cast: false });
    brow.position.set(s * 0.125, 0.15, 0.31); brow.rotation.z = s * 0.14; head.add(brow);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: "#f08a8a", transparent: true, opacity: 0.45, roughness: 1 }));
    cheek.position.set(s * 0.2, -0.08, 0.27); cheek.scale.set(1, 0.6, 0.4); head.add(cheek);
  }
  const nose = mesh(new THREE.SphereGeometry(0.035, 10, 8), skin, { cast: false }); nose.position.set(0, -0.04, 0.35); head.add(nose);
  // Smile (always) and an open mouth that shows while talking.
  const smile = mesh(new THREE.TorusGeometry(0.085, 0.017, 8, 24, Math.PI), mat(dia ? "#b8344f" : "#8a3a32", { roughness: 0.4 }), { cast: false });
  smile.position.set(0, -0.12, 0.32); smile.rotation.set(-0.25, 0, Math.PI); head.add(smile);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10), new THREE.MeshStandardMaterial({ color: "#5a1a22", roughness: 0.6 }));
  mouth.position.set(0, -0.15, 0.31); mouth.scale.set(1.1, 0.05, 0.4); head.add(mouth);
  if (look.bindi || dia) { const b = mesh(new THREE.SphereGeometry(0.022, 10, 8), mat("#c2264b"), { cast: false }); b.position.set(0, 0.17, 0.345); head.add(b); }
  if (look.glasses) {
    const gm = mat("#1d1d1d", { metalness: 0.3 });
    for (const s of [-1, 1]) { const ring = mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 20), gm, { cast: false }); ring.position.set(s * 0.125, 0.03, 0.36); head.add(ring); }
    const bridge = mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), gm, { cast: false }); bridge.position.set(0, 0.04, 0.37); head.add(bridge);
  }
  if (dia) for (const s of [-1, 1]) { // small silver hoops
    const ring = mesh(new THREE.TorusGeometry(0.038, 0.009, 8, 20), mat("#e3e6ea", { metalness: 0.9, roughness: 0.2 }));
    ring.position.set(s * 0.355, -0.1, 0.03); ring.rotation.y = Math.PI / 2; head.add(ring);
  }
  head.add(hair(dia ? "dia" : look.style || "short", look.hair || (dia ? "#120b08" : "#1e1614")));
  if (look.headset) {
    const band = mesh(new THREE.TorusGeometry(0.39, 0.022, 8, 24, Math.PI), mat("#222")); band.position.y = 0.02; head.add(band);
    const mic = mesh(new THREE.CapsuleGeometry(0.018, 0.2, 4, 8), mat("#222")); mic.position.set(-0.3, -0.18, 0.16); mic.rotation.set(0.9, 0.5, 0); head.add(mic);
  }
  // AI agents get a small floating gem; humans don't.
  let gem = null;
  if (a.kind !== "human" && !dia) {
    gem = mesh(new THREE.OctahedronGeometry(0.09), mat("#2ec4b6", { emissive: "#2ec4b6", emissiveIntensity: 0.9, roughness: 0.2 }));
    gem.position.y = 2.42; body.add(gem);
  }
  root.scale.setScalar(scale);
  return { root, body, head, eyes, arms, mouth, smile, gem, speaking: false, working: false, wave: 0, t: Math.random() * 10 };
}

/* ---------- Desks ---------- */
function makeDesk(color, name, role) {
  const g = new THREE.Group();
  const top = mesh(new THREE.BoxGeometry(1.7, 0.08, 0.85), mat("#efe6d6", { roughness: 0.5 }), { receive: true });
  top.position.y = 0.74; g.add(top);
  const front = mesh(new THREE.BoxGeometry(1.7, 0.55, 0.05), mat(new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.55)));
  front.position.set(0, 0.45, 0.4); g.add(front);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), new THREE.MeshBasicMaterial({ map: textTexture([name, role], { bg: "#ffffff", fg: "#1b2a26" }), transparent: true }));
  plate.position.set(0, 0.47, 0.43); g.add(plate);
  for (const x of [-0.8, 0.8]) { const leg = mesh(new THREE.BoxGeometry(0.05, 0.72, 0.8), mat("#9aa5a0")); leg.position.set(x, 0.36, 0); g.add(leg); }
  // Laptop facing the person; its lid glows when they are working.
  const base = mesh(new THREE.BoxGeometry(0.6, 0.03, 0.4), mat("#c9ced3", { metalness: 0.5, roughness: 0.35 }));
  base.position.set(0, 0.795, 0.05); g.add(base);
  const lid = new THREE.Group(); lid.position.set(0, 0.81, 0.24); lid.rotation.x = -0.25; g.add(lid);
  const lidBack = mesh(new THREE.BoxGeometry(0.6, 0.4, 0.025), mat("#c9ced3", { metalness: 0.5, roughness: 0.35 }));
  lidBack.position.y = 0.2; lid.add(lidBack);
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), mat(color, { emissive: color, emissiveIntensity: 0.15 }));
  logo.position.set(0, 0.2, 0.014); lid.add(logo);
  const mug = mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.13, 14), mat(color)); mug.position.set(0.62, 0.84, 0.15); g.add(mug);
  const chair = new THREE.Group(); chair.position.set(0, 0, -0.75); g.add(chair);
  const seat = mesh(new THREE.BoxGeometry(0.6, 0.08, 0.55), mat("#3b4148")); seat.position.y = 0.45; chair.add(seat);
  const back = mesh(new THREE.BoxGeometry(0.6, 0.7, 0.08), mat("#3b4148")); back.position.set(0, 0.85, -0.27); chair.add(back);
  const post = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), mat("#6b737b")); post.position.y = 0.22; chair.add(post);
  return { group: g, logo };
}

/* ---------- Office state ---------- */
const people = new Map(); // id -> { person, desk, anchor }
const bubbles = new Map(); // id -> HTMLElement
const overlay = document.createElement("div"); overlay.className = "o3d-overlay"; host.appendChild(overlay);
let selectedId = "dia", selRing;
{
  selRing = mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: "#0f8a84" }), { cast: false });
  selRing.rotation.x = Math.PI / 2; selRing.position.y = 0.03; level1.add(selRing);
}

function bubbleEl(id) {
  if (!bubbles.has(id)) { const b = document.createElement("div"); b.className = "o3d-bub"; b.hidden = true; overlay.appendChild(b); bubbles.set(id, b); }
  return bubbles.get(id);
}

function addPerson(a) {
  if (a.id === "dia") {
    const p = makePerson(a, { scale: 1.32, dia: true });
    p.root.position.set(-0.6, 0, -5.9); p.root.rotation.y = 0.12;
    level1.add(p.root);
    people.set("dia", { person: p, level: level1, anchor: new THREE.Vector3(-0.6, 3.25, -5.9) });
    return;
  }
  const r = rooms[a.dept] || rooms.eng;
  const i = r.slots++;
  let x, z;
  if (r.floor === 2) { const s = openDesk(r, i); x = s.x; z = s.z; } // takes over one of the zone's open desks
  else { const cols = 5; x = r.x - r.w / 2 + 1.5 + (i % cols) * 2.35; z = r.z - 0.6 + Math.floor(i / cols) * 0.1; }
  const d = makeDesk(r.color, a.name, a.role);
  d.group.position.set(x, 0, z + 0.55); r.level.add(d.group);
  const p = makePerson(a);
  p.root.position.set(x, -0.38, z - 0.15);
  p.desk = d;
  r.level.add(p.root);
  if (!reduceMotion) { p.root.scale.setScalar(0.01); p.pop = 0; }
  people.set(a.id, { person: p, level: r.level, anchor: new THREE.Vector3(x, 2.55, z - 0.15) });
}

/* ---------- Document hand-offs ---------- */
const flights = [];
function handoff(from, to, label) {
  const A = people.get(from), B = people.get(to);
  if (!A || !B) return;
  if (A.level !== B.level || !A.level.visible) return; // only fly paper within the floor you're looking at
  const paper = mesh(new THREE.BoxGeometry(0.42, 0.02, 0.3), mat("#ffd36b", { emissive: "#f2a516", emissiveIntensity: 0.5 }));
  A.level.add(paper);
  const tag = document.createElement("div"); tag.className = "o3d-doc"; tag.textContent = label; overlay.appendChild(tag);
  const y = A.level.position.y, a = A.anchor.clone().setY(1.6 + y), b = B.anchor.clone().setY(1.6 + y), mid = a.clone().lerp(b, 0.5).setY(4.2 + y);
  flights.push({ paper, tag, a, b, mid, t: 0, level: A.level });
}

/* ---------- Picking ---------- */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener("pointerdown", e => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener("pointerup", e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // that was a drag
  const id = pick(e);
  if (id) { select(id); api.onSelect?.(id); }
});
renderer.domElement.addEventListener("pointermove", e => { renderer.domElement.style.cursor = pick(e) ? "pointer" : "grab"; });
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  for (const hit of ray.intersectObjects([...people.values()].filter(p => p.level.visible).map(p => p.person.root), true)) {
    let o = hit.object; while (o && !o.userData.agentId) o = o.parent;
    if (o) return o.userData.agentId;
  }
  return null;
}
function select(id) {
  selectedId = id;
  const p = people.get(id);
  if (p) { p.level.add(selRing); selRing.position.set(p.person.root.position.x, 0.03, p.person.root.position.z); selRing.scale.setScalar(id === "dia" ? 1.3 : 1); }
}

/* ---------- Animation ---------- */
const clock = new THREE.Clock(), v = new THREE.Vector3(), v2 = new THREE.Vector3();
// Pull the camera back just far enough that the whole floor fits the stage, wide or narrow.
const VIEW_DIR = new THREE.Vector3(0, 0.66, 0.75).normalize(), HOME = new THREE.Vector3(0, 0.6, 3.4);
function homeDistance() {
  const v = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  // The front rows sit closer to the camera and look wider, hence the extra 25% on width.
  return Math.max(13.2 * 1.25 / Math.tan(hfov / 2), 13.6 / Math.tan(v / 2)) * 0.98;
}
let closeUp = false, view = "f1";
const ALL_DIR = new THREE.Vector3(0.62, 0.52, 0.7).normalize();
const levelShown = l => l.visible;
function home() {
  if (view === "all") { controls.target.set(0, 0, 4.2); camera.position.copy(controls.target).addScaledVector(ALL_DIR, homeDistance() * 2.0); return; }
  const n = view === "ground" ? 0 : view === "f2" ? 2 : 1;
  controls.target.copy(HOME).add(levels[n].position); camera.position.copy(controls.target).addScaledVector(VIEW_DIR, homeDistance());
}
function showFloor(v) {
  view = v; closeUp = false; fit.moved = false;
  // The whole-building view pulls the floors further apart so you can see into each one.
  levels.forEach((l, n) => { l.visible = v === "all" || (v === "ground" ? 0 : v === "f2" ? 2 : 1) === n; l.position.y = (n - 1) * (v === "all" ? FLOOR_GAP * 1.6 : FLOOR_GAP); });
  shafts.visible = v === "all";
  controls.maxDistance = homeDistance() * (v === "all" ? 2.4 : 1.4);
  home();
}
function fit() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 50 : 36;
  camera.updateProjectionMatrix();
  controls.maxDistance = homeDistance() * (view === "all" ? 2.4 : 1.4);
  if (!closeUp && !fit.moved) home();
}
controls.addEventListener("start", () => (fit.moved = true));
new ResizeObserver(fit).observe(host); fit(); home();

function place(el, pos) {
  v.copy(pos).project(camera);
  const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
  el.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * host.clientWidth}px,${(-v.y * 0.5 + 0.5) * host.clientHeight}px)`;
  el.style.visibility = vis ? "visible" : "hidden";
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), now = clock.elapsedTime;
  controls.update();
  for (const [id, { person: p, anchor }] of people) {
    p.t += dt;
    if (p.pop !== undefined) { p.pop = Math.min(1, p.pop + dt * 2.2); const k = 1 - Math.pow(1 - p.pop, 3); p.root.scale.setScalar((id === "dia" ? 1.32 : 1) * (0.01 + k * 0.99 * (1 + Math.sin(p.pop * Math.PI) * 0.12))); if (p.pop >= 1) delete p.pop; }
    if (!reduceMotion) {
      // Breathing, blinking, and a small head turn toward the camera.
      p.body.position.y = Math.sin(p.t * 2.1) * 0.012 + (p.working ? Math.abs(Math.sin(p.t * 9)) * 0.012 : 0);
      p.eyes.scale.y = (p.t % 4.3) < 0.12 ? 0.1 : 1;
      p.head.rotation.y = Math.sin(p.t * 0.6) * 0.18;
      p.head.rotation.z = Math.sin(p.t * 0.9) * 0.04;
      if (p.gem) { p.gem.rotation.y += dt * 1.6; p.gem.position.y = 2.42 + Math.sin(p.t * 2) * 0.05; }
    }
    // Arms: typing while working, waving when Dia greets, resting otherwise.
    const [L, R] = p.arms;
    if (p.wave > 0) {
      p.wave -= dt;
      R.rotation.z = -2.5 + Math.sin(now * 12) * 0.35; R.rotation.x = 0;
    } else if (p.working && id !== "dia") {
      L.rotation.x = -1.1 + Math.sin(now * 16) * 0.08; R.rotation.x = -1.1 + Math.sin(now * 16 + 1.5) * 0.08;
      L.rotation.z = -0.25; R.rotation.z = 0.25;
    } else {
      L.rotation.x += (0 - L.rotation.x) * 0.1; R.rotation.x += (id === "dia" ? 0 : -0.55 - R.rotation.x) * 0.1;
      if (id !== "dia") L.rotation.x += (-0.55 - L.rotation.x) * 0.1;
      L.rotation.z += (-0.12 - L.rotation.z) * 0.1; R.rotation.z += (0.12 - R.rotation.z) * 0.1;
    }
    // Talking: the mouth opens and closes; the smile stays.
    const open = p.speaking ? 0.35 + Math.abs(Math.sin(now * 14)) * 0.9 + Math.sin(now * 23) * 0.2 : 0.05;
    p.mouth.scale.y += (open - p.mouth.scale.y) * 0.4;
    if (p.desk) p.desk.logo.material.emissiveIntensity += ((p.working ? 1.4 + Math.sin(now * 6) * 0.3 : 0.15) - p.desk.logo.material.emissiveIntensity) * 0.1;
    const b = bubbles.get(id); if (b && !b.hidden) { place(b, v2.copy(anchor).add(people.get(id).level.position)); if (!levelShown(people.get(id).level)) b.style.visibility = "hidden"; }
  }
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i]; f.t += dt / 1.25;
    const t = Math.min(f.t, 1), u = 1 - t;
    v.set(u * u * f.a.x + 2 * u * t * f.mid.x + t * t * f.b.x, u * u * f.a.y + 2 * u * t * f.mid.y + t * t * f.b.y, u * u * f.a.z + 2 * u * t * f.mid.z + t * t * f.b.z);
    f.paper.position.copy(v).sub(f.level.position); f.paper.rotation.y = now * 6; f.paper.rotation.z = Math.sin(now * 9) * 0.3;
    place(f.tag, v.clone().setY(v.y + 0.5));
    if (t >= 1) { f.level.remove(f.paper); f.tag.remove(); flights.splice(i, 1); }
  }
  const sel = people.get(selectedId); if (sel) selRing.position.set(sel.person.root.position.x, 0.03, sel.person.root.position.z);
  selRing.rotation.z = now * 0.6;
  renderer.render(scene, camera);
});

/* ---------- What the page uses ---------- */
const api = {
  setAgents(list) {
    const known = new Set(people.keys());
    for (const a of list) if (!known.has(a.id)) addPerson(a);
    select(selectedId);
  },
  bubble(id, text, working) {
    const p = people.get(id); if (!p) return;
    p.person.working = !!working && id !== "dia";
    const b = bubbleEl(id); b.textContent = text || ""; b.hidden = !text;
    b.classList.toggle("dia", id === "dia");
  },
  handoff,
  select,
  talk(on) { const d = people.get("dia"); if (d) d.person.speaking = !!on; },
  wave() { const d = people.get("dia"); if (d && !reduceMotion) d.person.wave = 2.2; },
  showFloor,
  floorOf(id) { const p = people.get(id); return p ? ["ground", "f1", "f2"][levels.indexOf(p.level)] : null; },
  focusDia() { if (view !== "f1") showFloor("f1"); closeUp = true; controls.target.set(-0.6, 2.35, -5.9); camera.position.set(-0.1, 3.1, -1.6); },
  resetView() { showFloor(view); },
  onSelect: null
};
window.Office3D = api;
window.dispatchEvent(new Event("office3d-ready"));
