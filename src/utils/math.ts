export type Vec3 = [number, number, number];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

export const normalize = (v: Vec3): Vec3 => {
  const len = length(v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const vecLerp = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export const rotateYaw = (forward: Vec3, yaw: number): Vec3 => {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [forward[0] * cos - forward[2] * sin, forward[1], forward[0] * sin + forward[2] * cos];
};

export const toFixed = (v: number, decimals = 2): number => Number(v.toFixed(decimals));

export const approxEqual = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

export const vecApproxEqual = (a: Vec3, b: Vec3, eps = 1e-6): boolean => approxEqual(a[0], b[0], eps) && approxEqual(a[1], b[1], eps) && approxEqual(a[2], b[2], eps);
