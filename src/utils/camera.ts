import { add, cross, dot, normalize, scale, sub, type Vec3 } from "./math";

export interface Camera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
}

export interface CameraSpace {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

export const createCameraSpace = (camera: Camera): CameraSpace => {
  const forward = normalize(sub(camera.target, camera.position));
  let right = cross(forward, camera.up);
  const rightLength = Math.hypot(right[0], right[1], right[2]);
  if (rightLength < 1e-6) {
    right = [1, 0, 0];
  } else {
    right = scale(right, 1 / rightLength);
  }
  const trueUp = cross(right, forward);
  return {
    position: camera.position,
    forward,
    right,
    up: trueUp,
    fov: camera.fov,
    near: camera.near,
    far: camera.far
  };
};

export const projectPoint = (
  point: Vec3,
  space: CameraSpace,
  canvasWidth: number,
  canvasHeight: number
): ProjectedPoint | null => {
  const view = sub(point, space.position);
  const x = dot(view, space.right);
  const y = dot(view, space.up);
  const z = dot(view, space.forward);
  if (z <= space.near || z >= space.far) {
    return null;
  }
  const aspect = canvasWidth / canvasHeight;
  const f = 1 / Math.tan(space.fov / 2);
  const ndcX = (x / z) * f / aspect;
  const ndcY = (y / z) * f;
  const screenX = canvasWidth * 0.5 + ndcX * canvasWidth * 0.5;
  const screenY = canvasHeight * 0.5 - ndcY * canvasHeight * 0.5;
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return null;
  }
  return { x: screenX, y: screenY, depth: z };
};

export const projectRadius = (
  radius: number,
  point: Vec3,
  space: CameraSpace,
  canvasWidth: number,
  canvasHeight: number
): number => {
  const base = projectPoint(point, space, canvasWidth, canvasHeight);
  const offset = projectPoint(add(point, scale(space.right, radius)), space, canvasWidth, canvasHeight);
  if (!base || !offset) {
    return 0;
  }
  return Math.hypot(offset.x - base.x, offset.y - base.y);
};
