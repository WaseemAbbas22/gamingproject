export type Vec = { x: number; y: number; z: number };
export type Sample = { t: number; p: Vec; tan: Vec; nrm: Vec };

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class ClosedCurve {
  pts: Vec[];
  constructor(pts: Vec[]) {
    this.pts = pts;
  }

  private pointOn(u: number): Vec {
    const n = this.pts.length;
    const x = ((u % 1) + 1) % 1;
    const f = x * n;
    const i = Math.floor(f);
    const t = f - i;
    const p0 = this.pts[(i - 1 + n) % n];
    const p1 = this.pts[i % n];
    const p2 = this.pts[(i + 1) % n];
    const p3 = this.pts[(i + 2) % n];
    return {
      x: cr(p0.x, p1.x, p2.x, p3.x, t),
      y: cr(p0.y, p1.y, p2.y, p3.y, t),
      z: cr(p0.z, p1.z, p2.z, p3.z, t)
    };
  }

  getPointAt(t: number): Vec {
    return this.pointOn(t);
  }

  getTangentAt(t: number): Vec {
    const a = this.pointOn(t - 0.001);
    const b = this.pointOn(t + 0.001);
    const x = b.x - a.x;
    const z = b.z - a.z;
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, y: 0, z: z / len };
  }

  getLength(steps = 400): number {
    let len = 0;
    let prev = this.pointOn(0);
    for (let i = 1; i <= steps; i++) {
      const p = this.pointOn(i / steps);
      len += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    return len;
  }
}

export function buildSamples(curve: ClosedCurve, seg: number): Sample[] {
  const samples: Sample[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nrm = { x: -tan.z, y: 0, z: tan.x };
    samples.push({ t, p, tan, nrm });
  }
  return samples;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function damp(current: number, target: number, smoothing: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-smoothing * dt));
}

export function dampAngle(current: number, target: number, smoothing: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-smoothing * dt));
}

export function addScaled(a: Vec, b: Vec, s: number): Vec {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}
