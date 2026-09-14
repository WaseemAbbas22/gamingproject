import {
  Application,
  Asset,
  Color,
  Entity,
  Mesh,
  MeshInstance,
  StandardMaterial,
  ADDRESS_REPEAT,
  FILTER_LINEAR,
  FILTER_LINEAR_MIPMAP_LINEAR,
  Texture,
  Vec3
} from 'playcanvas';
import {
  AI_COLORS,
  CarDef,
  CarId,
  DAILY_KEY,
  GARAGE_CARS,
  LayoutId,
  OWNED_CARS_KEY,
  OWNED_TRACKS_KEY,
  REMOVE_ADS_KEY,
  REWARD_BY_PLACE,
  SETTINGS_KEY,
  TRACKS,
  TRACK_LAYOUTS,
  ThemeId,
  TrackId,
  loadBool,
  loadCoins,
  loadPlayerName,
  loadRaceHistory,
  loadSet,
  pushRaceHistory,
  saveBool,
  saveCoins,
  savePlayerName,
  saveRaceHistory,
  saveSet
} from './data';
import { ClosedCurve, Sample, addScaled, clamp, damp, dampAngle } from './curve';
import {
  EngineContext,
  Quality,
  applyCameraFrame,
  applyHdrSky,
  createEngine,
  loadAsset
} from './engine';

const SEG = 560;
const MAX_SPEED = 72;
/** Quicker pull, still ramps up (not instant). */
const ACCEL = 20;
const BRAKE = 32;
const FRICTION = 5.2;
const TURN_RATE = 1.02;
const STEER_RESPONSE = 5.2;
const CORNER_DRAG = 30;
const BASE_FOV = 52;
/** ~m/s → km/h so HUD matches how fast the car actually moves. */
const SPEED_TO_KMH = 3.6;

type RaceState = 'idle' | 'countdown' | 'racing' | 'finished';

declare global {
  interface Window {
    AndroidBridge?: Record<string, (...args: unknown[]) => unknown>;
    Android?: Record<string, (...args: unknown[]) => unknown>;
    __gamePaused?: boolean;
    onRewardedAdCompleted?: () => void;
    onRewardedAdClosed?: () => void;
    onRewardedAdFailed?: (reason?: string) => void;
    onInterstitialClosed?: () => void;
    onPurchaseCompleted?: (id: string) => void;
    onPurchaseRestored?: (id: string) => void;
  }
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function nativeBridge() {
  return window.AndroidBridge || window.Android || null;
}

function nativeCall(name: string, ...args: unknown[]): boolean {
  const bridge = nativeBridge();
  if (bridge && typeof bridge[name] === 'function') {
    try {
      bridge[name](...args);
      return true;
    } catch { /* ignore */ }
  }
  const status = document.getElementById('nativeStatus');
  if (status) status.textContent = 'Android app connection is not active in this web preview.';
  return false;
}

function themedConfirm(title: string, body: string, opts?: { cancel?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById('themeModal');
    const titleEl = document.getElementById('themeModalTitle');
    const bodyEl = document.getElementById('themeModalBody');
    const ok = document.getElementById('themeModalOk');
    const cancel = document.getElementById('themeModalCancel');
    if (!modal || !titleEl || !bodyEl || !ok || !cancel) {
      resolve(opts?.cancel === false ? (window.alert(`${title}\n\n${body}`), true) : window.confirm(`${title}\n\n${body}`));
      return;
    }
    titleEl.textContent = title;
    bodyEl.textContent = body;
    cancel.style.display = opts?.cancel === false ? 'none' : '';
    modal.classList.add('show');
    const finish = (value: boolean) => {
      modal.classList.remove('show');
      cancel.style.display = '';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

function computeNormals(pos: number[], idx: number[]): number[] {
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[b] - pos[a], ay = pos[b + 1] - pos[a + 1], az = pos[b + 2] - pos[a + 2];
    const bx = pos[c] - pos[a], by = pos[c + 1] - pos[a + 1], bz = pos[c + 2] - pos[a + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
    nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
    nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }
  return Array.from(nrm);
}

function makeMesh(app: Application, positions: number[], uvs: number[], indices: number[]): Mesh {
  const mesh = new Mesh(app.graphicsDevice);
  mesh.setPositions(positions);
  mesh.setNormals(computeNormals(positions, indices));
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update();
  return mesh;
}

function meshEntity(app: Application, name: string, mesh: Mesh, material: StandardMaterial, cast = false): Entity {
  const e = new Entity(name);
  e.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)] });
  e.render!.castShadows = cast;
  e.render!.receiveShadows = true;
  return e;
}

function prim(
  _app: Application,
  type: string,
  name: string,
  mat: StandardMaterial,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  cast = true,
  rx = 0,
  ry = 0,
  rz = 0
): Entity {
  const e = new Entity(name);
  e.addComponent('render', { type, material: mat, castShadows: cast, receiveShadows: true });
  e.setLocalScale(sx, sy, sz);
  e.setLocalEulerAngles(rx, ry, rz);
  e.setPosition(x, y, z);
  return e;
}

function mat(r: number, g: number, b: number, metal = 0.08, gloss = 0.35, emit = 0): StandardMaterial {
  const m = new StandardMaterial();
  m.diffuse = new Color(r, g, b);
  m.useMetalness = true;
  m.metalness = metal;
  m.gloss = gloss;
  if (emit) {
    m.emissive = new Color(r, g, b);
    m.emissiveIntensity = emit;
  }
  m.update();
  return m;
}

function buildFallbackCar(app: Application, color: [number, number, number]): Entity {
  const root = new Entity('fallbackCar');
  const paint = mat(color[0], color[1], color[2], 0.55, 0.88, 0.1);
  const carbon = mat(0.05, 0.05, 0.06, 0.55, 0.4);
  const glass = mat(0.03, 0.06, 0.09, 0.94, 0.98, 0.04);
  const chrome = mat(0.78, 0.8, 0.84, 0.95, 0.92);
  const tail = mat(0.95, 0.08, 0.1, 0.2, 0.5, 4.5);
  const exhaust = mat(0.25, 0.7, 1, 0.3, 0.6, 3.2);
  const add = (
    type: string,
    name: string,
    m: StandardMaterial,
    x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    rx = 0, ry = 0, rz = 0
  ) => {
    root.addChild(prim(app, type, name, m, x, y, z, sx, sy, sz, true, rx, ry, rz));
  };
  add('box', 'keel', carbon, 0, 0.22, 0.1, 1.55, 0.16, 4.6);
  add('box', 'body', paint, 0, 0.48, 0.15, 2.18, 0.38, 4.15);
  add('box', 'nose', paint, 0, 0.4, -2.05, 1.35, 0.2, 0.95);
  add('cone', 'arrow', paint, 0, 0.42, -2.45, 0.95, 0.55, 0.95, 90, 0, 0);
  add('box', 'hood', paint, 0, 0.66, -1.05, 1.72, 0.14, 1.55);
  add('box', 'cabin', glass, 0, 0.92, 0.35, 1.42, 0.46, 1.55);
  add('box', 'canopy', carbon, 0, 1.18, 0.42, 1.18, 0.1, 1.15);
  add('box', 'intakeL', carbon, -0.95, 0.52, 0.15, 0.28, 0.22, 1.15);
  add('box', 'intakeR', carbon, 0.95, 0.52, 0.15, 0.28, 0.22, 1.15);
  add('box', 'haunchL', paint, -0.95, 0.58, 1.45, 0.55, 0.36, 1.35);
  add('box', 'haunchR', paint, 0.95, 0.58, 1.45, 0.55, 0.36, 1.35);
  add('box', 'deck', carbon, 0, 0.7, 1.55, 1.55, 0.16, 1.15);
  add('box', 'stalkL', carbon, -0.62, 1.05, 2.05, 0.08, 0.55, 0.08);
  add('box', 'stalkR', carbon, 0.62, 1.05, 2.05, 0.08, 0.55, 0.08);
  add('box', 'wing', carbon, 0, 1.34, 2.08, 2.15, 0.07, 0.38);
  add('box', 'splitter', carbon, 0, 0.2, -2.35, 1.55, 0.06, 0.32);
  add('box', 'skirtL', carbon, -1.08, 0.28, 0.1, 0.12, 0.1, 3.4);
  add('box', 'skirtR', carbon, 1.08, 0.28, 0.1, 0.12, 0.1, 3.4);
  add('sphere', 'tailL', tail, -0.62, 0.52, 2.22, 0.22, 0.16, 0.1);
  add('sphere', 'tailR', tail, 0.62, 0.52, 2.22, 0.22, 0.16, 0.1);
  add('cylinder', 'ex1', exhaust, -0.38, 0.28, 2.28, 0.1, 0.16, 0.1, 90, 0, 0);
  add('cylinder', 'ex2', exhaust, -0.22, 0.28, 2.28, 0.1, 0.16, 0.1, 90, 0, 0);
  add('cylinder', 'ex3', exhaust, 0.22, 0.28, 2.28, 0.1, 0.16, 0.1, 90, 0, 0);
  add('cylinder', 'ex4', exhaust, 0.38, 0.28, 2.28, 0.1, 0.16, 0.1, 90, 0, 0);
  add('box', 'lampL', chrome, -0.55, 0.42, -2.42, 0.32, 0.08, 0.06);
  add('box', 'lampR', chrome, 0.55, 0.42, -2.42, 0.32, 0.08, 0.06);
  [[-0.92, 0.34, -1.38], [0.92, 0.34, -1.38], [-0.98, 0.34, 1.42], [0.98, 0.34, 1.42]].forEach(([x, y, z], i) => {
    add('cylinder', `wheel${i}`, carbon, x, y, z, 0.7, 0.32, 0.7, 0, 0, 90);
  });
  return root;
}

function tintMaterials(root: Entity, color: [number, number, number], glossy: boolean): void {
  root.findComponents('render').forEach((render) => {
    render.castShadows = true;
    render.receiveShadows = true;
    render.meshInstances.forEach((mi) => {
      const mat = mi.material.clone() as StandardMaterial;
      mat.useMetalness = true;
      mat.metalness = glossy ? 0.72 : 0.28;
      mat.gloss = glossy ? 0.88 : 0.55;
      mat.diffuse = new Color(color[0], color[1], color[2]);
      mat.update();
      mi.material = mat;
    });
  });
}

class Racer {
  entity: Entity;
  isPlayer: boolean;
  config: CarDef;
  speed = 0;
  lap = 1;
  sampleIndex = 0;
  prevSampleIndex = 0;
  distance = 0;
  finished = false;
  finishTime: number | null = null;
  crashCooldown = 0;
  crashSpin = 0;
  crashShake = 0;
  angle = 0;
  maxSpeed: number;
  aiBaseSpeed: number;
  aiLane: number;
  aiTargetLane: number;
  aiRenderLane: number;
  aiPassSide: number;
  aiOffsetSeed = Math.random() * 1000;
  trackDistance = 0;
  _t = 0;
  _prevSpeedForFlame = 0;

  constructor(entity: Entity, isPlayer: boolean, config: CarDef, startOffset: number, s0: Sample) {
    this.entity = entity;
    this.isPlayer = isPlayer;
    this.config = config;
    this.maxSpeed = config.maxSpeed || MAX_SPEED;
    this.aiBaseSpeed = this.maxSpeed * (0.70 + Math.random() * 0.18);
    this.aiLane = isPlayer ? 0 : startOffset * 0.95;
    this.aiTargetLane = this.aiLane;
    this.aiRenderLane = this.aiLane;
    this.aiPassSide = Math.random() > 0.5 ? 1 : -1;
    this.angle = Math.atan2(s0.tan.x, s0.tan.z);
    const pos = addScaled(s0.p, s0.nrm, startOffset);
    entity.setPosition(pos.x, 0, pos.z);
    entity.setEulerAngles(0, this.angle * 180 / Math.PI + 180, 0);
  }

  get pos(): Vec3 {
    return this.entity.getPosition();
  }
}

export async function bootGame(): Promise<void> {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  const status = (window as Window & { __bootStatus?: (t: string) => void }).__bootStatus;
  const engine = await createEngine(canvas);
  const { app, camera, sun, android } = engine;
  if (!android) {
    try { await applyHdrSky(app); } catch (err) { console.warn('HDR sky failed', err); }
  }
  status?.('Building circuit…');

  const asphalt = android
    ? null
    : await loadAsset(app, 'asphalt', 'texture', './env/asphalt.jpg').catch(() => null);
  if (asphalt?.resource) {
    const tex = asphalt.resource as Texture;
    tex.addressU = ADDRESS_REPEAT;
    tex.addressV = ADDRESS_REPEAT;
  }

  let playerCoins = loadCoins();
  saveCoins(playerCoins);
  let playerName = loadPlayerName();
  let removeAds = loadBool(REMOVE_ADS_KEY);
  const ownedCars = loadSet(OWNED_CARS_KEY, ['apex']);
  const ownedTracks = loadSet(OWNED_TRACKS_KEY, ['classic']);
  if (!ownedCars.has('apex')) ownedCars.add('apex');
  if (!ownedTracks.has('classic')) ownedTracks.add('classic');

  let selectedGarageCar: CarId = 'apex';
  let selectedTrack: TrackId = 'classic';
  let carConfig: CarDef = { ...GARAGE_CARS.apex };
  let TOTAL_LAPS = 2;
  let raceState: RaceState = 'idle';
  let raceTime = 0;
  let raceRewardGranted = false;
  let settingsOpen = false;
  let targetFPS = 60;
  let quality: Quality = android ? 'low' : 'high';
  let soundMuted = false;
  let steerSmooth = 0;
  let hudSpeedSmooth = 0;
  let physAccum = 0;
  let rearView = false;
  let countdownTimer: number | null = null;
  let lastFrame = 0;
  let hudAccum = 0;

  let curve: ClosedCurve;
  let samples: Sample[] = [];
  let TRACK_LEN = 1;
  let ROAD_W = 24.5;
  let FENCE_LIMIT = 15;
  let activeLayoutId: LayoutId = 'classic';
  let activeTheme: ThemeId = 'golf';
  const worldRoot = new Entity('world');
  app.root.addChild(worldRoot);
  type Walker = { entity: Entity; t: number; side: number; speed: number; phase: number };
  let walkers: Walker[] = [];
  type Obstacle = { x: number; z: number; hx: number; hz: number };
  let obstacles: Obstacle[] = [];

  const keys: Record<string, boolean> = {};
  const touchState = { gas: false, brake: false, steer: 0 };
  window.__gamePaused = false;
  let watchAdsRemaining = 0;
  let watchAdsEarned = 0;
  let watchAdJustRewarded = false;
  let watchAdAwaiting = false;
  let singleRewardPending = false;
  let testAdTimer: number | null = null;

  let player: Racer;
  let aiCars: Racer[] = [];
  let allCars: Racer[] = [];
  const carCache = new Map<string, Asset>();

  function canvasTexture(source: HTMLCanvasElement): Texture {
    const tex = new Texture(app.graphicsDevice, { width: source.width, height: source.height, mipmaps: true });
    tex.addressU = ADDRESS_REPEAT;
    tex.addressV = ADDRESS_REPEAT;
    tex.minFilter = FILTER_LINEAR_MIPMAP_LINEAR;
    tex.magFilter = FILTER_LINEAR;
    try { tex.anisotropy = android ? 4 : 8; } catch { /* ignore */ }
    tex.setSource(source);
    tex.upload();
    return tex;
  }

  function makeAsphaltMap(): Texture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    // Soft silver asphalt — no hard stripes (those shimmer/smear while driving).
    ctx.fillStyle = '#9098a2';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const n = 120 + Math.random() * 80;
      ctx.fillStyle = `rgba(${n},${n + 2},${n + 5},${0.08 + Math.random() * 0.16})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
    }
    return canvasTexture(c);
  }

  const roadMat = new StandardMaterial();
  roadMat.useMetalness = true;
  // Low gloss — high metal/gloss makes asphalt sparkle and look sick when moving.
  roadMat.metalness = 0.08;
  roadMat.gloss = 0.18;
  roadMat.diffuseMap = makeAsphaltMap();
  if (roadMat.diffuseMap) {
    roadMat.diffuseMap.addressU = ADDRESS_REPEAT;
    roadMat.diffuseMap.addressV = ADDRESS_REPEAT;
  }
  roadMat.diffuse = new Color(0.58, 0.62, 0.68);
  roadMat.update();

  const curbMat = new StandardMaterial();
  curbMat.diffuse = new Color(0.85, 0.12, 0.12);
  curbMat.useMetalness = true;
  curbMat.metalness = 0.15;
  curbMat.gloss = 0.35;
  curbMat.update();

  const fenceMat = new StandardMaterial();
  fenceMat.diffuse = new Color(0.72, 0.74, 0.78);
  fenceMat.useMetalness = true;
  fenceMat.metalness = 0.55;
  fenceMat.gloss = 0.6;
  fenceMat.update();

  const walkMat = mat(0.62, 0.63, 0.66, 0.08, 0.22);
  const lineMat = mat(0.96, 0.86, 0.18, 0.04, 0.28, 0.2);
  const dashMat = mat(0.88, 0.88, 0.9, 0.02, 0.12, 0.08);
  const edgeMat = mat(0.93, 0.93, 0.95, 0.05, 0.18);
  const waterMat = mat(0.12, 0.38, 0.62, 0.55, 0.86, 0.08);
  const barrierMat = mat(0.78, 0.8, 0.82, 0.12, 0.3);

  const grassMat = new StandardMaterial();
  grassMat.diffuse = new Color(0.42, 0.58, 0.24);
  grassMat.useMetalness = true;
  grassMat.metalness = 0.02;
  grassMat.gloss = 0.18;
  grassMat.update();

  const ground = new Entity('ground');
  ground.addComponent('render', { type: 'plane', material: grassMat, castShadows: false, receiveShadows: true });
  ground.setLocalScale(900, 1, 900);
  app.root.addChild(ground);

  function clearWorld(): void {
    const remove: Entity[] = [];
    worldRoot.children.forEach((c) => remove.push(c as Entity));
    remove.forEach((c) => c.destroy());
    obstacles = [];
  }

  function addObstacle(_x: number, _z: number, _sx: number, _sz: number): void {
    /* collisions disabled */
  }

  function rebuildSamples(layoutId: LayoutId): void {
    const layout = TRACK_LAYOUTS[layoutId] || TRACK_LAYOUTS.classic;
    activeLayoutId = layoutId;
    ROAD_W = layout.roadW;
    FENCE_LIMIT = ROAD_W / 2 + 2.9;
    curve = new ClosedCurve(layout.pts.map(([x, y, z]) => ({ x, y, z })));
    TRACK_LEN = curve.getLength();
    samples = buildSamplesSafe(curve);
  }

  function buildSamplesSafe(c: ClosedCurve): Sample[] {
    const out: Sample[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const p = c.getPointAt(t);
      const tan = c.getTangentAt(t);
      out.push({ t, p, tan, nrm: { x: -tan.z, y: 0, z: tan.x } });
    }
    return out;
  }

  function findNearest(pos: { x: number; z: number }, hint = 0): { index: number; distSq: number } {
    let bestI = 0, bestD = Infinity;
    const start = hint - 40, end = hint + 40;
    for (let k = start; k <= end; k++) {
      const i = ((k % SEG) + SEG) % SEG;
      const dx = samples[i].p.x - pos.x;
      const dz = samples[i].p.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return { index: bestI, distSq: bestD };
  }

  function buildRibbon(width: number, y: number, uvScale: number): { mesh: Mesh } {
    return buildBand(-width / 2, width / 2, y, uvScale);
  }

  function buildBand(inner: number, outer: number, y: number, uvScale: number): { mesh: Mesh } {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const s = samples[i];
      const l = addScaled(s.p, s.nrm, outer);
      const r = addScaled(s.p, s.nrm, inner);
      positions.push(l.x, y, l.z, r.x, y, r.z);
      uvs.push(0, i * uvScale, 1, i * uvScale);
      if (i < SEG) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    return { mesh: makeMesh(app, positions, uvs, indices) };
  }

  function buildDashedBand(inner: number, outer: number, y: number, dash = 5.2, gap = 4.4): { mesh: Mesh } {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let dist = 0;
    let prev = samples[0].p;
    let emit = true;
    let lastSwitch = 0;
    for (let i = 0; i <= SEG; i++) {
      const s = samples[i];
      dist += Math.hypot(s.p.x - prev.x, s.p.z - prev.z);
      prev = s.p;
      if (dist - lastSwitch > (emit ? dash : gap)) {
        emit = !emit;
        lastSwitch = dist;
      }
      if (!emit || i === SEG) continue;
      const n = samples[Math.min(i + 1, SEG)];
      const a = addScaled(s.p, s.nrm, outer);
      const b = addScaled(s.p, s.nrm, inner);
      const c = addScaled(n.p, n.nrm, outer);
      const d = addScaled(n.p, n.nrm, inner);
      const base = positions.length / 3;
      positions.push(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z, d.x, y, d.z);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    return { mesh: makeMesh(app, positions, uvs, indices) };
  }

  function along(i: number, side: number, extra: number) {
    const s = samples[((i % SEG) + SEG) % SEG];
    return addScaled(s.p, s.nrm, side * (ROAD_W / 2 + extra));
  }

  function minDistToRoad(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < SEG; i += 3) {
      const dx = samples[i].p.x - x, dz = samples[i].p.z - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function buildPerson(clothes: StandardMaterial, skin: StandardMaterial): Entity {
    const root = new Entity('walker');
    root.addChild(prim(app, 'capsule', 'body', clothes, 0, 0.78, 0, 0.42, 1.05, 0.42, false));
    root.addChild(prim(app, 'sphere', 'head', skin, 0, 1.48, 0, 0.32, 0.32, 0.32, false));
    root.addChild(prim(app, 'capsule', 'legL', clothes, -0.12, 0.28, 0, 0.16, 0.5, 0.16, false));
    root.addChild(prim(app, 'capsule', 'legR', clothes, 0.12, 0.28, 0, 0.16, 0.5, 0.16, false));
    return root;
  }

  function spawnWalkers(): void {
    walkers = [];
    if (android) return;
    const count = 28;
    const clothes = [
      mat(0.78, 0.18, 0.16), mat(0.16, 0.32, 0.72), mat(0.18, 0.5, 0.28),
      mat(0.92, 0.78, 0.2), mat(0.15, 0.15, 0.16), mat(0.72, 0.42, 0.18)
    ];
    const skin = mat(0.86, 0.68, 0.52, 0.02, 0.25);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const entity = buildPerson(clothes[i % clothes.length], skin);
      worldRoot.addChild(entity);
      walkers.push({
        entity,
        t: i / count,
        side,
        speed: 1.35 + (i % 5) * 0.18,
        phase: i * 1.7
      });
    }
  }

  function updateWalkers(dt: number): void {
    if (android) return;
    const walkOff = ROAD_W / 2 + 3.35;
    walkers.forEach((w) => {
      const dir = w.side;
      w.t = ((w.t + (w.speed * dir * dt) / TRACK_LEN) % 1 + 1) % 1;
      const p = curve.getPointAt(w.t);
      const tan = curve.getTangentAt(w.t);
      const nrm = { x: -tan.z, y: 0, z: tan.x };
      const bob = Math.abs(Math.sin(raceTime * 6 + w.phase)) * 0.05;
      w.entity.setPosition(p.x + nrm.x * walkOff * w.side, bob, p.z + nrm.z * walkOff * w.side);
      const heading = Math.atan2(tan.x * dir, tan.z * dir) * 180 / Math.PI;
      w.entity.setEulerAngles(0, heading, 0);
    });
  }

  function placeBuilding(
    concrete: StandardMaterial,
    glass: StandardMaterial,
    i: number,
    side: number,
    extra: number,
    h: number,
    w: number,
    d: number
  ): void {
    const p = along(i, side, extra);
    if (minDistToRoad(p.x, p.z) < ROAD_W / 2 + 9) return;
    worldRoot.addChild(prim(app, 'box', 'bldg', concrete, p.x, h / 2, p.z, w, h, d));
    worldRoot.addChild(prim(app, 'box', 'glass', glass, p.x + side * w * 0.42, h * 0.52, p.z, 0.18, h * 0.72, d * 0.74, false));
    addObstacle(p.x, p.z, w, d);
  }

  function buildWorld(theme: ThemeId): void {
    clearWorld();
    walkers = [];
    activeTheme = theme;
    const half = ROAD_W / 2;
    const lane = ROAD_W / 4;
    worldRoot.addChild(meshEntity(app, 'road', buildRibbon(ROAD_W, 0.05, 0.22).mesh, roadMat));
    worldRoot.addChild(meshEntity(app, 'yelL', buildBand(-0.32, -0.1, 0.062, 0.9).mesh, lineMat, false));
    worldRoot.addChild(meshEntity(app, 'yelR', buildBand(0.1, 0.32, 0.062, 0.9).mesh, lineMat, false));
    // Dense dashed paint shimmers on phones — use longer/sparser dashes (or solid on low).
    if (android) {
      worldRoot.addChild(meshEntity(app, 'dashL', buildBand(-lane - 0.08, -lane + 0.08, 0.063, 0.35).mesh, dashMat, false));
      worldRoot.addChild(meshEntity(app, 'dashR', buildBand(lane - 0.08, lane + 0.08, 0.063, 0.35).mesh, dashMat, false));
    } else {
      worldRoot.addChild(meshEntity(app, 'dashL', buildDashedBand(-lane - 0.1, -lane + 0.1, 0.063, 7.5, 5.5).mesh, dashMat, false));
      worldRoot.addChild(meshEntity(app, 'dashR', buildDashedBand(lane - 0.1, lane + 0.1, 0.063, 7.5, 5.5).mesh, dashMat, false));
    }
    worldRoot.addChild(meshEntity(app, 'edgeL', buildBand(half - 0.2, half, 0.061, 0.5).mesh, edgeMat, false));
    worldRoot.addChild(meshEntity(app, 'edgeR', buildBand(-half, -half + 0.2, 0.061, 0.5).mesh, edgeMat, false));
    worldRoot.addChild(meshEntity(app, 'curbL', buildBand(half, half + 1.05, 0.1, 0.45).mesh, curbMat, false));
    worldRoot.addChild(meshEntity(app, 'curbR', buildBand(-half - 1.05, -half, 0.1, 0.45).mesh, curbMat, false));
    worldRoot.addChild(meshEntity(app, 'walkL', buildBand(half + 1.05, half + 5.4, 0.07, 0.2).mesh, walkMat, false));
    worldRoot.addChild(meshEntity(app, 'walkR', buildBand(-half - 5.4, -half - 1.05, 0.07, 0.2).mesh, walkMat, false));

    const glass = mat(0.42, 0.68, 0.92, 0.9, 0.94, 0.1);
    const concrete = mat(0.58, 0.6, 0.63, 0.1, 0.26);
    const brick = mat(0.55, 0.32, 0.24, 0.04, 0.2);
    const leaf = mat(0.16, 0.46, 0.18, 0.03, 0.2);
    const trunk = mat(0.3, 0.18, 0.09, 0.02, 0.15);
    const sand = mat(0.86, 0.74, 0.42, 0.02, 0.12);
    const snow = mat(0.9, 0.93, 0.96, 0.02, 0.18);
    const steel = mat(0.64, 0.67, 0.72, 0.68, 0.55);
    const red = mat(0.78, 0.12, 0.12, 0.08, 0.3);
    const palm = mat(0.2, 0.56, 0.22, 0.03, 0.2);
    const lamp = mat(0.14, 0.14, 0.15, 0.7, 0.4);
    const bulb = mat(1, 0.86, 0.5, 0.1, 0.4, 6);
    const cream = mat(0.86, 0.82, 0.74, 0.04, 0.22);

    const flag = mat(0.95, 0.15, 0.18, 0.05, 0.3);
    const cactus = mat(0.22, 0.48, 0.2, 0.03, 0.18);
    const rock = mat(0.52, 0.4, 0.3, 0.04, 0.15);
    const green = mat(0.22, 0.58, 0.2, 0.02, 0.2);

    const setSky = (r: number, g: number, b: number, amb: Color, sunCol: Color, sunI: number) => {
      if (camera.camera) camera.camera.clearColor = new Color(r, g, b);
      app.scene.ambientLight = amb;
      if (sun.light) { sun.light.color = sunCol; sun.light.intensity = sunI; }
    };

    if (theme === 'desert') {
      grassMat.diffuse = new Color(0.82, 0.64, 0.34);
      setSky(0.78, 0.62, 0.38, new Color(0.62, 0.5, 0.32), new Color(1, 0.88, 0.62), 3.4);
    } else if (theme === 'jungle') {
      grassMat.diffuse = new Color(0.14, 0.36, 0.1);
      setSky(0.38, 0.52, 0.42, new Color(0.28, 0.4, 0.26), new Color(0.85, 0.95, 0.7), 2.2);
    } else if (theme === 'golf') {
      grassMat.diffuse = new Color(0.28, 0.58, 0.22);
      setSky(0.48, 0.72, 0.92, new Color(0.5, 0.58, 0.48), new Color(1, 0.96, 0.82), 2.8);
    } else if (theme === 'city') {
      grassMat.diffuse = new Color(0.2, 0.24, 0.22);
      setSky(0.42, 0.68, 0.92, new Color(0.48, 0.54, 0.62), new Color(1, 0.95, 0.82), 3.1);
    } else if (theme === 'f1') {
      grassMat.diffuse = new Color(0.2, 0.32, 0.16);
      setSky(0.45, 0.66, 0.88, new Color(0.42, 0.46, 0.5), new Color(1, 0.94, 0.84), 3);
    } else if (theme === 'snow') {
      grassMat.diffuse = new Color(0.88, 0.92, 0.96);
      setSky(0.72, 0.8, 0.9, new Color(0.7, 0.76, 0.84), new Color(0.95, 0.96, 1), 2.4);
    }
    grassMat.update();

    const tree = (x: number, z: number, scale = 1) => {
      worldRoot.addChild(prim(app, 'cylinder', 'trunk', trunk, x, 3.6 * scale, z, 0.45 * scale, 7.2 * scale, 0.45 * scale));
      worldRoot.addChild(prim(app, 'sphere', 'leaf', leaf, x, 7.6 * scale, z, 4.2 * scale, 2.8 * scale, 4.2 * scale));
    };

    if (theme === 'golf') {
      const club = along(12, 1, 22);
      worldRoot.addChild(prim(app, 'box', 'clubhouse', cream, club.x, 3.4, club.z, 22, 6.8, 12));
      worldRoot.addChild(prim(app, 'box', 'roof', brick, club.x, 7.1, club.z, 24, 1.2, 14, false));
      for (let i = 0; i < (android ? 14 : 16); i++) {
        const p = along(20 + i * Math.floor(SEG / 16), i % 2 ? 1 : -1, 16 + (i % 3) * 4);
        if (minDistToRoad(p.x, p.z) < half + 10) continue;
        worldRoot.addChild(prim(app, 'sphere', 'bunker', sand, p.x, 0.15, p.z, 7 + (i % 3), 0.7, 5, false));
      }
      for (let i = 0; i < 8; i++) {
        const p = along(30 + i * Math.floor(SEG / 8), i % 2 ? -1 : 1, 14);
        worldRoot.addChild(prim(app, 'cylinder', 'pin', fenceMat, p.x, 1.6, p.z, 0.06, 3.2, 0.06, false));
        worldRoot.addChild(prim(app, 'box', 'flag', flag, p.x + 0.45, 2.9, p.z, 0.9, 0.45, 0.04, false));
        worldRoot.addChild(prim(app, 'cylinder', 'hole', green, p.x, 0.08, p.z, 2.8, 0.12, 2.8, false));
      }
      for (let i = 0; i < (android ? 18 : 22); i++) {
        const p = along(i * Math.floor(SEG / 22) + 4, i % 2 ? 1 : -1, 18 + (i % 4) * 3);
        if (minDistToRoad(p.x, p.z) < half + 9) continue;
        tree(p.x, p.z, 0.85 + (i % 3) * 0.12);
      }
      const pond = along(80, -1, 28);
      worldRoot.addChild(prim(app, 'cylinder', 'pond', waterMat, pond.x, -0.05, pond.z, 16, 0.2, 12, false));
    } else if (theme === 'desert') {
      for (let i = 0; i < (android ? 16 : 20); i++) {
        const a = (i / 20) * Math.PI * 2;
        const dist = 70 + (i % 5) * 22;
        const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
        if (minDistToRoad(x, z) < 28) continue;
        worldRoot.addChild(prim(app, 'sphere', 'dune', sand, x, 1.4 + (i % 3) * 0.8, z, 18 + (i % 4) * 6, 5 + (i % 3) * 2, 14 + (i % 3) * 4, false));
      }
      for (let i = 0; i < (android ? 22 : 28); i++) {
        const p = along(i * Math.floor(SEG / 28) + 5, i % 2 ? 1 : -1, 12 + (i % 4) * 3);
        if (minDistToRoad(p.x, p.z) < half + 8) continue;
        worldRoot.addChild(prim(app, 'cylinder', 'cactus', cactus, p.x, 1.8, p.z, 0.35, 3.6, 0.35));
        worldRoot.addChild(prim(app, 'cylinder', 'arm', cactus, p.x + 0.45, 2.2, p.z, 0.7, 0.28, 0.28, false, 0, 0, 90));
        if (i % 3 === 0) worldRoot.addChild(prim(app, 'sphere', 'rock', rock, p.x + 2.2, 0.5, p.z + 1.4, 2.4, 1.1, 1.8, false));
      }
    } else if (theme === 'jungle') {
      const rows = android ? 46 : 56;
      for (let i = 0; i < rows; i++) {
        const side = i % 2 ? 1 : -1;
        const p = along(i * Math.floor(SEG / rows) + (i % 5), side, 9 + (i % 5) * 2.4);
        if (minDistToRoad(p.x, p.z) < half + 6) continue;
        tree(p.x, p.z, 1.05 + (i % 4) * 0.18);
        if (i % 2 === 0) {
          const p2 = along(i * Math.floor(SEG / rows) + 8, side, 16 + (i % 3) * 3);
          tree(p2.x, p2.z, 0.8 + (i % 3) * 0.15);
        }
      }
    } else if (theme === 'city') {
      const bCount = android ? 22 : 28;
      for (let i = 0; i < bCount; i++) {
        placeBuilding(concrete, glass, Math.floor((i / bCount) * SEG) + 8, i % 2 ? 1 : -1, 12 + (i % 4) * 3.5, 16 + (i % 8) * 5, 8 + (i % 3) * 2, 8 + (i % 2) * 3);
      }
      worldRoot.addChild(prim(app, 'box', 'ocean', waterMat, 210, -0.18, 10, 260, 0.12, 420, false));
      const crateColors = [mat(0.12, 0.32, 0.78), mat(0.78, 0.14, 0.12), mat(0.16, 0.58, 0.22), mat(0.9, 0.72, 0.12)];
      for (let i = 0; i < (android ? 12 : 14); i++) {
        const p = along(Math.floor((i / 14) * SEG) + 10, 1, 18 + (i % 3) * 3);
        if (minDistToRoad(p.x, p.z) < half + 12) continue;
        const c = crateColors[i % crateColors.length];
        for (let s = 0; s < 1 + (i % 3); s++) {
          worldRoot.addChild(prim(app, 'box', 'crate', c, p.x, 1.15 + s * 2.2, p.z, 4.4, 2.15, 2.3));
        }
      }
      const lampStep = android ? 26 : 22;
      for (let i = 0; i < SEG; i += lampStep) {
        [1, -1].forEach((side) => {
          const p = along(i, side, 5.8);
          worldRoot.addChild(prim(app, 'cylinder', 'lamp', lamp, p.x, 3.15, p.z, 0.16, 6.3, 0.16, false));
          worldRoot.addChild(prim(app, 'sphere', 'bulb', bulb, p.x, 6.4, p.z, 0.32, 0.32, 0.32, false));
        });
      }
    } else if (theme === 'f1') {
      const n = android ? 10 : 12;
      for (let i = 0; i < n; i++) {
        const p = along(18 + i * Math.floor(SEG / n), i % 2 ? 1 : -1, 15);
        if (minDistToRoad(p.x, p.z) < ROAD_W / 2 + 10) continue;
        worldRoot.addChild(prim(app, 'box', 'stand', steel, p.x, 3.6, p.z, 16, 7.2, 7));
        worldRoot.addChild(prim(app, 'box', 'seats', red, p.x, 4.4, p.z, 14.5, 4.4, 5.4, false));
      }
    } else if (theme === 'snow') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = Math.cos(a) * 120, z = Math.sin(a) * 120;
        if (minDistToRoad(x, z) < 36) continue;
        worldRoot.addChild(prim(app, 'sphere', 'drift', snow, x, 1.2, z, 20, 6, 16, false));
      }
    }

    if (theme === 'city' || theme === 'f1') {
      const railStep = android ? 6 : 4;
      for (let i = 0; i < SEG; i += railStep) {
        [1, -1].forEach((side) => {
          const p = along(i, side, half + 5.5);
          worldRoot.addChild(prim(app, 'box', 'barrier', barrierMat, p.x, 0.48, p.z, 1.35, 0.95, 2.4, false));
        });
      }
    }

    const s0 = samples[0];
    worldRoot.addChild(prim(app, 'box', 'postL', steel, s0.p.x + s0.nrm.x * (half + 3), 4.2, s0.p.z + s0.nrm.z * (half + 3), 0.45, 8.4, 0.45, false));
    worldRoot.addChild(prim(app, 'box', 'postR', steel, s0.p.x - s0.nrm.x * (half + 3), 4.2, s0.p.z - s0.nrm.z * (half + 3), 0.45, 8.4, 0.45, false));
    addObstacle(s0.p.x + s0.nrm.x * (half + 3), s0.p.z + s0.nrm.z * (half + 3), 1.2, 1.2);
    addObstacle(s0.p.x - s0.nrm.x * (half + 3), s0.p.z - s0.nrm.z * (half + 3), 1.2, 1.2);
    worldRoot.addChild(prim(app, 'box', 'gantry', red, s0.p.x, 8.5, s0.p.z, ROAD_W + 7, 0.7, 0.7, false));

    if (theme === 'city' || theme === 'golf' || theme === 'f1') spawnWalkers();
    updateWalkers(0);
  }

  function paintRouteMaps(): void {
    document.querySelectorAll('#trackGrid .carChoice').forEach((choice) => {
      const id = (choice as HTMLElement).dataset.track as TrackId;
      const track = TRACKS[id];
      if (!track) return;
      const preview = choice.querySelector('.trackPreview') as HTMLElement | null;
      if (!preview) return;
      let canvas = preview.querySelector('canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 100;
        preview.insertBefore(canvas, preview.firstChild);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pts = TRACK_LAYOUTS[track.layout].pts;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      pts.forEach(([x, , z]) => {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      });
      const pad = 14;
      const sx = (canvas.width - pad * 2) / Math.max(1, maxX - minX);
      const sz = (canvas.height - pad * 2) / Math.max(1, maxZ - minZ);
      const s = Math.min(sx, sz);
      const ox = (canvas.width - (maxX - minX) * s) / 2;
      const oz = (canvas.height - (maxZ - minZ) * s) / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,224,120,0.95)';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(255,176,32,0.45)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      pts.forEach(([x, , z], i) => {
        const px = ox + (x - minX) * s;
        const py = oz + (z - minZ) * s;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
      const start = pts[0];
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(ox + (start[0] - minX) * s, oz + (start[2] - minZ) * s, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function spawnCar(color: [number, number, number]): Entity {
    const cached = carCache.get(carConfig.model);
    const resource = cached?.resource as { instantiateRenderEntity?: () => Entity } | undefined;
    if (resource?.instantiateRenderEntity) {
      try {
        const entity = resource.instantiateRenderEntity();
        tintMaterials(entity, color, true);
        entity.setLocalScale(1.85, 1.85, 1.85);
        app.root.addChild(entity);
        return entity;
      } catch { /* use mesh car */ }
    }
    const entity = buildFallbackCar(app, color);
    app.root.addChild(entity);
    return entity;
  }

  function setupRace(): void {
    allCars.forEach((c) => c.entity.destroy());
    const s0 = samples[0];
    player = new Racer(spawnCar(carConfig.color), true, carConfig, -ROAD_W * 0.22, s0);
    const lite = android || quality === 'low';
    const lanes = lite
      ? [0, ROAD_W * 0.26, -ROAD_W * 0.26]
      : [0, ROAD_W * 0.26, -ROAD_W * 0.26, ROAD_W * 0.16, -ROAD_W * 0.16, ROAD_W * 0.08];
    const pace = lite ? [0.82, 0.9, 0.96] : [0.8, 0.85, 0.89, 0.93, 0.96, 0.99];
    aiCars = lanes.map((lane, idx) => {
      const cfg = { ...carConfig, color: AI_COLORS[idx] };
      const racer = new Racer(spawnCar(AI_COLORS[idx]), false, cfg, lane, s0);
      racer.aiBaseSpeed = racer.maxSpeed * pace[idx];
      const startGap = 22 + idx * 16;
      const p = racer.pos;
      racer.entity.setPosition(p.x + s0.tan.x * startGap, 0, p.z + s0.tan.z * startGap);
      racer._t = startGap / TRACK_LEN;
      racer.trackDistance = startGap;
      racer.distance = startGap;
      const found = findNearest(racer.pos, 0);
      racer.sampleIndex = found.index;
      racer.prevSampleIndex = found.index;
      return racer;
    });
    const back = 10;
    const pp = player.pos;
    player.entity.setPosition(pp.x - s0.tan.x * back, 0, pp.z - s0.tan.z * back);
    player.trackDistance = -back;
    player.distance = -back;
    allCars = [player, ...aiCars];
    raceTime = 0;
    raceRewardGranted = false;
    steerSmooth = 0;
    hudSpeedSmooth = 0;
    physAccum = 0;
    $('lapVal').textContent = `1/${TOTAL_LAPS}`;
    $('speedVal').textContent = '0';
  }

  function prepareSelectedTrack(): void {
    const t = TRACKS[selectedTrack];
    TOTAL_LAPS = t.laps;
    rebuildSamples(t.layout);
    buildWorld(t.theme);
  }

  function updatePlayer(dt: number): void {
    const forward = keys.w || keys.arrowup || touchState.gas;
    const back = keys.s || keys.arrowdown || touchState.brake;
    const left = keys.a || keys.arrowleft;
    const right = keys.d || keys.arrowright;
    const cap = carConfig.maxSpeed || MAX_SPEED;
    const speedAbs = Math.abs(player.speed);
    const speedFactor = clamp(speedAbs / cap, 0, 1);

    if (forward) {
      // Stronger pull at low speed, fades near top — gradual real-car feel.
      const pull = 0.28 + (1 - speedFactor) * (1 - speedFactor) * 0.95;
      player.speed += ACCEL * pull * dt;
    } else if (back) {
      if (player.speed > 0.35) player.speed -= BRAKE * dt;
      else player.speed -= ACCEL * 0.35 * dt;
    } else if (player.speed > 0) player.speed = Math.max(0, player.speed - FRICTION * dt);
    else if (player.speed < 0) player.speed = Math.min(0, player.speed + FRICTION * dt);

    const steerInput = clamp((left ? 1 : 0) - (right ? 1 : 0) + touchState.steer, -1, 1);
    steerSmooth += (steerInput - steerSmooth) * Math.min(1, STEER_RESPONSE * dt);

    // Turning bleeds speed (more at high speed / hard lock).
    const turnLoad = Math.abs(steerSmooth) * speedFactor;
    if (player.speed > 0.5) {
      player.speed -= turnLoad * turnLoad * CORNER_DRAG * dt;
    }

    player.speed = clamp(player.speed, -cap * 0.28, cap);
    // High-speed steering tightens — less twitchy on phone.
    const steerGain = (1.05 - speedFactor * 0.55) * (0.55 + (1 - Math.abs(steerSmooth) * 0.2));
    player.angle += steerSmooth * TURN_RATE * steerGain * dt * Math.sign(player.speed || 1);
    const p = player.pos;
    player.entity.setPosition(
      p.x + Math.sin(player.angle) * player.speed * dt,
      0,
      p.z + Math.cos(player.angle) * player.speed * dt
    );
    player.entity.setEulerAngles(0, player.angle * 180 / Math.PI + 180, 0);
    const found = findNearest(player.pos, player.sampleIndex);
    player.sampleIndex = found.index;
    updateLapProgress(player, dt);
  }

  function updateAI(car: Racer, dt: number): void {
    const gap = (player.trackDistance ?? 0) - (car.trackDistance ?? 0);
    const rubberBand = clamp(gap * 0.003, -0.9, 1.2);
    const blocker = allCars
      .filter((other) => other !== car && (other.trackDistance ?? 0) > (car.trackDistance ?? 0) && (other.trackDistance ?? 0) - (car.trackDistance ?? 0) < 24)
      .sort((a, b) => (a.trackDistance ?? 0) - (b.trackDistance ?? 0))[0];
    const overtaking = Boolean(blocker);
    const targetSpeed = clamp(car.aiBaseSpeed + rubberBand + (overtaking ? Math.min(5.2, car.maxSpeed * 0.16) : 0), 0, car.maxSpeed);
    car.speed = damp(car.speed, targetSpeed, targetSpeed > car.speed ? 2.6 : 5, dt);
    if (!car.finished) car.trackDistance = (car.trackDistance ?? 0) + car.speed * dt;
    const progressOnLap = ((car.trackDistance % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
    car._t = progressOnLap / TRACK_LEN;
    const p = curve.getPointAt(car._t);
    const tan = curve.getTangentAt(car._t);
    const nrm = { x: -tan.z, y: 0, z: tan.x };
    const laneWave = android ? 0 : Math.sin(raceTime * 0.72 + car.aiOffsetSeed) * 0.85;
    const passOffset = overtaking ? car.aiPassSide * (android ? 3.2 : 4.2 + Math.sin(raceTime * 1.1 + car.aiOffsetSeed) * 0.45) : 0;
    car.aiTargetLane = clamp(car.aiLane + laneWave + passOffset, -ROAD_W / 2 + 3.2, ROAD_W / 2 - 3.2);
    car.aiRenderLane = damp(car.aiRenderLane, car.aiTargetLane, android ? 12 : 5.5, dt);
    const dest = addScaled(p, nrm, car.aiRenderLane);
    const cur = car.pos;
    const dx = dest.x - cur.x, dz = dest.z - cur.z;
    const planar = Math.hypot(dx, dz);
    if (android) {
      // Snap AI to track path — soft catch-up made rivals look laggy vs the road.
      car.entity.setPosition(dest.x, 0, dest.z);
    } else {
      const maxStep = Math.max(0.9, car.speed * dt * 1.25);
      if (planar > maxStep) {
        car.entity.setPosition(cur.x + dx * maxStep / planar, 0, cur.z + dz * maxStep / planar);
      } else {
        const a = 1 - Math.exp(-8 * dt);
        car.entity.setPosition(cur.x + dx * a, 0, cur.z + dz * a);
      }
    }
    const ang = Math.atan2(tan.x, tan.z);
    car.angle = android ? ang : dampAngle(car.angle, ang, 9, dt);
    car.entity.setEulerAngles(0, car.angle * 180 / Math.PI + 180, 0);
    const found = findNearest(car.pos, car.sampleIndex);
    car.sampleIndex = found.index;
    updateLapProgress(car, dt);
  }

  function updateLapProgress(car: Racer, dt: number): void {
    const found = findNearest(car.pos, car.sampleIndex);
    const cur = found.index;
    const prev = car.prevSampleIndex;
    const along = samples[cur].t * TRACK_LEN;
    const crossed = prev > SEG * 0.78 && cur < SEG * 0.22;
    if (crossed && !car.finished && (car.isPlayer ? car.speed > 1.5 : true)) {
      const minProgress = (car.lap - 1) * TRACK_LEN + TRACK_LEN * 0.55;
      if ((car.trackDistance ?? 0) >= minProgress) {
        car.lap += 1;
        if (car.isPlayer) $('lapVal').textContent = `${Math.min(car.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;
        if (car.lap > TOTAL_LAPS) {
          car.finished = true;
          car.finishTime = raceTime;
          car.lap = TOTAL_LAPS + 1;
        }
      }
    }
    car.sampleIndex = cur;
    car.prevSampleIndex = cur;
    if (car.isPlayer) {
      let candidate = car.finished ? TOTAL_LAPS * TRACK_LEN : (car.lap - 1) * TRACK_LEN + along;
      if (car.trackDistance != null && !car.finished) {
        const delta = candidate - car.trackDistance;
        if (delta < -TRACK_LEN * 0.15) candidate = car.trackDistance;
        if (delta > TRACK_LEN * 0.5) candidate = car.trackDistance + Math.min(delta, car.speed * dt * 2);
      }
      car.trackDistance = candidate;
    } else if (car.finished) {
      car.trackDistance = TOTAL_LAPS * TRACK_LEN;
    } else if (car.trackDistance >= TOTAL_LAPS * TRACK_LEN) {
      car.finished = true;
      car.finishTime = raceTime;
      car.lap = TOTAL_LAPS + 1;
      car.trackDistance = TOTAL_LAPS * TRACK_LEN;
    }
    car.distance = car.trackDistance ?? 0;
  }

  function clampToFence(car: Racer, speedMultiplier = 0.6): void {
    const found = findNearest(car.pos, car.sampleIndex);
    if (Math.sqrt(found.distSq) > FENCE_LIMIT) {
      const s = samples[found.index];
      const p = car.pos;
      const toCar = { x: p.x - s.p.x, y: 0, z: p.z - s.p.z };
      const lateral = toCar.x * s.nrm.x + toCar.z * s.nrm.z;
      const sign = Math.sign(lateral || 1);
      const along = toCar.x * s.tan.x + toCar.z * s.tan.z;
      const clamped = addScaled(addScaled(s.p, s.nrm, sign * FENCE_LIMIT), s.tan, along);
      car.entity.setPosition(clamped.x, 0, clamped.z);
      car.speed *= speedMultiplier;
    }
  }

  function placeOnTrack(car: Racer, sampleIndex: number, lane: number, speed: number): void {
    const s = samples[((sampleIndex % SEG) + SEG) % SEG];
    const pos = addScaled(s.p, s.nrm, lane);
    car.entity.setPosition(pos.x, 0, pos.z);
    car.angle = Math.atan2(s.tan.x, s.tan.z);
    car.entity.setEulerAngles(0, car.angle * 180 / Math.PI + 180, 0);
    car.speed = speed;
    car.sampleIndex = sampleIndex;
    car.prevSampleIndex = sampleIndex;
    car.crashCooldown = 0.7;
    const along = s.t * TRACK_LEN;
    if (!car.finished) {
      const lapBase = Math.max(0, car.lap - 1) * TRACK_LEN;
      car.trackDistance = lapBase + along;
      car.distance = car.trackDistance;
      car._t = s.t;
    }
  }

  function restartPair(a: Racer, b: Racer): void {
    const mid = { x: (a.pos.x + b.pos.x) * 0.5, z: (a.pos.z + b.pos.z) * 0.5 };
    const found = findNearest(mid, a.sampleIndex);
    const restartSpeed = Math.min(a.maxSpeed, b.maxSpeed) * 0.28;
    placeOnTrack(a, found.index, -2.1, restartSpeed);
    placeOnTrack(b, found.index, 2.1, restartSpeed);
    rearView = false;
    if (a.isPlayer || b.isPlayer) snapChaseCamera();
  }

  function resolveCollisions(): void {
    const minDist = 2.7;
    for (let i = 0; i < allCars.length; i++) {
      for (let j = i + 1; j < allCars.length; j++) {
        const a = allCars[i], b = allCars[j];
        if (a.crashCooldown > 0 || b.crashCooldown > 0) continue;
        const pa = a.pos, pb = b.pos;
        const dx = pb.x - pa.x, dz = pb.z - pa.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < minDist * minDist && distSq > 0.0001) {
          restartPair(a, b);
        }
      }
    }
  }

  function computeRanking(): Racer[] {
    return [...allCars].sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime || 0) - (b.finishTime || 0);
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return (b.trackDistance ?? 0) - (a.trackDistance ?? 0);
    });
  }

  const camTarget = new Vec3();
  function updateCamera(dt: number, speedFactor: number): void {
    const dirx = Math.sin(player.angle), dirz = Math.cos(player.angle);
    const sidex = Math.cos(player.angle), sidez = -Math.sin(player.angle);
    const p = player.pos;
    let dx: number, dy: number, dz: number;
    if (rearView) {
      dx = p.x + dirx * 2.0 - sidex * steerSmooth * 0.35;
      dz = p.z + dirz * 2.0 - sidez * steerSmooth * 0.35;
      dy = 1.9;
      camTarget.set(p.x - dirx * 7, 0.75, p.z - dirz * 7);
    } else if (android) {
      // Hard-lock: any camera lag makes the road/props look stuttery.
      const back = 4.35;
      dx = p.x + dirx * (-back);
      dz = p.z + dirz * (-back);
      dy = 1.95;
      camTarget.set(p.x + dirx * 3.1, 0.72, p.z + dirz * 3.1);
    } else {
      const cameraSide = steerSmooth * 0.4;
      const back = 4.6 + speedFactor * 0.2;
      dx = p.x + dirx * (-back) + sidex * cameraSide;
      dz = p.z + dirz * (-back) + sidez * cameraSide;
      dy = 1.85 + speedFactor * 0.06;
      camTarget.set(p.x + dirx * 3.2 + sidex * steerSmooth * 0.28, 0.7, p.z + dirz * 3.2 + sidez * steerSmooth * 0.28);
    }

    if (android && !rearView) {
      camera.setPosition(dx, dy, dz);
      // Match car facing: angle 0 travels +Z; camera default looks -Z so add 180.
      camera.setEulerAngles(12, player.angle * 180 / Math.PI + 180, 0);
    } else {
      const cur = camera.getPosition();
      const jump = Math.hypot(dx - cur.x, dy - cur.y, dz - cur.z) > 28;
      const a = jump ? 1 : 1 - Math.exp(-10 * dt);
      camera.setPosition(cur.x + (dx - cur.x) * a, cur.y + (dy - cur.y) * a, cur.z + (dz - cur.z) * a);
      camera.lookAt(camTarget);
    }

    const cam = camera.camera!;
    if (android) cam.fov = BASE_FOV;
    else {
      const targetFov = BASE_FOV + speedFactor * 2;
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 2.2);
    }
  }

  function snapChaseCamera(): void {
    if (!player) return;
    updateCamera(1, 0);
    app.resizeCanvas();
  }

  function displayName(): string {
    return playerName.trim() || 'RACER';
  }

  function applyPlayerNameEverywhere(): void {
    const name = displayName();
    const welcome = document.getElementById('introWelcome');
    if (welcome) {
      welcome.textContent = playerName
        ? `Welcome back, ${name}. Tap START to race.`
        : 'Tap START, enter your name, then pick a machine and circuit.';
    }
    const input = document.getElementById('playerNameInput') as HTMLInputElement | null;
    if (input && playerName && document.activeElement !== input) input.value = playerName;
    const settingsName = document.getElementById('settingsDriverName');
    if (settingsName) settingsName.textContent = name;
    const historyDriver = document.getElementById('historyDriver');
    if (historyDriver) historyDriver.textContent = `Driver: ${name}`;
    const brand = document.querySelector('.hud .brand');
    if (brand) brand.innerHTML = `FORZA <span>LEGENDS</span><small class="driverTag">${name}</small>`;
  }

  function openNameSlide(opts?: { forChange?: boolean }): void {
    const slide = document.getElementById('nameSlide');
    const input = document.getElementById('playerNameInput') as HTMLInputElement | null;
    const err = document.getElementById('nameError');
    if (err) err.hidden = true;
    if (input) {
      input.value = playerName || '';
      window.setTimeout(() => input.focus(), 280);
    }
    slide?.classList.add('show');
    slide?.setAttribute('aria-hidden', 'false');
    slide?.setAttribute('data-mode', opts?.forChange ? 'change' : 'start');
  }

  function closeNameSlide(): void {
    const slide = document.getElementById('nameSlide');
    slide?.classList.remove('show');
    slide?.setAttribute('aria-hidden', 'true');
    const input = document.getElementById('playerNameInput') as HTMLInputElement | null;
    input?.blur();
  }

  function enterGarageFromIntro(): void {
    closeNameSlide();
    document.getElementById('introScreen')?.classList.add('hidden');
    document.getElementById('splashScreen')?.classList.add('hidden');
    $('garageOverlay').style.display = 'flex';
    setBanner('menu');
    updateGarageText();
  }

  function renderRaceHistory(): void {
    const list = document.getElementById('historyList');
    if (!list) return;
    const entries = loadRaceHistory();
    list.innerHTML = '';
    if (!entries.length) {
      list.innerHTML = '<div class="historyEmpty">No races yet. Finish a race to build your history.</div>';
      return;
    }
    entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'historyRow';
      const when = new Date(e.at);
      const date = Number.isFinite(when.getTime())
        ? when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : '';
      row.innerHTML = `<div><strong>${e.name}</strong>${ordinal(e.place)} · ${e.track}<br><small style="color:#7c8896">${e.car} · +${e.reward} coins</small></div><span>${fmtTime(e.time)}<br>${date}</span>`;
      list.appendChild(row);
    });
  }

  function openHistoryPanel(): void {
    applyPlayerNameEverywhere();
    renderRaceHistory();
    document.getElementById('historyPanel')?.classList.add('open');
  }

  function closeHistoryPanel(): void {
    document.getElementById('historyPanel')?.classList.remove('open');
  }

  function commitPlayerName(raw: string): boolean {
    const clean = raw.trim().replace(/\s+/g, ' ').slice(0, 16);
    const err = document.getElementById('nameError');
    if (clean.length < 2) {
      if (err) err.hidden = false;
      return false;
    }
    if (err) err.hidden = true;
    playerName = clean;
    savePlayerName(playerName);
    applyPlayerNameEverywhere();
    updateGarageText();
    updateTrackText();
    return true;
  }

  function updateCoinsUI(): void {
    ['coinsVal', 'garageCoinsVal', 'trackCoinsVal', 'storeCoinsVal'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(playerCoins);
    });
  }

  function updateGarageText(): void {
    const selected = GARAGE_CARS[selectedGarageCar];
    const hint = document.querySelector('#garageOverlay .garageHint');
    if (hint) hint.innerHTML = `Driver: <b>${displayName()}</b><br>Selected: <b id="selectedCarName">${selected.name}</b><br>Balance: <b id="garageCoinsVal">${playerCoins}</b> coins`;
  }

  function updateTrackText(): void {
    const t = TRACKS[selectedTrack];
    const hint = document.querySelector('#trackOverlay .garageHint');
    if (hint) hint.innerHTML = `Driver: <b>${displayName()}</b><br>Selected: <b id="selectedTrackName">${t.name}</b><br>Balance: <b id="trackCoinsVal">${playerCoins}</b> coins`;
    const sub = document.getElementById('startSubtitle');
    if (sub) sub.textContent = t.subtitle;
  }

  function updateStoreUI(): void {
    updateCoinsUI();
    const btn = document.getElementById('buyRemoveAdsBtn');
    if (btn) btn.textContent = removeAds ? '✓ ADS REMOVED' : 'REMOVE ADS';
    const d = document.getElementById('dailyRewardBtn') as HTMLButtonElement | null;
    const t = document.getElementById('dailyRewardText');
    const today = new Date().toISOString().slice(0, 10);
    let claimed = false;
    try { claimed = localStorage.getItem(DAILY_KEY) === today; } catch { /* ignore */ }
    if (d) { d.disabled = claimed; d.style.opacity = claimed ? '0.5' : '1'; d.textContent = claimed ? '✓ CLAIMED TODAY' : 'CLAIM +100'; }
    if (t) t.textContent = claimed ? 'Come back tomorrow for another 100 coins.' : 'Claim 100 coins today.';
  }

  function refreshLocks(): void {
    document.querySelectorAll('#garageGrid .carChoice').forEach((choice) => {
      const id = (choice as HTMLElement).dataset.car as CarId;
      const owned = ownedCars.has(id);
      choice.classList.toggle('locked', !owned);
      const badge = choice.querySelector('.carCoins') as HTMLElement | null;
      if (badge) badge.style.display = owned ? 'none' : '';
    });
    document.querySelectorAll('#trackGrid .carChoice').forEach((choice) => {
      const id = (choice as HTMLElement).dataset.track as TrackId;
      const owned = ownedTracks.has(id);
      choice.classList.toggle('locked', !owned);
      const badge = choice.querySelector('.carCoins') as HTMLElement | null;
      if (badge) badge.style.display = owned ? 'none' : '';
    });
  }

  async function tryUnlockCar(id: CarId): Promise<boolean> {
    if (ownedCars.has(id)) return true;
    const car = GARAGE_CARS[id];
    if (playerCoins < car.coins) {
      await themedConfirm('NOT ENOUGH COINS', `Need ${car.coins} coins to unlock ${car.name}.\n\nYour balance: ${playerCoins} coins`, { cancel: false });
      return false;
    }
    const ok = await themedConfirm('UNLOCK MACHINE', `Unlock ${car.name} for ${car.coins} coins?\n\nYour balance: ${playerCoins} coins`);
    if (!ok) return false;
    playerCoins -= car.coins;
    ownedCars.add(id);
    saveCoins(playerCoins);
    saveSet(OWNED_CARS_KEY, ownedCars);
    updateCoinsUI();
    updateGarageText();
    refreshLocks();
    return true;
  }

  async function tryUnlockTrack(id: TrackId): Promise<boolean> {
    if (ownedTracks.has(id)) return true;
    const track = TRACKS[id];
    if (playerCoins < track.coins) {
      await themedConfirm('NOT ENOUGH COINS', `Need ${track.coins} coins to unlock ${track.name}.\n\nYour balance: ${playerCoins} coins`, { cancel: false });
      return false;
    }
    if (track.coins > 0) {
      const ok = await themedConfirm('UNLOCK CIRCUIT', `Unlock ${track.name} for ${track.coins} coins?\n\nYour balance: ${playerCoins} coins`);
      if (!ok) return false;
    }
    playerCoins -= track.coins;
    ownedTracks.add(id);
    saveCoins(playerCoins);
    saveSet(OWNED_TRACKS_KEY, ownedTracks);
    updateCoinsUI();
    updateTrackText();
    refreshLocks();
    return true;
  }

  function setBanner(mode: 'hidden' | 'menu' | 'race'): void {
    const raceAd = document.getElementById('raceAdBanner');
    // Browser preview: show compact bottom-center test ad during race.
    // On Android, native AdMob banner occupies that same spot.
    if (raceAd) {
      const showWebAd = mode === 'race' && !removeAds && !nativeBridge();
      raceAd.classList.toggle('show', showWebAd);
      raceAd.setAttribute('aria-hidden', showWebAd ? 'false' : 'true');
    }
    nativeCall('setBannerPlacement', removeAds ? 'hidden' : mode);
  }

  function updateCardAdLabels(): void {
    const watched = 5 - watchAdsRemaining;
    const label = watchAdsRemaining > 0
      ? `Ad ${Math.min(5, watched + 1)}/5 · +${watchAdsEarned} coins`
      : 'See 5 Ads and win 500 coins';
    document.querySelectorAll('.cardAdBtn').forEach((el) => {
      el.textContent = label;
    });
  }

  function grantWatchAdReward(): void {
    playerCoins += 100;
    saveCoins(playerCoins);
    updateCoinsUI();
    updateStoreUI();
    updateGarageText();
    updateTrackText();
    if (watchAdsRemaining > 0) {
      watchAdsEarned += 100;
      watchAdsRemaining -= 1;
      watchAdJustRewarded = true;
      updateCardAdLabels();
    }
  }

  function setAdStatus(msg: string): void {
    const status = document.getElementById('nativeStatus');
    if (status) status.textContent = msg;
  }

  function closeTestAdOverlay(): void {
    if (testAdTimer) {
      window.clearInterval(testAdTimer);
      testAdTimer = null;
    }
    const overlay = document.getElementById('testAdOverlay');
    overlay?.classList.remove('show');
    overlay?.setAttribute('aria-hidden', 'true');
    const btn = document.getElementById('testAdCloseBtn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'CLAIM REWARD';
    }
  }

  /** Browser / no-native fallback: force a visible countdown "test ad". */
  function showWebTestRewardedAd(): void {
    const overlay = document.getElementById('testAdOverlay');
    const timerEl = document.getElementById('testAdTimer');
    const btn = document.getElementById('testAdCloseBtn') as HTMLButtonElement | null;
    const title = document.getElementById('testAdTitle');
    const body = document.getElementById('testAdBody');
    if (!overlay || !timerEl || !btn) {
      setAdStatus('Test ad UI missing — cannot grant coins without watching an ad.');
      watchAdAwaiting = false;
      return;
    }
    if (title) title.textContent = watchAdsRemaining > 0
      ? `Test Ad ${6 - watchAdsRemaining}/5`
      : 'Test Rewarded Ad';
    if (body) body.textContent = 'This is a Google Ads test placeholder. Watch the timer, then claim.';
    btn.disabled = true;
    btn.textContent = 'WAIT…';
    let left = 5;
    timerEl.textContent = String(left);
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    if (testAdTimer) window.clearInterval(testAdTimer);
    testAdTimer = window.setInterval(() => {
      left -= 1;
      timerEl.textContent = String(Math.max(0, left));
      if (left <= 0) {
        if (testAdTimer) window.clearInterval(testAdTimer);
        testAdTimer = null;
        btn.disabled = false;
        btn.textContent = 'CLAIM REWARD';
      }
    }, 1000);
  }

  function requestNextWatchAd(): void {
    if (watchAdsRemaining <= 0) {
      watchAdAwaiting = false;
      updateCardAdLabels();
      return;
    }
    if (watchAdAwaiting) return;
    watchAdAwaiting = true;
    watchAdJustRewarded = false;
    updateCardAdLabels();
    setAdStatus(`Loading rewarded test ad (${6 - watchAdsRemaining}/5)…`);
    const shown = nativeCall('showRewardedAd');
    if (!shown) {
      // No Android bridge — show on-screen test ad (never auto-grant).
      showWebTestRewardedAd();
    }
  }

  function startWatchAdsSession(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    if (watchAdsRemaining > 0 || watchAdAwaiting || singleRewardPending) return;
    watchAdsRemaining = 5;
    watchAdsEarned = 0;
    watchAdJustRewarded = false;
    singleRewardPending = false;
    requestNextWatchAd();
  }

  function startSingleRewardAd(): void {
    if (watchAdsRemaining > 0 || watchAdAwaiting || singleRewardPending) return;
    singleRewardPending = true;
    watchAdJustRewarded = false;
    watchAdAwaiting = true;
    setAdStatus('Loading rewarded test ad…');
    const shown = nativeCall('showRewardedAd');
    if (!shown) showWebTestRewardedAd();
  }

  function maybeShowInterstitial(): void {
    if (!removeAds) nativeCall('showInterstitialAd');
  }

  function updatePauseStatus(): void {
    const el = document.getElementById('pauseStatus');
    if (!el) return;
    if (settingsOpen && raceState === 'racing') { el.textContent = 'PAUSED'; el.style.color = 'var(--accent2)'; }
    else if (raceState === 'racing') { el.textContent = 'RUNNING'; el.style.color = 'var(--good)'; }
    else if (raceState === 'countdown') { el.textContent = 'COUNTDOWN'; el.style.color = 'var(--accent2)'; }
    else if (raceState === 'finished') { el.textContent = 'FINISHED'; el.style.color = 'var(--dim)'; }
    else { el.textContent = 'MENU'; el.style.color = 'var(--dim)'; }
  }

  function showCountdown(): void {
    raceState = 'countdown';
    setBanner('race');
    snapChaseCamera();
    drawMinimap();
    updatePauseStatus();
    let n = 3;
    const msg = $('msgCenter');
    msg.innerHTML = `<div class="countdown">${n}</div>`;
    countdownTimer = window.setInterval(() => {
      n--;
      if (n > 0) msg.innerHTML = `<div class="countdown">${n}</div>`;
      else {
        msg.innerHTML = `<div class="gotext">GO!</div>`;
        setTimeout(() => { msg.innerHTML = ''; }, 700);
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = null;
        raceState = 'racing';
        updatePauseStatus();
      }
    }, 800);
  }

  function endRace(): void {
    raceState = 'finished';
    const ranking = computeRanking();
    const playerRank = ranking.indexOf(player) + 1;
    const firstGrant = !raceRewardGranted;
    const reward = firstGrant ? (REWARD_BY_PLACE[playerRank] || 0) : 0;
    if (firstGrant && reward > 0) {
      playerCoins += reward;
      saveCoins(playerCoins);
    }
    raceRewardGranted = true;
    const list = $('resultsList');
    list.innerHTML = '';
    ranking.forEach((c, idx) => {
      const row = document.createElement('div');
      if (c.isPlayer) row.className = 'you';
      const label = c.isPlayer ? displayName() : `RIVAL ${aiCars.indexOf(c) + 1}`;
      row.innerHTML = `<span>${ordinal(idx + 1)} — ${label}</span><span>${c.finishTime ? fmtTime(c.finishTime) : '—'}</span>`;
      list.appendChild(row);
    });
    if (firstGrant) {
      pushRaceHistory({
        name: displayName(),
        place: playerRank,
        time: player.finishTime || raceTime,
        track: TRACKS[selectedTrack].name,
        car: carConfig.name,
        reward,
        at: Date.now()
      });
    }
    updateCoinsUI();
    $('finishTitle').innerHTML = ranking[0].isPlayer ? 'VICTORY <span>LAP</span>' : 'RACE <span>COMPLETE</span>';
    $('finishSubtitle').textContent = `${displayName()} finished ${ordinal(playerRank)} · ${TRACKS[selectedTrack].name}`;
    $('rewardText').innerHTML = `+${reward} COINS<small>${displayName()} · Total coins: ${playerCoins}</small>`;
    $('finishOverlay').style.display = 'flex';
    setBanner('hidden');
    updateStoreUI();
    updatePauseStatus();
    window.setTimeout(() => maybeShowInterstitial(), 1800);
  }

  function goToMenu(): void {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    $('msgCenter').innerHTML = '';
    settingsOpen = false;
    $('settingsPanel').classList.remove('open');
    $('finishOverlay').style.display = 'none';
    $('startOverlay').style.display = 'none';
    $('trackOverlay').style.display = 'none';
    $('garageOverlay').style.display = 'flex';
    raceState = 'idle';
    setBanner('menu');
    updatePauseStatus();
  }

  function drawMinimap(): void {
    const mm = document.getElementById('minimap') as HTMLCanvasElement;
    const ctx = mm.getContext('2d');
    if (!ctx || !samples.length) return;
    const size = 150;
    ctx.clearRect(0, 0, size, size);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i].p;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxZ - minZ);
    // Keep the route clearly smaller than the box (padding ~22%).
    const inset = size * 0.22;
    const scale = Math.min((size - inset * 2) / worldW, (size - inset * 2) / worldH);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const toX = (x: number) => size * 0.5 + (x - cx) * scale;
    const toY = (z: number) => size * 0.5 + (z - cz) * scale;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= SEG; i++) {
      const p = samples[i % samples.length].p;
      const x = toX(p.x), y = toY(p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    allCars.forEach((c) => {
      ctx.fillStyle = c.isPlayer ? '#ff3b30' : '#ffd23f';
      ctx.beginPath();
      ctx.arc(toX(c.pos.x), toY(c.pos.z), c.isPlayer ? 3.2 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function updateHud(dt: number): void {
    const kmh = Math.abs(player.speed) * SPEED_TO_KMH;
    hudSpeedSmooth += (kmh - hudSpeedSmooth) * Math.min(1, dt * 7);
    $('speedVal').textContent = String(Math.round(hudSpeedSmooth));
    const cap = carConfig.maxSpeed || MAX_SPEED;
    const tach = document.getElementById('tachFill');
    if (tach) (tach as HTMLElement).style.width = `${(1 - Math.abs(player.speed) / cap) * 100}%`;

    hudAccum += dt;
    if (hudAccum < 0.08) return;
    hudAccum = 0;
    const ranking = computeRanking();
    const place = ranking.indexOf(player) + 1;
    const placeEl = document.getElementById('placeVal');
    const ordEl = document.getElementById('placeOrd');
    if (placeEl) placeEl.textContent = String(place);
    if (ordEl) ordEl.textContent = ordinal(place).replace(/[0-9]/g, '');
    $('timeVal').textContent = fmtTime(raceTime);
    drawMinimap();
  }

  function applyQuality(level: Quality): void {
    quality = level;
    engine.quality = level;
    const dpr = window.devicePixelRatio || 1;
    // Android smoothness: keep pixel ratio modest so frames stay steady.
    app.graphicsDevice.maxPixelRatio = android
      ? (level === 'low' ? Math.min(dpr, 1) : level === 'medium' ? Math.min(dpr, 1.2) : Math.min(dpr, 1.35))
      : (level === 'low' ? Math.min(dpr, 1.25) : level === 'medium' ? Math.min(dpr, 1.75) : Math.min(dpr, 2));
    document.getElementById('colorGrade')?.classList.toggle('lite', android);
    if (sun.light) {
      // Shadows hitch hard on phones — keep them off on Android.
      sun.light.castShadows = android ? false : level !== 'low';
      sun.light.shadowResolution = level === 'high' ? 2048 : level === 'medium' ? 1024 : 512;
      sun.light.shadowDistance = android ? 90 : 160;
    }
    if (engine.cameraFrame) applyCameraFrame(engine.cameraFrame, level, android);
    app.resizeCanvas();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ graphics: level, fps: targetFPS, muted: soundMuted })); } catch { /* ignore */ }
  }

  function bindInput(): void {
    const controlKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright']);
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'b') { e.preventDefault(); rearView = true; $('rearViewIndicator').style.display = 'block'; return; }
      if (controlKeys.has(key)) { e.preventDefault(); keys[key] = true; }
    });
    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'b') { e.preventDefault(); rearView = false; $('rearViewIndicator').style.display = 'none'; return; }
      if (controlKeys.has(key)) { e.preventDefault(); keys[key] = false; }
    });
    const bindTouch = (id: string, stateKey: 'gas' | 'brake') => {
      const el = $(id);
      const setPressed = (pressed: boolean, e?: Event) => {
        e?.preventDefault();
        touchState[stateKey] = pressed;
        el.classList.toggle('pressed', pressed);
      };
      el.addEventListener('pointerdown', (e) => setPressed(true, e));
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
        el.addEventListener(type, (e) => setPressed(false, e));
      });
    };
    bindTouch('btnGas', 'gas');
    bindTouch('btnBrake', 'brake');
    const wrap = document.getElementById('steerWrap');
    const wheel = document.getElementById('steeringWheel');
    if (wrap && wheel) {
      let steering = false;
      let wheelAngle = 0;
      let lastPointerDeg: number | null = null;
      let springTimer: number | null = null;
      const STEER_LOCK = 540; // degrees lock-to-lock like a real wheel (±1.5 turns)
      const normDelta = (from: number, to: number) => {
        let d = to - from;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
      };
      const applySteer = (clientX: number, clientY: number) => {
        const r = wrap.getBoundingClientRect();
        const dx = clientX - (r.left + r.width / 2);
        const dy = clientY - (r.top + r.height / 2);
        const pointerDeg = Math.atan2(dx, -dy) * 180 / Math.PI;
        if (lastPointerDeg === null) lastPointerDeg = pointerDeg;
        wheelAngle += normDelta(lastPointerDeg, pointerDeg);
        lastPointerDeg = pointerDeg;
        touchState.steer = clamp(-wheelAngle / STEER_LOCK, -1, 1);
        wheel.style.transform = `rotate(${wheelAngle}deg)`;
      };
      const endSteer = () => {
        steering = false;
        lastPointerDeg = null;
        if (springTimer) window.clearInterval(springTimer);
        // Ease wheel back to center when released
        springTimer = window.setInterval(() => {
          wheelAngle *= 0.82;
          if (Math.abs(wheelAngle) < 0.8) {
            wheelAngle = 0;
            touchState.steer = 0;
            wheel.style.transform = 'rotate(0deg)';
            if (springTimer) window.clearInterval(springTimer);
            springTimer = null;
            return;
          }
          touchState.steer = clamp(-wheelAngle / STEER_LOCK, -1, 1);
          wheel.style.transform = `rotate(${wheelAngle}deg)`;
        }, 16);
      };
      wrap.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (springTimer) { window.clearInterval(springTimer); springTimer = null; }
        steering = true;
        lastPointerDeg = null;
        wrap.setPointerCapture(e.pointerId);
        applySteer(e.clientX, e.clientY);
      });
      wrap.addEventListener('pointermove', (e) => {
        if (!steering) return;
        e.preventDefault();
        applySteer(e.clientX, e.clientY);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
        wrap.addEventListener(type, (e) => {
          e.preventDefault();
          endSteer();
        });
      });
    }
    const rear = $('btnRear');
    rear.addEventListener('pointerdown', (e) => { e.preventDefault(); rearView = true; $('rearViewIndicator').style.display = 'block'; });
    ['pointerup', 'pointercancel'].forEach((t) => rear.addEventListener(t, (e) => { e.preventDefault(); rearView = false; $('rearViewIndicator').style.display = 'none'; }));
    document.addEventListener('visibilitychange', () => {
      window.__gamePaused = document.hidden;
    });
  }

  function bindUi(): void {
    document.querySelectorAll('.cardAdBtn').forEach((btn) => {
      btn.addEventListener('click', startWatchAdsSession);
    });
    document.querySelectorAll('#garageGrid .carChoice').forEach((choice) => {
      choice.addEventListener('click', async (e) => {
        if ((e.target as HTMLElement).closest('.cardAdBtn')) return;
        const id = (choice as HTMLElement).dataset.car as CarId;
        if (!ownedCars.has(id) && !(await tryUnlockCar(id))) return;
        selectedGarageCar = id;
        document.querySelectorAll('#garageGrid .carChoice').forEach((c) => c.classList.toggle('selected', c === choice));
        updateGarageText();
      });
    });
    document.querySelectorAll('#trackGrid .carChoice').forEach((choice) => {
      choice.addEventListener('click', async (e) => {
        if ((e.target as HTMLElement).closest('.cardAdBtn')) return;
        const id = (choice as HTMLElement).dataset.track as TrackId;
        if (!ownedTracks.has(id) && !(await tryUnlockTrack(id))) return;
        selectedTrack = id;
        document.querySelectorAll('#trackGrid .carChoice').forEach((c) => c.classList.toggle('selected', c === choice));
        updateTrackText();
      });
    });
    $('garageContinueBtn').addEventListener('click', async () => {
      if (!ownedCars.has(selectedGarageCar) && !(await tryUnlockCar(selectedGarageCar))) return;
      carConfig = { ...GARAGE_CARS[selectedGarageCar] };
      $('garageOverlay').style.display = 'none';
      $('trackOverlay').style.display = 'flex';
      setBanner('menu');
      updateTrackText();
    });
    $('trackBackBtn').addEventListener('click', () => {
      $('trackOverlay').style.display = 'none';
      $('garageOverlay').style.display = 'flex';
      setBanner('menu');
    });
    const busy = document.getElementById('menuBusy');
    const launchRace = async () => {
      if (!ownedTracks.has(selectedTrack) && !(await tryUnlockTrack(selectedTrack))) return;
      const btn = $('trackContinueBtn') as HTMLButtonElement;
      btn.disabled = true;
      try {
        prepareSelectedTrack();
        setupRace();
        $('trackOverlay').style.display = 'none';
        $('startOverlay').style.display = 'flex';
        setBanner('hidden');
        updateTrackText();
      } catch (err) {
        console.error(err);
        setupRace();
        $('trackOverlay').style.display = 'none';
        $('startOverlay').style.display = 'flex';
        setBanner('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'CONTINUE';
        if (busy) busy.classList.remove('show');
      }
    };
    $('trackContinueBtn').addEventListener('click', () => { void launchRace(); });
    $('startBtn').addEventListener('click', () => {
      $('startOverlay').style.display = 'none';
      setBanner('race');
      showCountdown();
    });
    const introStart = document.getElementById('introStartBtn');
    introStart?.addEventListener('click', () => {
      openNameSlide({ forChange: false });
    });
    const nameInput = document.getElementById('playerNameInput') as HTMLInputElement | null;
    const confirmName = () => {
      if (!commitPlayerName(nameInput?.value || playerName)) return;
      const slide = document.getElementById('nameSlide');
      const mode = slide?.getAttribute('data-mode') || 'start';
      if (mode === 'change') {
        closeNameSlide();
        updateGarageText();
        updateTrackText();
        return;
      }
      enterGarageFromIntro();
    };
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmName();
    });
    document.getElementById('nameSlideConfirm')?.addEventListener('click', confirmName);
    document.getElementById('nameSlideCancel')?.addEventListener('click', () => {
      closeNameSlide();
    });
    document.getElementById('introHistoryBtn')?.addEventListener('click', openHistoryPanel);
    document.getElementById('closeHistory')?.addEventListener('click', closeHistoryPanel);
    document.getElementById('settingsHistoryBtn')?.addEventListener('click', openHistoryPanel);
    document.getElementById('changeNameBtn')?.addEventListener('click', () => {
      settingsOpen = false;
      $('settingsPanel').classList.remove('open');
      openNameSlide({ forChange: true });
      updatePauseStatus();
    });
    document.getElementById('clearHistoryBtn')?.addEventListener('click', async () => {
      const ok = await themedConfirm('CLEAR HISTORY', 'Delete all saved race results on this device?');
      if (!ok) return;
      saveRaceHistory([]);
      renderRaceHistory();
    });
    document.getElementById('testAdCloseBtn')?.addEventListener('click', () => {
      closeTestAdOverlay();
      watchAdAwaiting = false;
      if (watchAdsRemaining > 0) {
        grantWatchAdReward();
        setAdStatus(watchAdsRemaining > 0
          ? `Reward received: +100 coins. ${watchAdsRemaining} ads left.`
          : 'All 5 test ads complete.');
        if (watchAdsRemaining > 0) {
          window.setTimeout(() => {
            watchAdJustRewarded = false;
            requestNextWatchAd();
          }, 450);
        }
        return;
      }
      if (singleRewardPending) {
        singleRewardPending = false;
        grantWatchAdReward();
        setAdStatus('Reward received: +100 coins.');
      }
    });
    $('restartBtn').addEventListener('click', () => {
      $('finishOverlay').style.display = 'none';
      setBanner('race');
      prepareSelectedTrack();
      setupRace();
      showCountdown();
    });
    $('rewardAdBtn').addEventListener('click', () => startSingleRewardAd());
    $('storeBtn').addEventListener('click', () => { $('storePanel').classList.add('open'); updateStoreUI(); });
    $('garageStoreBtn').addEventListener('click', () => { $('storePanel').classList.add('open'); updateStoreUI(); });
    $('closeStore').addEventListener('click', () => $('storePanel').classList.remove('open'));
    $('dailyRewardBtn').addEventListener('click', () => {
      const today = new Date().toISOString().slice(0, 10);
      let last = '';
      try { last = localStorage.getItem(DAILY_KEY) || ''; } catch { /* ignore */ }
      if (last === today) return;
      playerCoins += 100;
      saveCoins(playerCoins);
      try { localStorage.setItem(DAILY_KEY, today); } catch { /* ignore */ }
      updateStoreUI();
      updateGarageText();
    });
    $('buyCoinsBtn').addEventListener('click', () => nativeCall('purchaseProduct', 'coins_1000'));
    $('buyRemoveAdsBtn').addEventListener('click', () => nativeCall('purchaseProduct', 'remove_ads'));
    $('restoreBtn').addEventListener('click', () => nativeCall('restorePurchases'));
    $('settingsBtn').addEventListener('click', () => {
      settingsOpen = true;
      $('settingsPanel').classList.add('open');
      updatePauseStatus();
    });
    $('closeSettings').addEventListener('click', () => {
      settingsOpen = false;
      $('settingsPanel').classList.remove('open');
      updatePauseStatus();
    });
    $('graphicsSelect').addEventListener('change', (e) => applyQuality((e.target as HTMLSelectElement).value as Quality));
    $('fpsSelect').addEventListener('change', (e) => { targetFPS = Number((e.target as HTMLSelectElement).value) || 60; });
    $('muteToggle').addEventListener('change', (e) => { soundMuted = (e.target as HTMLSelectElement).value === 'off'; });
    $('exitBtn').addEventListener('click', goToMenu);
    $('finishMenuBtn').addEventListener('click', goToMenu);

    window.onRewardedAdCompleted = () => {
      watchAdAwaiting = false;
      closeTestAdOverlay();
      if (watchAdsRemaining > 0) {
        grantWatchAdReward();
        setAdStatus(watchAdsRemaining > 0
          ? `Reward received: +100 coins. ${watchAdsRemaining} ads left.`
          : 'All 5 ads complete. +500 coins.');
        return;
      }
      if (singleRewardPending) {
        singleRewardPending = false;
        grantWatchAdReward();
        setAdStatus('Reward received: +100 coins.');
      }
    };
    window.onRewardedAdClosed = () => {
      watchAdAwaiting = false;
      closeTestAdOverlay();
      if (watchAdsRemaining > 0 && watchAdJustRewarded) {
        watchAdJustRewarded = false;
        window.setTimeout(requestNextWatchAd, 500);
        return;
      }
      if (watchAdsRemaining > 0 && !watchAdJustRewarded) {
        watchAdsRemaining = 0;
        updateCardAdLabels();
        setAdStatus('Ad closed early — coins not granted. Tap again to retry.');
      }
      if (singleRewardPending && !watchAdJustRewarded) {
        singleRewardPending = false;
        setAdStatus('Ad closed early — coins not granted.');
      }
      watchAdJustRewarded = false;
    };
    window.onRewardedAdFailed = (reason?: string) => {
      watchAdAwaiting = false;
      closeTestAdOverlay();
      if (watchAdsRemaining > 0) {
        watchAdsRemaining = 0;
        updateCardAdLabels();
      }
      singleRewardPending = false;
      watchAdJustRewarded = false;
      setAdStatus(reason || 'Rewarded ad failed to load. Try again in a moment.');
    };
    window.onPurchaseCompleted = (productId: string) => {
      if (productId === 'coins_1000') playerCoins += 1000;
      if (productId === 'remove_ads') {
        removeAds = true;
        saveBool(REMOVE_ADS_KEY, true);
        setBanner('hidden');
      }
      saveCoins(playerCoins);
      updateStoreUI();
      updateGarageText();
    };
    window.onPurchaseRestored = (productId: string) => {
      if (productId === 'remove_ads') { removeAds = true; saveBool(REMOVE_ADS_KEY, true); updateStoreUI(); }
    };
  }

  status?.('Sampling track…');
  rebuildSamples('classic');
  status?.('Building scenery…');
  try { buildWorld('golf'); } catch (err) { console.warn(err); }
  status?.('Binding controls…');
  bindInput();
  bindUi();
  paintRouteMaps();
  refreshLocks();
  updateCoinsUI();
  updateGarageText();
  updateTrackText();
  updateStoreUI();
  applyPlayerNameEverywhere();
  applyQuality(quality);
  (document.getElementById('graphicsSelect') as HTMLSelectElement).value = quality;

  const boot = document.getElementById('bootOverlay');
  if (boot) boot.remove();

  const startMenuFlow = () => {
    const splash = document.getElementById('splashScreen');
    const intro = document.getElementById('introScreen');
    closeNameSlide();
    splash?.classList.add('hidden');
    intro?.classList.remove('hidden');
    $('garageOverlay').style.display = 'none';
    $('trackOverlay').style.display = 'none';
    $('startOverlay').style.display = 'none';
    setBanner('hidden');
    applyPlayerNameEverywhere();
  };

  if (new URLSearchParams(location.search).has('demo')) {
    if (!playerName) {
      playerName = 'Demo';
      savePlayerName(playerName);
    }
    applyPlayerNameEverywhere();
    selectedTrack = 'street';
    selectedGarageCar = 'inferno';
    carConfig = { ...GARAGE_CARS.inferno };
    TOTAL_LAPS = 3;
    rebuildSamples('street');
    buildWorld('city');
    document.getElementById('splashScreen')?.classList.add('hidden');
    document.getElementById('introScreen')?.classList.add('hidden');
    $('garageOverlay').style.display = 'none';
    setBanner('race');
    setupRace();
    showCountdown();
  } else {
    startMenuFlow();
  }

  app.on('update', (dt: number) => {
    if (window.__gamePaused) return;
    const now = performance.now();
    if (targetFPS < 60 && now - lastFrame < 1000 / targetFPS - 1) return;
    lastFrame = now;
    // Clamp spikes but avoid multi-step catch-up hitching on phones.
    const step = Math.min(Math.max(dt, 0), android ? 0.033 : 0.05);
    if (raceState === 'idle') {
      const t = now * 0.00012;
      camera.setPosition(Math.sin(t) * 70, 40, Math.cos(t) * 70);
      camera.lookAt(0, 0, 0);
      return;
    }
    if (settingsOpen || !player) return;
    if (raceState === 'racing') {
      raceTime += step;
      updatePlayer(step);
      aiCars.forEach((c) => { if (!c.finished) updateAI(c, step); });
      allCars.forEach((c) => { if (c.crashCooldown > 0) c.crashCooldown -= step; });
      resolveCollisions();
      aiCars.forEach((c) => clampToFence(c, 1));
    }
    if (raceState === 'countdown' || raceState === 'racing') {
      updateWalkers(step);
      const cap = carConfig.maxSpeed || MAX_SPEED;
      const speedFactor = raceState === 'racing' ? clamp(Math.abs(player.speed) / cap, 0, 1) : 0;
      updateCamera(step, speedFactor);
      // Speed overlay was making driving look muddy/smeared on phones — keep it off on Android.
      const vign = document.getElementById('speedVignette');
      if (vign) {
        if (android) {
          vign.style.opacity = '0';
        } else {
          const rush = Math.max(0, (Math.abs(player.speed) / cap - 0.35) / 0.8);
          vign.style.opacity = String(Math.min(0.35, rush * rush * 0.35));
        }
      }
      updateHud(step);
      if (player.finished) endRace();
    }
  });
}
