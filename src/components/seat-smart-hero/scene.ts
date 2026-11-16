import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* Seat Smart hero: a gala room that fills itself.
   Framework-free engine. Give it an element; it builds the canvas and overlays. */

export interface HeroHandle {
  destroy(): void;
}

interface Guest {
  name: string;
  tag?: string;
  tagKind?: "vip" | "diet" | "plain";
  you?: boolean;
}
interface Seat {
  id: number;
  table: number;
  idx: number;
  angle: number;
  pos: THREE.Vector3;
  guest: Guest | null;
  locked: boolean;
}
interface Anim {
  seat: Seat;
  t0: number;
  dur: number;
  type: "drop" | "lift";
}

// Room dimensions in meters
const W = 20.4;
const D = 16;
const H = 4.2;
const COLS = 5;
const ROWS = 3;
const SP = 3.7;
const SEATS = 10;
const TABLES = COLS * ROWS;
const TOTAL = TABLES * SEATS;
const TABLE_R = 0.9;
const TABLE_H = 0.75;
const CHAIR_R = 1.42;
const SEAT_Y = 0.51;
const VIP_TABLE = 2; // front and center, by the stage
const PREFILL = 36;

const FIRST = [
  "Priya", "Marcus", "Elena", "Tom", "Aisha", "Daniel", "Sofia", "James", "Mei", "Oliver",
  "Fatima", "Lucas", "Hannah", "Diego", "Chloe", "Samuel", "Ines", "Noah", "Grace", "Andre",
  "Leila", "Ben", "Naomi", "Victor", "Ruth", "Kenji", "Clara", "Omar", "Julia", "Ethan",
  "Amara", "Peter", "Rosa", "Felix", "Maya", "Henry", "Zoe", "Carlos", "Anna", "Theo",
  "Nadia", "Will", "Lena", "Isaac", "Tessa", "Raj", "Emma", "Hugo", "Alice", "Jonah",
];
const DIETS = ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free"];
const MODEL_TOKEN_COLORS = ["#6a1f3f", "#8a2748", "#7d2a4a", "#5a1b38", "#9a3556"];
const TOKEN_COLORS = ["#6a1f3f", "#8a2748", "#d39a92", "#4a1730", "#a85a6c", "#c47e6c", "#7d2a4a"];

const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function makeGuest(): Guest {
  const name = `${pick(FIRST)} ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}.`;
  const r = Math.random();
  if (r < 0.2) return { name, tag: pick(DIETS), tagKind: "diet" };
  if (r < 0.27) return { name, tag: "Plus-one", tagKind: "plain" };
  return { name };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: Element) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

/* ---------- procedural textures ---------- */

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function parquetTex() {
  const tex = canvasTex(1024, 1024, (c) => {
    const rows = 16;
    const rh = 1024 / rows;
    for (let r = 0; r < rows; r++) {
      const len = 256;
      const off = (r * 97) % len;
      for (let x = -off; x < 1024; x += len) {
        const l = 59 + Math.random() * 6;
        c.fillStyle = `hsl(${32 + Math.random() * 5}, ${36 + Math.random() * 8}%, ${l}%)`;
        c.fillRect(x, r * rh, len, rh);
        for (let g = 0; g < 26; g++) {
          c.fillStyle = `rgba(${Math.random() < 0.5 ? "120,90,60" : "255,245,225"},${0.03 + Math.random() * 0.05})`;
          c.fillRect(x, r * rh + Math.random() * rh, len, 1 + Math.random() * 1.5);
        }
        c.fillStyle = "rgba(120,90,60,0.28)";
        c.fillRect(x, r * rh, 2, rh);
      }
      c.fillStyle = "rgba(120,90,60,0.25)";
      c.fillRect(0, r * rh, 1024, 2);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function wallTex() {
  const tex = canvasTex(512, 1024, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 1024);
    g.addColorStop(0, "#f4eee5");
    g.addColorStop(1, "#ebe3d6");
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 1024);
    c.fillStyle = "#ddd2c2";
    c.fillRect(0, 994, 512, 30);
  });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function glowTex() {
  return canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

function uplightTex() {
  return canvasTex(128, 256, (c) => {
    c.translate(64, 256);
    c.scale(1, 4);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 62);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(-64, -64, 128, 64);
  });
}

function beamTex() {
  return canvasTex(8, 128, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,1)");
    c.fillStyle = g;
    c.fillRect(0, 0, 8, 128);
  });
}

function noiseTex() {
  const tex = canvasTex(
    256,
    256,
    (c) => {
      const img = c.createImageData(256, 256);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + Math.random() * 60;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    },
    false,
  );
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

function screenTex(model = false) {
  return canvasTex(1024, 536, (c) => {
    const g = c.createLinearGradient(0, 0, 1024, 536);
    g.addColorStop(0, "#5b1c3b");
    g.addColorStop(1, "#2c0f20");
    c.fillStyle = g;
    c.fillRect(0, 0, 1024, 536);
    const r = c.createRadialGradient(512, 240, 0, 512, 240, 520);
    r.addColorStop(0, "rgba(255,200,170,0.28)");
    r.addColorStop(1, "rgba(255,200,170,0)");
    c.fillStyle = r;
    c.fillRect(0, 0, 1024, 536);
    if (model) {
      c.fillStyle = "#f1ebe1";
      c.fillRect(0, 0, 1024, 536);
    }
    c.textAlign = "center";
    c.fillStyle = model ? "#5a1b38" : "#f6e9d6";
    c.font = "600 150px 'Cormorant Garamond', Georgia, serif";
    c.fillText("Seat Smart", 512, 290);
    c.fillStyle = model ? "#b99aa5" : "#d9b98a";
    c.fillRect(432, 336, 160, 3);
    c.font = "500 44px Georgia, serif";
    c.fillStyle = model ? "#7b5b66" : "#e8cdb0";
    c.fillText("Please find your seat", 512, 412);
  });
}

function windowTex() {
  return canvasTex(128, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#eaf2f6");
    g.addColorStop(0.6, "#f7f6ef");
    g.addColorStop(1, "#dfe8d6");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 256);
    c.fillStyle = "#3b3a3a";
    c.fillRect(62, 0, 4, 256);
    c.fillRect(0, 84, 128, 3);
    c.fillRect(0, 170, 128, 3);
  });
}

/* ---------- geometry helpers ---------- */

function place(geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}

function tint(geo: THREE.BufferGeometry, hex: string) {
  const col = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

function chairGeo() {
  const parts: THREE.BufferGeometry[] = [];
  const cyl = (r: number, h: number) => new THREE.CylinderGeometry(r, r, h, 6);
  for (const sx of [-1, 1]) {
    parts.push(place(cyl(0.017, 0.45), sx * 0.18, 0.225, 0.18));
    parts.push(place(cyl(0.017, 0.98), sx * 0.18, 0.49, -0.19));
  }
  parts.push(place(new THREE.BoxGeometry(0.42, 0.035, 0.42), 0, 0.45, 0));
  parts.push(place(new THREE.BoxGeometry(0.4, 0.045, 0.03), 0, 0.97, -0.19));
  parts.push(place(new THREE.BoxGeometry(0.38, 0.028, 0.022), 0, 0.84, -0.19));
  for (let i = -2; i <= 2; i++) parts.push(place(cyl(0.008, 0.36), i * 0.06, 0.65, -0.19));
  return mergeGeometries(parts)!;
}

function clothGeo() {
  const pts = [
    new THREE.Vector2(0, TABLE_H + 0.012),
    new THREE.Vector2(TABLE_R - 0.02, TABLE_H + 0.012),
    new THREE.Vector2(TABLE_R + 0.005, TABLE_H),
    new THREE.Vector2(TABLE_R + 0.02, TABLE_H - 0.06),
    new THREE.Vector2(TABLE_R + 0.045, 0.5),
    new THREE.Vector2(TABLE_R + 0.07, 0.25),
    new THREE.Vector2(TABLE_R + 0.09, 0.015),
  ].reverse();
  const geo = new THREE.LatheGeometry(pts, 120);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < TABLE_R || y > TABLE_H - 0.03) continue;
    const a = Math.atan2(z, x);
    const t = 1 - y / TABLE_H;
    const k = 1 + ((Math.sin(a * 15) * 0.05 + Math.sin(a * 6 + 1.3) * 0.02) * t) / r;
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// A claimed seat: an upholstered cover that sits over the bare chair, in chair-local space.
function tokenGeo() {
  const pad = place(new THREE.BoxGeometry(0.47, 0.1, 0.47), 0, 0.485, 0.005);
  const back = place(new THREE.BoxGeometry(0.47, 0.6, 0.075), 0, 0.74, -0.19);
  return mergeGeometries([pad, back])!;
}

function centerpieceGeo() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(tint(place(new THREE.CylinderGeometry(0.07, 0.05, 0.12, 12), 0, 0.06, 0), "#f2ede4"));
  const blooms = ["#ffffff", "#f6efe4", "#f1d6cf", "#8fa888", "#a9bda0", "#e6b7b2", "#8a2748"];
  for (let i = 0; i < 16; i++) {
    const a = rand(Math.PI * 2);
    const up = rand(0.2, 1);
    const r = 0.17 * Math.sqrt(1 - up * up * 0.8);
    parts.push(
      tint(
        place(new THREE.SphereGeometry(rand(0.045, 0.075), 8, 6), Math.cos(a) * r, 0.14 + up * 0.16, Math.sin(a) * r),
        pick(blooms),
      ),
    );
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(
      tint(place(new THREE.SphereGeometry(0.07, 6, 5), Math.cos(a) * 0.17, 0.13, Math.sin(a) * 0.17, 0, 0, 0, 1.2, 0.6, 1.2), "#6f8a68"),
    );
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const h = 0.16 + i * 0.04;
    parts.push(tint(place(new THREE.CylinderGeometry(0.02, 0.02, h, 8), Math.cos(a) * 0.36, h / 2, Math.sin(a) * 0.36), "#f3ead9"));
  }
  return mergeGeometries(parts)!;
}

function curtainGeo(w: number, h: number, waves: number) {
  const geo = new THREE.PlaneGeometry(w, h, Math.round(waves * 8), 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, Math.sin((x / w) * waves * Math.PI * 2) * 0.07);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------- main ---------- */

export type HeroVariant = "daylight" | "model";

export function createSeatSmartHero(stage: HTMLElement, variant: HeroVariant = "daylight"): HeroHandle {
  // "model" renders the room as a matte architectural model, with guests as the only color
  const model = variant === "model";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    stage.classList.add("ssh-nogl");
    return { destroy() {} };
  }
  const small = stage.clientWidth < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(24, 1, 1, 200);
  const target = new THREE.Vector3(0, 0.9, 0.2);

  /* ----- lights ----- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd9cdbd, 0.95);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff3e2, 2.3);
  key.position.set(7, 17, 10);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(small ? 1024 : 2048);
  const sc = key.shadow.camera;
  sc.left = -15;
  sc.right = 15;
  sc.top = 13;
  sc.bottom = -13;
  sc.near = 1;
  sc.far = 50;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 5;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff6ea, 0.9);
  fill.position.set(-10, 8, 6);
  scene.add(fill);
  if (model) {
    // stronger light and shade so the white forms read
    hemi.intensity = 0.5;
    key.intensity = 3.1;
    fill.intensity = 0.35;
    scene.environmentIntensity = 0.3;
  }

  /* ----- materials ----- */
  const M = {
    floor: track(new THREE.MeshStandardMaterial({ map: track(parquetTex()), roughness: 0.55, metalness: 0 })),
    plum: track(new THREE.MeshStandardMaterial({ color: "#5a1b38", roughness: 0.7 })),
    stone: track(new THREE.MeshStandardMaterial({ color: "#e4dbcd", roughness: 0.85 })),
    dark: track(new THREE.MeshStandardMaterial({ color: "#3b3a3a", roughness: 0.6 })),
    wood: track(new THREE.MeshStandardMaterial({ color: "#b98d62", roughness: 0.6 })),
    blush: track(new THREE.MeshStandardMaterial({ color: "#dcc6b6", roughness: 0.6 })),
    cap: track(new THREE.MeshStandardMaterial({ color: "#f3ede3", roughness: 0.85 })),
    gold: track(new THREE.MeshStandardMaterial({ color: "#c8a468", roughness: 0.32, metalness: 0.85 })),
    linen: track(
      new THREE.MeshPhysicalMaterial({
        color: "#f3eee6",
        roughness: 0.92,
        sheen: 1,
        sheenRoughness: 0.6,
        sheenColor: new THREE.Color("#fff6e8"),
        bumpMap: track(noiseTex()),
        bumpScale: 0.6,
      }),
    ),
    cushion: track(new THREE.MeshStandardMaterial({ color: "#f2ece2", roughness: 0.9 })),
    china: track(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.18 })),
    napkin: track(new THREE.MeshStandardMaterial({ color: "#7a1f3d", roughness: 0.9 })),
    glass: track(
      new THREE.MeshPhysicalMaterial({
        color: "#ffffff",
        roughness: 0.04,
        transparent: true,
        opacity: 0.3,
        envMapIntensity: 3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
    flowers: track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })),
    velvet: track(
      new THREE.MeshStandardMaterial({ color: "#f5f0e7", roughness: 0.95, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
    ),
    slats: track(new THREE.MeshStandardMaterial({ color: "#c9a57c", roughness: 0.65, side: THREE.DoubleSide })),
    walnut: track(new THREE.MeshStandardMaterial({ color: "#c7a27a", roughness: 0.55 })),
    token: track(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 })),
    flame: track(new THREE.MeshBasicMaterial({ color: "#ffe0a8", toneMapped: false })),
  };
  M.floor.map!.repeat.set(5, 4);
  if (model) {
    const clay = (m: THREE.MeshStandardMaterial, hex: string) => {
      m.map = null;
      m.color.set(hex);
      m.roughness = 1;
      m.metalness = 0;
      m.needsUpdate = true;
    };
    clay(M.floor, "#d9d0c1");
    clay(M.stone, "#e6dfd3");
    clay(M.cap, "#f7f3ec");
    clay(M.dark, "#d8cfc1");
    clay(M.wood, "#c9bdab");
    clay(M.blush, "#e2d9cb");
    clay(M.linen, "#fbf8f3");
    clay(M.cushion, "#efe9df");
    clay(M.china, "#ffffff");
    clay(M.napkin, "#ddd3c4");
    clay(M.velvet, "#f4efe7");
    clay(M.slats, "#e4dccf");
    clay(M.walnut, "#ddd4c6");
    clay(M.plum, "#ddd3c4");
    clay(M.flowers, "#e9e2d6");
    M.flowers.vertexColors = false;
    M.velvet.opacity = 1;
    M.glass.opacity = 0.55;
    M.glass.envMapIntensity = 0.6;
    M.flame.color.set("#f4efe7");
  }

  const world = new THREE.Group();
  scene.add(world);
  const dummy = new THREE.Object3D();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, cast = false, receive = true) => {
    const mesh = new THREE.Mesh(track(geo), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    world.add(mesh);
    return mesh;
  };
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cast = true, receive = true) => {
    const mesh = new THREE.InstancedMesh(track(geo), mat, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.frustumCulled = false;
    world.add(mesh);
    return mesh;
  };
  const mat4 = (x: number, y: number, z: number, ry = 0, s = 1) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };

  /* ----- room shell ----- */
  const glow = track(glowTex());
  const upTex = track(uplightTex());
  add(new THREE.BoxGeometry(W + 0.6, 0.5, D + 0.6), M.stone, -0.15, -0.25, -0.15, true);
  add(new THREE.BoxGeometry(W + 0.63, 0.035, D + 0.63), M.plum, -0.15, -0.09, -0.15);
  const floor = add(new THREE.PlaneGeometry(W, D), M.floor, 0, 0.002, 0);
  floor.rotation.x = -Math.PI / 2;

  add(new THREE.BoxGeometry(W + 0.3, H, 0.3), M.stone, -0.15, H / 2, -D / 2 - 0.15);
  add(new THREE.BoxGeometry(0.3, H, D), M.stone, -W / 2 - 0.15, H / 2, 0);
  add(new THREE.BoxGeometry(W + 0.34, 0.07, 0.34), M.cap, -0.15, H + 0.035, -D / 2 - 0.15);
  add(new THREE.BoxGeometry(0.34, 0.07, D + 0.02), M.cap, -W / 2 - 0.15, H + 0.035, 0);

  const wallA = track(wallTex());
  wallA.repeat.set(8, 1);
  const wallB = track(wallTex());
  wallB.repeat.set(6, 1);
  add(new THREE.PlaneGeometry(W, H), track(new THREE.MeshStandardMaterial(model ? { color: "#f3eee6", roughness: 1 } : { map: wallA, roughness: 0.8 })), 0, H / 2, -D / 2 + 0.005);
  const leftWall = add(new THREE.PlaneGeometry(D, H), track(new THREE.MeshStandardMaterial(model ? { color: "#f3eee6", roughness: 1 } : { map: wallB, roughness: 0.8 })), -W / 2 + 0.005, H / 2, 0);
  leftWall.rotation.y = Math.PI / 2;

  // soft shadow on the page under the plinth
  const contactMat = track(new THREE.MeshBasicMaterial({ map: glow, color: 0x4a3a30, transparent: true, opacity: model ? 0.55 : 0.4, depthWrite: false }));
  const contact = add(new THREE.PlaneGeometry(W * 1.75, D * 1.85), contactMat, 0.4, -0.5, 0.6, false, false);
  contact.rotation.x = -Math.PI / 2;
  contact.renderOrder = -1;

  // daylight falling across the floor from each window
  const sunMat = track(new THREE.MeshBasicMaterial({ map: upTex, color: "#fff6e4", transparent: true, opacity: model ? 0 : 0.5, depthWrite: false }));
  const sunPatch = (z: number) => {
    const m = add(new THREE.PlaneGeometry(2.2, 6.5), sunMat, -W / 2 + 3.25, 0.008, z + 0.7, false, false);
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 2 + 0.2);
  };

  // windows and drapes on the left wall
  const winMat = track(model ? new THREE.MeshStandardMaterial({ color: "#e3dbce", roughness: 1 }) : new THREE.MeshBasicMaterial({ map: track(windowTex()) }));
  const drape = track(curtainGeo(0.6, 3.7, 3));
  for (const z of [-4.9, 0, 4.9]) {
    const frame = add(new THREE.BoxGeometry(0.08, 3.36, 2.46), M.dark, -W / 2 + 0.04, 2.1, z);
    frame.receiveShadow = false;
    const pane = add(new THREE.PlaneGeometry(2.36, 3.26), winMat, -W / 2 + 0.085, 2.1, z, false, false);
    pane.rotation.y = Math.PI / 2;
    for (const s of [-1, 1]) {
      const d = new THREE.Mesh(drape, M.velvet);
      d.position.set(-W / 2 + 0.16, 2.02, z + s * 1.5);
      d.rotation.y = Math.PI / 2;
      world.add(d);
    }
    sunPatch(z);
  }

  // stage
  add(new THREE.BoxGeometry(9, 0.4, 2.6), M.walnut, 0, 0.2, -6.7, true);
    add(new THREE.BoxGeometry(1.8, 0.2, 0.45), M.walnut, 0, 0.1, -5.2, true);
  add(new THREE.BoxGeometry(0.55, 1.05, 0.42), M.cap, -2.4, 0.925, -6.3, true);
  add(new THREE.BoxGeometry(0.62, 0.04, 0.5), M.plum, -2.4, 1.47, -6.3, true);
  const backdrop = add(curtainGeo(9, 3.8, 40), M.slats, 0, 2.3, -D / 2 + 0.1);
  backdrop.castShadow = false;
  add(new THREE.BoxGeometry(4.48, 2.38, 0.06), M.dark, 0, 2.4, -D / 2 + 0.26);
  add(new THREE.PlaneGeometry(4.4, 2.3), track(new THREE.MeshBasicMaterial({ map: track(screenTex(model)), toneMapped: false })), 0, 2.4, -D / 2 + 0.3, false, false);

  /* ----- tables, chairs and place settings ----- */
  const seats: Seat[] = [];
  const tableCenters: THREE.Vector3[] = [];
  const mTable: THREE.Matrix4[] = [];
  const mChair: THREE.Matrix4[] = [];
  const mPlate: THREE.Matrix4[] = [];
  const mNapkin: THREE.Matrix4[] = [];
  const mGlass: THREE.Matrix4[] = [];
  const mFlame: THREE.Matrix4[] = [];
  const mGlowTop: THREE.Matrix4[] = [];
  const haloPos: number[] = [];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = r * COLS + c;
      const cx = (c - (COLS - 1) / 2) * SP;
      const cz = (r - 1) * SP + 1.6;
      tableCenters.push(new THREE.Vector3(cx, 0, cz));
      const spin = rand(Math.PI * 2);
      mTable.push(mat4(cx, 0, cz, spin));
      dummy.position.set(cx, TABLE_H + 0.02, cz);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mGlowTop.push(dummy.matrix.clone());
      for (let i = 0; i < 3; i++) {
        // candles are part of the centerpiece, which turns with the table
        const a = (i / 3) * Math.PI * 2 + 0.5 - spin;
        const h = 0.16 + i * 0.04;
        const fx = cx + Math.cos(a) * 0.36;
        const fz = cz + Math.sin(a) * 0.36;
        dummy.position.set(fx, TABLE_H + 0.012 + h + 0.03, fz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1.9, 1);
        dummy.updateMatrix();
        mFlame.push(dummy.matrix.clone());
        haloPos.push(fx, TABLE_H + h + 0.06, fz);
      }
      for (let i = 0; i < SEATS; i++) {
        const a = (i / SEATS) * Math.PI * 2 + Math.PI / SEATS;
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        seats.push({
          id: t * SEATS + i,
          table: t,
          idx: i,
          angle: a,
          pos: new THREE.Vector3(cx + sx * CHAIR_R, 0, cz + sz * CHAIR_R),
          guest: null,
          locked: t === VIP_TABLE,
        });
        mChair.push(mat4(cx + sx * CHAIR_R, 0, cz + sz * CHAIR_R, a + Math.PI));
        mPlate.push(mat4(cx + sx * 0.66, TABLE_H + 0.02, cz + sz * 0.66, a));
        mNapkin.push(mat4(cx + sx * 0.66, TABLE_H + 0.034, cz + sz * 0.66, a + 0.25));
        const ga = a + 0.24;
        mGlass.push(mat4(cx + Math.sin(ga) * 0.5, TABLE_H + 0.013, cz + Math.cos(ga) * 0.5));
      }
    }
  }

  inst(clothGeo(), M.linen, mTable);
  inst(chairGeo(), M.wood, mChair);
  inst(place(new THREE.BoxGeometry(0.38, 0.05, 0.38), 0, 0.492, 0), M.cushion, mChair);
  inst(place(new THREE.CylinderGeometry(0.165, 0.15, 0.008, 28), 0, -0.006, 0), M.blush, mPlate, false);
  inst(new THREE.CylinderGeometry(0.128, 0.1, 0.014, 28), M.china, mPlate, false);
  // soft grounding shadow under each table
  const aoMat = track(new THREE.MeshBasicMaterial({ map: glow, color: 0x5a4636, transparent: true, opacity: model ? 0.5 : 0.32, depthWrite: false }));
  inst(
    new THREE.CircleGeometry(2.15, 32),
    aoMat,
    tableCenters.map((c) => new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(c.x, 0.012, c.z)),
    false,
    false,
  );
  inst(new THREE.BoxGeometry(0.07, 0.014, 0.15), M.napkin, mNapkin, false);
  const gobletPts = [
    [0.036, 0], [0.034, 0.005], [0.006, 0.012], [0.006, 0.085], [0.03, 0.105], [0.041, 0.14], [0.037, 0.185],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  inst(new THREE.LatheGeometry(gobletPts, 16), M.glass, mGlass, false, false);
  inst(place(centerpieceGeo(), 0, TABLE_H + 0.012, 0), M.flowers, mTable);
  inst(new THREE.SphereGeometry(0.017, 8, 8), M.flame, mFlame, false, false);
  const glowTopMat = track(
    new THREE.MeshBasicMaterial({ map: glow, color: "#ffb070", transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  inst(new THREE.CircleGeometry(0.95, 32), glowTopMat, mGlowTop, false, false);

  const haloGeo = track(new THREE.BufferGeometry());
  haloGeo.setAttribute("position", new THREE.Float32BufferAttribute(haloPos, 3));
  const haloMat = track(
    new THREE.PointsMaterial({ map: glow, color: "#ffc890", size: 0.3, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.visible = !model;
  world.add(halos);

  // dust motes
  const dustPos: number[] = [];
  for (let i = 0; i < 110; i++) dustPos.push(rand(-W / 2, W / 2), rand(1, 4), rand(-D / 2, D / 2));
  const dustGeo = track(new THREE.BufferGeometry());
  dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    track(new THREE.PointsMaterial({ map: glow, color: "#ffffff", size: 0.07, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })),
  );
  dust.visible = !model;
  world.add(dust);

  /* ----- guest tokens ----- */
  const tokens = new THREE.InstancedMesh(track(tokenGeo()), M.token, TOTAL);
  tokens.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tokens.castShadow = true;
  tokens.frustumCulled = false;
  world.add(tokens);
  const col = new THREE.Color();
  const setToken = (seat: Seat, yOff: number, s: number) => {
    dummy.position.set(seat.pos.x, yOff, seat.pos.z);
    dummy.rotation.set(0, seat.angle + Math.PI, 0);
    dummy.scale.setScalar(Math.max(s, 0.0001));
    dummy.updateMatrix();
    tokens.setMatrixAt(seat.id, dummy.matrix);
    tokens.instanceMatrix.needsUpdate = true;
  };
  seats.forEach((s) => {
    setToken(s, 0, 0);
    tokens.setColorAt(s.id, col.set("#ffffff"));
  });

  /* ----- effects: pulse rings, light beams, hover ring ----- */
  const ringGeo = track(new THREE.RingGeometry(0.86, 1, 48));
  const mkRing = () => {
    const m = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: "#8a2748", transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    world.add(m);
    disposables.push(m.material);
    return m;
  };
  const beamGeo = track(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 20, 1, true));
  const beamMap = track(beamTex());
  const fx = Array.from({ length: 8 }, () => {
    const ring = mkRing();
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ map: beamMap, color: "#d8839a", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    beam.visible = false;
    world.add(beam);
    disposables.push(beam.material);
    return { ring, beam, t0: -10 };
  });
  let fxNext = 0;
  const hoverRing = mkRing();
  (hoverRing.material as THREE.MeshBasicMaterial).depthTest = false;
  hoverRing.renderOrder = 5;

  /* ----- overlay DOM ----- */
  const overlay = el("div", "ssh-overlay", undefined, stage);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "ssh-thread");
  const threadPath = document.createElementNS(svgNS, "path");
  svg.appendChild(threadPath);
  overlay.appendChild(svg);

  const labels = Array.from({ length: 4 }, () => ({ node: el("div", "ssh-label", undefined, overlay), seat: null as Seat | null, until: 0 }));
  const pin = el("div", "ssh-label ssh-pin", undefined, overlay);
  el("b", undefined, `Table ${VIP_TABLE + 1}`, pin);
  el("span", undefined, small ? "Locked by host" : "VIP seats locked by host", pin);

  const tip = el("div", "ssh-tip", undefined, overlay);

  const counter = el("div", "ssh-counter", undefined, overlay);
  const live = el("div", "ssh-live", undefined, counter);
  el("i", undefined, undefined, live);
  el("span", undefined, "Live seat map", live);
  const countRow = el("div", "ssh-count", undefined, counter);
  const countNum = el("b", undefined, "0", countRow);
  const countRest = el("span", undefined, ` of ${TOTAL} seated`, countRow);
  const barFill = el("i", undefined, undefined, el("div", "ssh-bar", undefined, counter));

  // only shown where a mouse makes it practical; seats are too small to tap on a phone
  if (!reduced && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    el("div", "ssh-hint", "Hover a table. Click a free seat to claim it.", overlay);
  }

  const phone = el("div", "ssh-phone", undefined, overlay);
  const phScreen = el("div", "ssh-ph-screen", undefined, phone);
  el("div", "ssh-ph-event", "Awards Dinner", phScreen);
  const phHi = el("div", "ssh-ph-hi", "Pick your seat", phScreen);
  const phSub = el("div", "ssh-ph-sub", "Tap any free seat", phScreen);
  const phTable = el("div", "ssh-ph-table", undefined, phScreen);
  el("div", "ssh-ph-front", "Front of room", phTable);
  const phRound = el("div", "ssh-ph-round", "Table 1", phTable);
  const phSeats = Array.from({ length: SEATS }, (_, i) => {
    const a = (i / SEATS) * Math.PI * 2;
    const dot = el("div", "ssh-ph-seat", String(i + 1), phTable);
    dot.style.left = `${50 + Math.sin(a) * 38}%`;
    dot.style.top = `${57 - Math.cos(a) * 32}%`;
    return dot;
  });
  const phFinger = el("div", "ssh-ph-finger", undefined, phTable);
  const phLegend = el("div", "ssh-ph-legend", undefined, phScreen);
  for (const [cls, text] of [["ssh-free", "Available"], ["ssh-mine", "Your seat"], ["ssh-taken", "Taken"]]) {
    el("i", cls, undefined, phLegend);
    el("span", undefined, text, phLegend);
  }
  const phToast = el("div", "ssh-ph-toast", "Just taken. Pick another.", phScreen);
  const phCta = el("div", "ssh-ph-cta", "Choose a seat", phScreen);
  const phNote = el("div", "ssh-ph-note", "", phScreen);

  /* ----- simulation state ----- */
  let simTime = 0;
  let seated = 0;
  let phase: "fill" | "full" | "reset" = "fill";
  const anims: Anim[] = [];
  let timers: { t: number; fn: () => void }[] = [];
  const after = (dt: number, fn: () => void) => timers.push({ t: simTime + dt, fn });
  let phoneTable = -1;
  let phoneMine = -1;
  let phoneSaved = false;
  let hoverTable = -1;
  let hoverSeat: Seat | null = null;
  let dirty = true;
  const domTimers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      domTimers.delete(id);
      fn();
    }, ms);
    domTimers.add(id);
  };

  const freeAt = (t: number) => seats.filter((s) => s.table === t && !s.guest);
  const tableSeats = (t: number) => seats.slice(t * SEATS, t * SEATS + SEATS);

  const updateCounter = () => {
    countNum.textContent = String(seated);
    countRest.textContent = seated === TOTAL ? ` of ${TOTAL}. Room full.` : ` of ${TOTAL} seated`;
    barFill.style.width = `${(seated / TOTAL) * 100}%`;
  };

  const phoneRefresh = () => {
    if (phoneTable < 0) return;
    tableSeats(phoneTable).forEach((s, i) => {
      phSeats[i].className = "ssh-ph-seat" + (i === phoneMine ? (phoneSaved ? " ssh-mine" : " ssh-selected") : s.guest ? " ssh-taken" : "");
    });
  };

  const renderTip = () => {
    if (hoverTable < 0) return;
    const list = tableSeats(hoverTable).filter((s) => s.guest);
    tip.textContent = "";
    const head = el("div", "ssh-tip-head", undefined, tip);
    el("b", undefined, `Table ${hoverTable + 1}`, head);
    el("span", undefined, `${list.length} of ${SEATS} seated`, head);
    list.slice(0, 6).forEach((s) => {
      const row = el("div", "ssh-tip-row", undefined, tip);
      el("span", undefined, s.guest!.name, row);
      if (s.guest!.tag) el("i", `ssh-tag ssh-${s.guest!.tagKind}`, s.guest!.tag, row);
    });
    if (list.length > 6) el("div", "ssh-tip-more", `+${list.length - 6} more`, tip);
    if (!list.length) el("div", "ssh-tip-more", "No one here yet. Pick a seat.", tip);
  };

  const showLabel = (seat: Seat, secs: number) => {
    const slot = labels.find((l) => !l.seat) ?? labels.reduce((a, b) => (a.until < b.until ? a : b));
    const g = seat.guest!;
    slot.node.textContent = "";
    el("b", undefined, g.name, slot.node);
    el("span", undefined, `Table ${seat.table + 1}`, slot.node);
    if (g.tag) el("i", `ssh-tag ssh-${g.tagKind}`, g.tag, slot.node);
    slot.seat = seat;
    slot.until = simTime + secs;
    slot.node.classList.add("ssh-on");
  };

  const v = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number) => {
    v.set(x, y, z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * stage.clientWidth, y: (-v.y * 0.5 + 0.5) * stage.clientHeight };
  };

  const drawThread = (seat: Seat) => {
    const sr = stage.getBoundingClientRect();
    const pr = phTable.getBoundingClientRect();
    const a = { x: pr.left + pr.width / 2 - sr.left, y: pr.top + pr.height / 2 - sr.top };
    const b = toScreen(seat.pos.x, SEAT_Y + 0.5, seat.pos.z);
    const mx = (a.x + b.x) / 2;
    const my = Math.min(a.y, b.y) - 90;
    threadPath.setAttribute("d", `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`);
    const len = threadPath.getTotalLength();
    threadPath.style.transition = "none";
    threadPath.style.strokeDasharray = `${len}`;
    threadPath.style.strokeDashoffset = `${len}`;
    threadPath.style.opacity = "1";
    void threadPath.getBoundingClientRect();
    threadPath.style.transition = "stroke-dashoffset 0.55s ease-out, opacity 0.6s ease 0.9s";
    threadPath.style.strokeDashoffset = "0";
    threadPath.style.opacity = "0";
  };

  const pulse = (seat: Seat) => {
    const f = fx[fxNext++ % fx.length];
    f.t0 = simTime;
    f.ring.position.set(seat.pos.x, 0.03, seat.pos.z);
    f.beam.position.set(seat.pos.x, 1.3 + SEAT_Y, seat.pos.z);
    f.ring.visible = f.beam.visible = true;
  };

  const claim = (seat: Seat, guest: Guest, o: { instant?: boolean; label?: number; thread?: boolean } = {}) => {
    if (seat.guest) return;
    seat.guest = guest;
    seated++;
    if (model) col.set(guest.you ? "#e07a5c" : guest.tagKind === "vip" ? "#3d1226" : pick(MODEL_TOKEN_COLORS));
    else col.set(guest.you ? "#f0c36a" : guest.tagKind === "vip" ? "#c8a468" : pick(TOKEN_COLORS));
    tokens.setColorAt(seat.id, col);
    tokens.instanceColor!.needsUpdate = true;
    if (o.instant) setToken(seat, 0, 1);
    else {
      anims.push({ seat, t0: simTime, dur: 0.55, type: "drop" });
      pulse(seat);
    }
    if (o.label) showLabel(seat, o.label);
    if (o.thread) drawThread(seat);
    updateCounter();
    if (seat.table === phoneTable) phoneRefresh();
    if (seat.table === hoverTable) renderTip();
    if (hoverSeat === seat) hoverSeat = null;
    dirty = true;
    if (seated === TOTAL && phase === "fill") {
      phase = "full";
      after(6, beginReset);
    }
  };

  const release = (seat: Seat) => {
    if (!seat.guest) return;
    seat.guest = null;
    seated--;
    anims.push({ seat, t0: simTime, dur: 0.5, type: "lift" });
    updateCounter();
    if (seat.table === phoneTable) phoneRefresh();
    if (seat.table === hoverTable) renderTip();
  };

  // a brief note that the host has locked the VIP table, once per loop
  const flashPin = () => {
    pin.classList.add("ssh-on");
    after(3.5, () => pin.classList.remove("ssh-on"));
  };

  function beginReset() {
    phase = "reset";
    const open = seats.filter((s) => !s.locked).sort(() => Math.random() - 0.5);
    open.slice(PREFILL).forEach((s) => after(rand(2.4), () => release(s)));
    after(3.6, () => (phase = "fill"));
    after(12, flashPin);
  }

  function ambient() {
    if (phase === "fill") {
      const free = seats.filter((s) => !s.guest && !s.locked);
      if (free.length) {
        // lean toward tables that are already filling, so groups form
        const a = pick(free);
        const b = pick(free);
        const seat = freeAt(a.table).length <= freeAt(b.table).length ? a : b;
        const busy = labels.filter((l) => l.seat).length;
        claim(seat, makeGuest(), { label: busy < 2 && Math.random() < 0.5 ? 2.4 : 0 });
      }
    }
    after(rand(0.28, 0.85), ambient);
  }

  /* ----- phone sequence ----- */
  let turn = 0;
  const phoneIdle = () => {
    phoneMine = -1;
    phFinger.classList.remove("ssh-on");
    phFinger.style.left = "50%";
    phFinger.style.top = "108%";
    phCta.classList.remove("ssh-done");
    phCta.textContent = "Choose a seat";
    phNote.textContent = "";
    phToast.classList.remove("ssh-on");
  };
  const fingerTo = (idx: number) => {
    phFinger.classList.add("ssh-on");
    phFinger.style.left = phSeats[idx].style.left;
    phFinger.style.top = phSeats[idx].style.top;
  };

  function phoneTurn() {
    const options = Array.from({ length: TABLES }, (_, t) => t).filter((t) => t !== VIP_TABLE && freeAt(t).length >= 2);
    if (phase !== "fill" || !options.length) {
      after(1.5, phoneTurn);
      return;
    }
    turn++;
    const t = pick(options);
    const guest = makeGuest();
    phoneIdle();
    phoneTable = t;
    phHi.textContent = `Hi, ${guest.name.split(" ")[0]}`;
    phSub.textContent = "Tap any free seat";
    phRound.textContent = `Table ${t + 1}`;
    phoneRefresh();

    const finish = (seat: Seat | undefined) => {
      if (!seat || seat.guest) {
        after(0.8, phoneTurn);
        return;
      }
      phFinger.classList.add("ssh-tap");
      later(450, () => phFinger.classList.remove("ssh-tap"));
      phoneMine = seat.idx;
      phoneSaved = false;
      claim(seat, guest, { label: 3, thread: true });
      after(0.8, () => {
        phoneSaved = true;
        phoneRefresh();
      });
      phFinger.classList.remove("ssh-on");
      phCta.classList.add("ssh-done");
      phCta.textContent = "Seat saved";
      phSub.textContent = `Table ${t + 1}, seat ${seat.idx + 1}`;
      phNote.textContent = "Change it any time";
      after(3.2, phoneTurn);
    };

    after(1.3, () => {
      const first = pick(freeAt(t));
      if (!first) return finish(undefined);
      fingerTo(first.idx);
      after(0.95, () => {
        const clash = turn % 3 === 0 && freeAt(t).length >= 2;
        if (clash && !first.guest) claim(first, makeGuest(), { label: 2.2 });
        if (first.guest) {
          // someone else got there first: the map updates and the guest picks again
          phToast.classList.add("ssh-on");
          after(1.5, () => {
            phToast.classList.remove("ssh-on");
            const free = freeAt(t);
            const alt = free.sort(
              (p, q) => Math.abs(((p.idx - first.idx + 15) % 10) - 5) - Math.abs(((q.idx - first.idx + 15) % 10) - 5),
            )[0];
            if (!alt) return finish(undefined);
            fingerTo(alt.idx);
            after(0.9, () => finish(alt));
          });
        } else finish(first);
      });
    });
  }

  /* ----- initial state ----- */
  const vipNames = ["Dr. A. Okafor", "M. Laurent", "S. Whitfield", "J. Navarro", "R. Banerjee", "C. Lindqvist", "T. Abara", "E. Castellano", "H. Morgan", "P. Ivanova"];
  tableSeats(VIP_TABLE).forEach((s, i) => claim(s, { name: vipNames[i], tag: "VIP", tagKind: "vip" }, { instant: true }));
  const startFill = reduced ? 102 : PREFILL;
  seats
    .filter((s) => !s.locked)
    .sort(() => Math.random() - 0.5)
    .slice(0, startFill)
    .forEach((s) => claim(s, makeGuest(), { instant: true }));
  updateCounter();
  phoneTable = 6;
  phRound.textContent = `Table ${phoneTable + 1}`;
  phoneRefresh();
  if (!reduced) {
    after(0.6, ambient);
    after(1.6, phoneTurn);
    after(9, flashPin);
  }

  /* ----- camera ----- */
  let dist = 40;
  let az = 0.5;
  let elev = 0.6;
  let pmx = 0;
  let pmy = 0;
  let tmx = 0;
  let tmy = 0;
  const corners: THREE.Vector3[] = [];
  for (const x of [-W / 2 - 0.4, W / 2 + 0.2]) for (const y of [-0.5, H + 0.2]) for (const z of [-D / 2 - 0.4, D / 2 + 0.2]) corners.push(new THREE.Vector3(x, y, z));

  const placeCamera = (d: number) => {
    const a = az + pmx * 0.07;
    const e = elev - pmy * 0.035;
    camera.position.set(target.x + Math.sin(a) * Math.cos(e) * d, target.y + Math.sin(e) * d, target.z + Math.cos(a) * Math.cos(e) * d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };

  const resize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const wide = w > 900;
    az = wide ? 0.6 : 0.8;
    // on wide screens the room sits to the right of the copy
    const leftEdge = wide ? Math.min(w * 0.42, 605) : 0;
    const fw = wide ? (w - leftEdge) / w : 0.97;
    const fh = wide ? 0.86 : 0.82;
    let lo = 8;
    let hi = 160;
    const sx = pmx;
    const sy = pmy;
    pmx = pmy = 0;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      placeCamera(mid);
      let mxN = 0;
      let myN = 0;
      for (const cnr of corners) {
        v.copy(cnr).project(camera);
        mxN = Math.max(mxN, Math.abs(v.x));
        myN = Math.max(myN, Math.abs(v.y));
      }
      if (mxN <= fw && myN <= fh) hi = mid;
      else lo = mid;
    }
    dist = hi;
    pmx = sx;
    pmy = sy;
    if (wide) camera.setViewOffset(w, h, -leftEdge / 2, -h * 0.01, w, h);
    else camera.setViewOffset(w, h, 0, -h * 0.04, w, h);
    dirty = true;
  };

  /* ----- pointer ----- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const planeSeat = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.75);
  const hit = new THREE.Vector3();
  let pointerIn = false;

  const pickAt = (cx: number, cy: number) => {
    const r = stage.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    hoverSeat = null;
    let table = -1;
    if (ray.ray.intersectPlane(planeSeat, hit)) {
      let best = 0.36;
      for (const s of seats) {
        const d = Math.hypot(s.pos.x - hit.x, s.pos.z - hit.z);
        if (d < best) {
          best = d;
          hoverSeat = s;
        }
      }
      tableCenters.forEach((c, t) => {
        if (Math.hypot(c.x - hit.x, c.z - hit.z) < 1.8) table = t;
      });
    }
    const hs = hoverSeat as Seat | null;
    if (hs && (hs.guest || hs.locked || phase === "reset")) hoverSeat = null;
    if (table !== hoverTable) {
      hoverTable = table;
      tip.classList.toggle("ssh-on", table >= 0);
      renderTip();
    }
    renderer.domElement.style.cursor = hoverSeat ? "pointer" : "";
    dirty = true;
  };

  const onMove = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    tmx = ((e.clientX - r.left) / r.width) * 2 - 1;
    tmy = ((e.clientY - r.top) / r.height) * 2 - 1;
    pointerIn = true;
    if (e.pointerType === "mouse") pickAt(e.clientX, e.clientY);
  };
  const onLeave = () => {
    pointerIn = false;
    tmx = tmy = 0;
    hoverSeat = null;
    hoverTable = -1;
    tip.classList.remove("ssh-on");
    dirty = true;
  };
  const onClick = (e: MouseEvent) => {
    pickAt(e.clientX, e.clientY);
    const s = hoverSeat as Seat | null;
    if (s) claim(s, { name: "You", you: true }, { label: 4, instant: reduced });
  };
  const cvs = renderer.domElement;
  cvs.addEventListener("pointermove", onMove);
  cvs.addEventListener("pointerleave", onLeave);
  cvs.addEventListener("click", onClick);

  /* ----- frame loop ----- */
  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;
  let inView = true;

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!reduced) {
      simTime += dt;
      const due = timers.filter((t) => t.t <= simTime);
      if (due.length) {
        timers = timers.filter((t) => t.t > simTime);
        due.forEach((t) => t.fn());
      }
      pmx += (tmx - pmx) * Math.min(1, dt * 2.5);
      pmy += (tmy - pmy) * Math.min(1, dt * 2.5);
    } else if (!dirty) return;
    dirty = false;

    // token drops and lifts
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      const p = Math.min(1, (simTime - a.t0) / a.dur);
      if (a.type === "drop") {
        // settle onto the chair with a slight overshoot
        const q = p - 1;
        setToken(a.seat, q * q * 0.35, 1 + 2.7 * q * q * q + 1.7 * q * q);
      } else setToken(a.seat, p * p * 0.4, a.seat.guest ? 1 : 1 - p);
      if (p >= 1) anims.splice(i, 1);
    }

    // claim effects
    for (const f of fx) {
      if (!f.ring.visible) continue;
      const p = (simTime - f.t0) / 1.1;
      if (p >= 1) {
        f.ring.visible = f.beam.visible = false;
        continue;
      }
      const s = 0.35 + p * 0.75;
      f.ring.scale.setScalar(s);
      (f.ring.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9;
      (f.beam.material as THREE.MeshBasicMaterial).opacity = (1 - p) * (1 - p) * 0.55;
      f.beam.scale.set(1 + p * 0.5, 1, 1 + p * 0.5);
    }

    // hover ring
    const hs = hoverSeat;
    if (hs && pointerIn) {
      hoverRing.visible = true;
      hoverRing.position.set(hs.pos.x, 0.6, hs.pos.z);
      hoverRing.scale.setScalar(0.34 + Math.sin(simTime * 6) * 0.02);
      (hoverRing.material as THREE.MeshBasicMaterial).opacity = 0.95;
    } else if (hoverTable >= 0 && pointerIn) {
      const c = tableCenters[hoverTable];
      hoverRing.visible = true;
      hoverRing.position.set(c.x, 0.04, c.z);
      hoverRing.scale.setScalar(1.78);
      (hoverRing.material as THREE.MeshBasicMaterial).opacity = 0.5;
    } else hoverRing.visible = false;

    // candle flicker and dust drift
    const flick = 0.62 + Math.sin(simTime * 9) * 0.05 + Math.sin(simTime * 23.7) * 0.04;
    haloMat.opacity = flick * 0.6;
    glowTopMat.opacity = 0;
    dust.position.y = Math.sin(simTime * 0.25) * 0.25;
    dust.position.x = Math.sin(simTime * 0.11) * 0.5;

    placeCamera(dist);
    renderer.render(scene, camera);

    // overlay positions
    for (const l of labels) {
      if (!l.seat) continue;
      if (simTime > l.until && !reduced) {
        l.node.classList.remove("ssh-on");
        if (simTime > l.until + 0.4) l.seat = null;
      }
      if (!l.seat) continue;
      const p = toScreen(l.seat.pos.x, SEAT_Y + 1.05, l.seat.pos.z);
      l.node.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    const vc = tableCenters[VIP_TABLE];
    const pp = toScreen(vc.x, 1.75, vc.z);
    pin.style.transform = `translate(${pp.x}px, ${pp.y}px) translate(-50%, -100%)`;
    if (hoverTable >= 0) {
      const c = tableCenters[hoverTable];
      const tp = toScreen(c.x, 1.9, c.z);
      tip.style.transform = `translate(${tp.x}px, ${tp.y}px) translate(-50%, -100%) translateY(-34px)`;
    }
  };

  const start = () => {
    if (running) return;
    running = true;
    clock.getDelta();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const sync = () => (inView && !document.hidden ? start() : stop());

  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  const io = new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
    sync();
  });
  io.observe(stage);
  document.addEventListener("visibilitychange", sync);

  resize();
  start();
  requestAnimationFrame(() => stage.classList.add("ssh-ready"));

  return {
    destroy() {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      cvs.removeEventListener("pointermove", onMove);
      cvs.removeEventListener("pointerleave", onLeave);
      cvs.removeEventListener("click", onClick);
      domTimers.forEach((id) => clearTimeout(id));
      disposables.forEach((d) => d.dispose());
      envRT.dispose();
      renderer.dispose();
      cvs.remove();
      overlay.remove();
      stage.classList.remove("ssh-ready");
    },
  };
}
