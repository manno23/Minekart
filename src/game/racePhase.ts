import { World, type System } from "../ecs/world";
import { TRACK_DATA, type TrackData } from "./track";
import type { Blueprint } from "./blueprint";
import { getPartRegistry, findPart } from "../data/parts";
import {
  type Transform,
  type RigidBody,
  type Wheel,
  type PowerUp,
  type PlayerInput,
  type AIController,
  type LapCounter,
  type AeroSurface,
  type Armor,
  type Ballast
} from "../ecs/components";
import {
  add,
  clamp,
  cross,
  distance,
  length,
  normalize,
  rotateYaw,
  scale,
  sub,
  vec3,
  type Vec3
} from "../utils/math";
import { Random } from "../utils/prng";
import { createCameraSpace, projectPoint, projectRadius, type CameraSpace, type ProjectedPoint } from "../utils/camera";
import { darken, lighten, mix } from "../utils/color";

interface CarEntity {
  id: number;
  name: string;
  isPlayer: boolean;
  behavior: "clean" | "rammer";
  color: string;
}

interface RaceCallbacks {
  onComplete(): void;
}

interface ReplayFrame {
  time: number;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  lap: number;
}

class InputSystem implements System {
  private keys: Set<string>;
  constructor(world: World, keys: Set<string>) {
    this.keys = keys;
  }

  update(world: World): void {
    for (const { entity, components } of world.view<{ playerInput: PlayerInput; rigidBody: RigidBody; transform: Transform }>([
      "playerInput",
      "rigidBody",
      "transform"
    ])) {
      const input = components.playerInput;
      input.throttle = this.keys.has("KeyW") ? 1 : 0;
      input.brake = this.keys.has("KeyS") ? 1 : 0;
      input.steer = (this.keys.has("KeyA") ? -1 : 0) + (this.keys.has("KeyD") ? 1 : 0);
      input.usePower = this.keys.has("Space");
      if (!components.rigidBody.onGround) {
        input.brake *= 0.5;
      }
    }
  }
}

interface TrackLookup {
  nodes: Vec3[];
  lengths: number[];
  totalLength: number;
}

const prepareTrack = (track: TrackData): TrackLookup => {
  const nodes = track.nodes.map((node) => vec3(node[0], node[1], node[2]));
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const len = distance(nodes[i], nodes[i + 1]);
    lengths.push(len);
    total += len;
  }
  return { nodes, lengths, totalLength: total };
};

class AISystem implements System {
  private track: TrackLookup;
  private random: Random;

  constructor(track: TrackLookup, random: Random) {
    this.track = track;
    this.random = random;
  }

  update(world: World, dt: number): void {
    for (const { entity, components } of world.view<{ ai: AIController; playerInput: PlayerInput; transform: Transform; rigidBody: RigidBody }>([
      "ai",
      "playerInput",
      "transform",
      "rigidBody"
    ])) {
      const ai = components.ai;
      const input = components.playerInput;
      const transform = components.transform;
      const rigidBody = components.rigidBody;

      const targetNode = this.track.nodes[ai.targetNode % this.track.nodes.length];
      const toTarget = sub(targetNode, transform.position);
      const forward = rotateYaw([0, 0, 1], transform.rotation[1]);
      const desiredYaw = Math.atan2(toTarget[0], toTarget[2]);
      const currentYaw = transform.rotation[1];
      let yawDiff = desiredYaw - currentYaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

      input.steer = clamp(yawDiff * 1.2 + this.random.nextRange(-0.05, 0.05), -1, 1);
      const speed = length(rigidBody.velocity);
      const desiredSpeed = ai.behavior === "rammer" ? 38 : 32;
      input.throttle = speed < desiredSpeed ? 1 : 0.3;
      input.brake = yawDiff > 0.6 ? 0.4 : 0;
      if (distance(transform.position, targetNode) < 6) {
        ai.targetNode = (ai.targetNode + 1) % this.track.nodes.length;
      }

      ai.cooldown -= dt;
      if (ai.cooldown <= 0 && !world.getComponent<PowerUp>(entity, "powerUp")?.active && this.random.next() > 0.7) {
        input.usePower = true;
        ai.cooldown = this.random.nextRange(4, 7);
      } else {
        input.usePower = false;
      }
    }
  }
}

interface PhysicsConfig {
  fixedDt: number;
}

export class PhysicsSystem implements System {
  private config: PhysicsConfig;

  constructor(config: PhysicsConfig) {
    this.config = config;
  }

  update(world: World, dt: number): void {
    for (const { components } of world.view<{ transform: Transform; rigidBody: RigidBody; playerInput: PlayerInput; powerUp: PowerUp }>([
      "transform",
      "rigidBody",
      "playerInput",
      "powerUp"
    ])) {
      const { transform, rigidBody, playerInput, powerUp } = components;
      const forward = rotateYaw([0, 0, 1], transform.rotation[1]);
      const side = rotateYaw([1, 0, 0], transform.rotation[1]);

      const throttleForce = 1200 * playerInput.throttle;
      const brakeForce = 600 * playerInput.brake;
      const acceleration = scale(forward, (throttleForce - brakeForce) / Math.max(rigidBody.mass, 1));

      const dragForce = scale(rigidBody.velocity, -rigidBody.drag * 0.6);
      rigidBody.velocity = add(rigidBody.velocity, scale(add(acceleration, dragForce), dt));

      const steerRate = playerInput.steer * (powerUp.type === "toad" && powerUp.active ? 1.3 : 0.9);
      transform.rotation[1] += steerRate * dt * 2.4;

      transform.position = add(transform.position, scale(rigidBody.velocity, dt));
      rigidBody.onGround = transform.position[1] <= 0.5;
      if (rigidBody.onGround) {
        transform.position[1] = clamp(transform.position[1], 0.2, 6);
        rigidBody.velocity[1] = Math.max(rigidBody.velocity[1], -2);
      }
    }
  }
}

class AeroSystem implements System {
  update(world: World, dt: number): void {
    for (const { components } of world.view<{ aero: AeroSurface; rigidBody: RigidBody; transform: Transform; powerUp: PowerUp }>([
      "aero",
      "rigidBody",
      "transform",
      "powerUp"
    ])) {
      const { aero, rigidBody, powerUp } = components;
      const speed = length(rigidBody.velocity);
      let downforce = aero.liftCoeff * speed * 0.6;
      let dragForce = aero.dragCoeff * speed * 0.4;
      if (powerUp.type === "dragonWings" && powerUp.active) {
        downforce *= 1.6;
        dragForce *= 0.9;
        rigidBody.velocity[1] += dt * 4;
      }
      rigidBody.velocity[1] -= downforce * dt / Math.max(rigidBody.mass, 1);
      rigidBody.velocity[0] -= dragForce * dt * 0.3;
      rigidBody.velocity[2] -= dragForce * dt * 0.3;
    }
  }
}

class PowerUpSystem implements System {
  private track: TrackData;
  private random: Random;

  constructor(track: TrackData, random: Random) {
    this.track = track;
    this.random = random;
  }

  update(world: World, dt: number): void {
    for (const { entity, components } of world.view<{ powerUp: PowerUp; transform: Transform; playerInput: PlayerInput }>([
      "powerUp",
      "transform",
      "playerInput"
    ])) {
      const power = components.powerUp;
      const input = components.playerInput;
      power.remainingCooldown = Math.max(0, power.remainingCooldown - dt);
      if (power.active) {
        power.timer -= dt;
        if (power.timer <= 0) {
          power.active = false;
          power.type = "none";
          power.timer = 0;
        }
      }

      if (!power.active && input.usePower && power.type !== "none" && power.remainingCooldown <= 0) {
        power.active = true;
        power.timer = power.type === "dragonWings" ? 3 : 2;
        power.remainingCooldown = power.type === "dragonWings" ? 10 : 12;
      }

      const rigid = world.getComponent<RigidBody>(entity, "rigidBody");
      if (rigid) {
        if (power.active && power.type === "toad") {
          rigid.mass = rigid.baseMass * 0.7;
          rigid.drag = rigid.baseDrag * 0.75;
        } else if (power.active && power.type === "dragonWings") {
          rigid.mass = rigid.baseMass;
          rigid.drag = rigid.baseDrag * 0.9;
        } else {
          rigid.mass = rigid.baseMass;
          rigid.drag = rigid.baseDrag;
        }
      }

      const transform = components.transform;
      for (const pad of this.track.itemPads) {
        if (distance(transform.position, pad.position) < 4 && power.type === "none" && power.remainingCooldown <= 0) {
          power.type = this.random.next() > 0.5 ? "dragonWings" : "toad";
          power.timer = 0;
          power.active = false;
          power.remainingCooldown = 1.5;
          input.usePower = false;
        }
      }
    }
  }
}

class CollisionSystem implements System {
  private track: TrackData;

  constructor(track: TrackData) {
    this.track = track;
  }

  update(world: World, dt: number): void {
    for (const { components } of world.view<{ transform: Transform; rigidBody: RigidBody; armor: Armor }>(["transform", "rigidBody", "armor"])) {
      const { transform, rigidBody, armor } = components;
      const pos = transform.position;
      if (pos[0] < -40 || pos[0] > 70 || pos[2] < -60 || pos[2] > 60) {
        rigidBody.velocity = scale(rigidBody.velocity, -0.4);
        armor.integrity = Math.max(0, armor.integrity - 4);
        transform.position = [clamp(pos[0], -40, 70), pos[1], clamp(pos[2], -60, 60)];
      }
      for (const hazard of this.track.hazards) {
        if (distance(pos, hazard.position) < hazard.radius + 2) {
          rigidBody.velocity = scale(rigidBody.velocity, 0.6);
          armor.integrity = Math.max(0, armor.integrity - 2);
        }
      }
    }
  }
}

class LapSystem implements System {
  private track: TrackData;

  constructor(track: TrackData) {
    this.track = track;
  }

  update(world: World, dt: number): void {
    for (const { components } of world.view<{ transform: Transform; lap: LapCounter }>(["transform", "lap"])) {
      const { transform, lap } = components;
      lap.time += dt;
      const checkpoint = this.track.checkpoints[lap.checkpoint % this.track.checkpoints.length];
      const target = this.track.nodes[checkpoint.index];
      if (distance(transform.position, target) < checkpoint.width) {
        lap.checkpoint = (lap.checkpoint + 1) % this.track.checkpoints.length;
        if (lap.checkpoint === 0) {
          lap.bestLap = lap.bestLap === 0 ? lap.time : Math.min(lap.bestLap, lap.time);
          lap.lap += 1;
          lap.time = 0;
        }
      }
    }
  }
}

interface QuadSurface {
  corners: [Vec3, Vec3, Vec3, Vec3];
  tint: string;
}

interface RampSurface {
  corners: [Vec3, Vec3, Vec3, Vec3];
}

class RenderingSystem implements System {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private track: TrackData;
  private ghost: ReplayFrame[] = [];
  private replayActive = false;
  private replayFrames: ReplayFrame[] = [];
  private followEntity: number | null = null;
  private playerEntity: number | null = null;
  private entityColors = new Map<number, string>();
  private trackSurfaces: QuadSurface[] = [];
  private rumbleSurfaces: QuadSurface[] = [];
  private rampSurfaces: RampSurface[] = [];
  private skyGradient: CanvasGradient | null = null;

  constructor(canvas: HTMLCanvasElement, track: TrackData) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas unavailable");
    }
    this.ctx = ctx;
    this.canvas = canvas;
    this.track = track;
    this.prepareGeometry();
  }

  registerCar(entity: number, color: string): void {
    this.entityColors.set(entity, color);
  }

  setFollow(entity: number): void {
    this.followEntity = entity;
    this.playerEntity = entity;
  }

  setGhost(frames: ReplayFrame[]): void {
    this.ghost = frames;
  }

  setReplay(frames: ReplayFrame[]): void {
    this.replayFrames = frames;
    this.replayActive = true;
  }

  clearReplay(): void {
    this.replayActive = false;
    this.replayFrames = [];
  }

  update(world: World): void {
    const camera = this.computeCamera(world);
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    if (!this.skyGradient) {
      this.skyGradient = ctx.createLinearGradient(0, 0, 0, height);
      this.skyGradient.addColorStop(0, "#0f172a");
      this.skyGradient.addColorStop(1, "#020617");
    }

    ctx.fillStyle = this.skyGradient;
    ctx.fillRect(0, 0, width, height);

    this.drawTrack(ctx, camera);
    this.drawGhosts(ctx, camera);
    this.drawHazards(ctx, camera);
    this.drawCars(world, ctx, camera);
  }

  private prepareGeometry(): void {
    const nodes = this.track.nodes.map((node) => vec3(node[0], node[1], node[2]));
    const width = 14;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      const dir = sub(b, a);
      const len = length(dir);
      if (len < 1e-3) continue;
      const forward = scale(dir, 1 / len);
      const right = normalize(cross([0, 1, 0], forward));
      const leftOffset = scale(right, -width / 2);
      const rightOffset = scale(right, width / 2);
      this.trackSurfaces.push({
        corners: [
          add(a, leftOffset),
          add(b, leftOffset),
          add(b, rightOffset),
          add(a, rightOffset)
        ],
        tint: "#2d3353"
      });
    }

    const rumbleWidth = 2.2;
    for (const strip of this.track.rumbleStrips) {
      const p1 = strip.p1;
      const p2 = strip.p2;
      const dir = sub(p2, p1);
      const len = length(dir);
      if (len < 1e-3) continue;
      const forward = scale(dir, 1 / len);
      const right = normalize(cross([0, 1, 0], forward));
      const leftOffset = scale(right, -rumbleWidth / 2);
      const rightOffset = scale(right, rumbleWidth / 2);
      this.rumbleSurfaces.push({
        corners: [
          add(p1, leftOffset),
          add(p2, leftOffset),
          add(p2, rightOffset),
          add(p1, rightOffset)
        ],
        tint: "#b12a3a"
      });
    }

    for (const ramp of this.track.ramps) {
      const forward = normalize(ramp.forward);
      const right = normalize(cross([0, 1, 0], forward));
      const start = sub(ramp.position, scale(forward, ramp.length / 2));
      const end = add(ramp.position, scale(forward, ramp.length / 2));
      const heightOffset: Vec3 = [0, ramp.height, 0];
      const leftStart = add(start, scale(right, -ramp.width / 2));
      const rightStart = add(start, scale(right, ramp.width / 2));
      const leftEnd = add(add(end, scale(right, -ramp.width / 2)), heightOffset);
      const rightEnd = add(add(end, scale(right, ramp.width / 2)), heightOffset);
      this.rampSurfaces.push({
        corners: [leftStart, leftEnd, rightEnd, rightStart]
      });
    }
  }

  private computeCamera(world: World): CameraSpace {
    if (this.followEntity) {
      const transform = world.getComponent<Transform>(this.followEntity, "transform");
      if (transform) {
        const forward = rotateYaw([0, 0, 1], transform.rotation[1]);
        const focus = add(transform.position, vec3(0, 1.6, 0));
        const behind = add(focus, scale(forward, -10));
        const eye: Vec3 = [behind[0], behind[1] + 6, behind[2]];
        return createCameraSpace({
          position: eye,
          target: focus,
          up: [0, 1, 0],
          fov: Math.PI / 2.6,
          near: 0.3,
          far: 420
        });
      }
    }
    return createCameraSpace({
      position: [-25, 20, -45],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: Math.PI / 3,
      near: 0.3,
      far: 420
    });
  }

  private drawTrack(ctx: CanvasRenderingContext2D, camera: CameraSpace): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const polys: Array<{ points: ProjectedPoint[]; depth: number; color: string }> = [];

    for (const surface of this.trackSurfaces) {
      const projected = surface.corners
        .map((corner) => projectPoint(corner, camera, width, height))
        .filter((point): point is ProjectedPoint => point !== null);
      if (projected.length !== surface.corners.length) continue;
      const depth = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
      const t = clamp(1 - depth / 220, 0.25, 0.95);
      const color = lighten(surface.tint, t * 0.3);
      polys.push({ points: projected, depth, color });
    }

    for (const surface of this.rumbleSurfaces) {
      const projected = surface.corners
        .map((corner) => projectPoint(corner, camera, width, height))
        .filter((point): point is ProjectedPoint => point !== null);
      if (projected.length !== surface.corners.length) continue;
      const depth = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
      polys.push({ points: projected, depth, color: surface.tint });
    }

    for (const ramp of this.rampSurfaces) {
      const projected = ramp.corners
        .map((corner) => projectPoint(corner, camera, width, height))
        .filter((point): point is ProjectedPoint => point !== null);
      if (projected.length !== ramp.corners.length) continue;
      const depth = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
      polys.push({ points: projected, depth, color: "rgba(124,92,255,0.55)" });
    }

    polys.sort((a, b) => b.depth - a.depth);

    for (const poly of polys) {
      ctx.beginPath();
      ctx.moveTo(poly.points[0].x, poly.points[0].y);
      for (let i = 1; i < poly.points.length; i++) {
        ctx.lineTo(poly.points[i].x, poly.points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = poly.color;
      ctx.fill();
    }
  }

  private drawGhosts(ctx: CanvasRenderingContext2D, camera: CameraSpace): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const drawPath = (frames: ReplayFrame[], color: string) => {
      if (frames.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < frames.length; i += 4) {
        const frame = frames[i];
        const projected = projectPoint(frame.position, camera, width, height);
        if (!projected) continue;
        if (!started) {
          ctx.moveTo(projected.x, projected.y);
          started = true;
        } else {
          ctx.lineTo(projected.x, projected.y);
        }
      }
      if (started) {
        ctx.stroke();
      }
    };

    drawPath(this.ghost, "rgba(124,92,255,0.5)");
    if (this.replayActive) {
      drawPath(this.replayFrames, "rgba(255,189,89,0.55)");
    }
  }

  private drawHazards(ctx: CanvasRenderingContext2D, camera: CameraSpace): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    for (const pad of this.track.itemPads) {
      const projected = projectPoint(pad.position, camera, width, height);
      if (!projected) continue;
      const radius = Math.max(3, projectRadius(2.4, pad.position, camera, width, height));
      ctx.beginPath();
      ctx.fillStyle = "rgba(72, 199, 240, 0.65)";
      ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const hazard of this.track.hazards) {
      const projected = projectPoint(hazard.position, camera, width, height);
      if (!projected) continue;
      const radius = Math.max(4, projectRadius(hazard.radius, hazard.position, camera, width, height));
      ctx.beginPath();
      ctx.fillStyle = hazard.type === "oil" ? "rgba(20,20,40,0.7)" : "rgba(255,120,84,0.65)";
      ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCars(world: World, ctx: CanvasRenderingContext2D, camera: CameraSpace): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const faces: Array<{ points: ProjectedPoint[]; depth: number; color: string }> = [];

    for (const { entity, components } of world.view<{
      transform: Transform;
      rigidBody: RigidBody;
      armor: Armor;
    }>(["transform", "rigidBody", "armor"])) {
      const { transform, armor } = components;
      const baseColor = this.entityColors.get(entity) ?? "#9ca3af";
      const integrityBlend = clamp(armor.integrity / 100, 0.2, 1);
      const color = mix(baseColor, "#ff6b6b", 1 - integrityBlend);
      const yaw = transform.rotation[1];
      const forward = normalize(rotateYaw([0, 0, 1], yaw));
      const right = normalize(rotateYaw([1, 0, 0], yaw));
      const up: Vec3 = [0, 1, 0];
      const center = transform.position;
      const halfLength = 3;
      const halfWidth = 1.6;
      const halfHeight = 1.2;

      const compose = (f: number, r: number, u: number): Vec3 => {
        const forwardOffset = scale(forward, f);
        const rightOffset = scale(right, r);
        const upOffset = scale(up, u);
        return add(add(add(center, forwardOffset), rightOffset), upOffset);
      };

      const topFrontRight = compose(halfLength, halfWidth, halfHeight);
      const topFrontLeft = compose(halfLength, -halfWidth, halfHeight);
      const topRearLeft = compose(-halfLength, -halfWidth, halfHeight);
      const topRearRight = compose(-halfLength, halfWidth, halfHeight);
      const bottomFrontRight = compose(halfLength, halfWidth, -halfHeight);
      const bottomFrontLeft = compose(halfLength, -halfWidth, -halfHeight);
      const bottomRearLeft = compose(-halfLength, -halfWidth, -halfHeight);
      const bottomRearRight = compose(-halfLength, halfWidth, -halfHeight);

      const carFaces: Array<{ corners: Vec3[]; tint: string }> = [
        { corners: [topFrontLeft, topFrontRight, topRearRight, topRearLeft], tint: lighten(color, 0.25) },
        { corners: [topFrontRight, bottomFrontRight, bottomRearRight, topRearRight], tint: darken(color, 0.15) },
        { corners: [topFrontLeft, topRearLeft, bottomRearLeft, bottomFrontLeft], tint: darken(color, 0.22) },
        { corners: [topFrontLeft, bottomFrontLeft, bottomFrontRight, topFrontRight], tint: lighten(color, 0.05) },
        { corners: [topRearLeft, topRearRight, bottomRearRight, bottomRearLeft], tint: darken(color, 0.28) }
      ];

      for (const face of carFaces) {
        const projected = face.corners
          .map((corner) => projectPoint(corner, camera, width, height))
          .filter((point): point is ProjectedPoint => point !== null);
        if (projected.length !== face.corners.length) continue;
        const depth = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
        faces.push({ points: projected, depth, color: face.tint });
      }

      const roofLineStart = projectPoint(topFrontLeft, camera, width, height);
      const roofLineEnd = projectPoint(topFrontRight, camera, width, height);
      if (roofLineStart && roofLineEnd) {
        faces.push({
          points: [roofLineStart, roofLineEnd],
          depth: (roofLineStart.depth + roofLineEnd.depth) / 2,
          color: "line"
        });
      }
    }

    faces.sort((a, b) => b.depth - a.depth);

    for (const face of faces) {
      if (face.color === "line") {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(face.points[0].x, face.points[0].y);
        ctx.lineTo(face.points[1].x, face.points[1].y);
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(face.points[0].x, face.points[0].y);
      for (let i = 1; i < face.points.length; i++) {
        ctx.lineTo(face.points[i].x, face.points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = face.color;
      ctx.fill();
    }

    if (this.playerEntity) {
      const transform = world.getComponent<Transform>(this.playerEntity, "transform");
      if (transform) {
        const projected = projectPoint(add(transform.position, vec3(0, 3.2, 0)), camera, width, height);
        if (projected) {
          ctx.fillStyle = "rgba(124,92,255,0.85)";
          ctx.beginPath();
          ctx.arc(projected.x, projected.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

class ReplaySystem {
  frames: ReplayFrame[] = [];
  recording = true;
  constructor(private world: World, private player: number) {}

  capture(time: number): void {
    if (!this.recording) return;
    const transform = this.world.getComponent<Transform>(this.player, "transform");
    const rigidBody = this.world.getComponent<RigidBody>(this.player, "rigidBody");
    const lap = this.world.getComponent<LapCounter>(this.player, "lap");
    if (!transform || !rigidBody || !lap) return;
    this.frames.push({
      time,
      position: [...transform.position] as Vec3,
      velocity: [...rigidBody.velocity] as Vec3,
      yaw: transform.rotation[1],
      lap: lap.lap
    });
    if (this.frames.length > 6000) {
      this.frames.splice(0, this.frames.length - 6000);
    }
  }

  reset(): void {
    this.frames = [];
    this.recording = true;
  }
}

export class RacePhase {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private hud: HTMLDivElement;
  private world = new World();
  private systems: System[] = [];
  private keys = new Set<string>();
  private trackLookup = prepareTrack(TRACK_DATA);
  private random = new Random(TRACK_DATA.seed);
  private cars: CarEntity[] = [];
  private playerId!: number;
  private rendering!: RenderingSystem;
  private replay!: ReplaySystem;
  private time = 0;
  private running = false;
  private callbacks: RaceCallbacks;
  private powerHud: HTMLDivElement;
  private lapHud: HTMLDivElement;
  private posHud: HTMLDivElement;
  private leaderboardHud: HTMLUListElement;
  private replayIndicator: HTMLDivElement;
  private bestGhost: ReplayFrame[] = [];
  private lastLapCount = 0;
  private bestLapTime = Infinity;

  constructor(container: HTMLElement, callbacks: RaceCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "race-phase active";
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1024;
    this.canvas.height = 720;
    wrapper.appendChild(this.canvas);

    this.hud = document.createElement("div");
    this.hud.className = "hud";

    this.powerHud = document.createElement("div");
    this.powerHud.className = "powerup";
    this.hud.appendChild(this.powerHud);

    this.lapHud = document.createElement("div");
    this.lapHud.className = "lap-info";
    this.hud.appendChild(this.lapHud);

    this.posHud = document.createElement("div");
    this.posHud.className = "position-info";
    this.hud.appendChild(this.posHud);

    const board = document.createElement("div");
    board.className = "leaderboard";
    const boardTitle = document.createElement("h3");
    boardTitle.textContent = "Standings";
    board.appendChild(boardTitle);
    this.leaderboardHud = document.createElement("ul");
    board.appendChild(this.leaderboardHud);
    this.hud.appendChild(board);

    this.replayIndicator = document.createElement("div");
    this.replayIndicator.className = "replay-indicator";
    this.replayIndicator.textContent = "Replay";
    this.replayIndicator.style.display = "none";
    this.hud.appendChild(this.replayIndicator);

    wrapper.appendChild(this.hud);
    this.container.appendChild(wrapper);

    window.addEventListener("keydown", (event) => {
      this.keys.add(event.code);
      if (event.code === "KeyR") {
        this.toggleReplay();
      }
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
  }

  start(blueprint: Blueprint): void {
    this.initializeWorld(blueprint);
    this.running = true;
    const loop = (time: number) => {
      if (!this.running) return;
      const dt = 1 / 120;
      this.time += dt;
      for (const system of this.systems) {
        system.update(this.world, dt);
      }
      this.replay.capture(this.time);
      const lap = this.world.getComponent<LapCounter>(this.playerId, "lap");
      if (lap) {
        if (lap.lap > this.lastLapCount) {
          const completedLap = this.lastLapCount;
          const lapFrames = this.replay.frames.filter((frame) => frame.lap === completedLap);
          if (lap.bestLap > 0 && lap.bestLap < this.bestLapTime && lapFrames.length > 0) {
            this.bestLapTime = lap.bestLap;
            this.bestGhost = lapFrames.map((frame) => ({ ...frame, position: [...frame.position] as Vec3, velocity: [...frame.velocity] as Vec3 }));
            this.rendering.setGhost(this.bestGhost);
          }
          this.lastLapCount = lap.lap;
        }
        if (lap.lap >= lap.totalLaps) {
          this.running = false;
          this.callbacks.onComplete();
          return;
        }
      }
      this.updateHud();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private initializeWorld(blueprint: Blueprint): void {
    this.world = new World();
    this.systems = [];
    const inputSystem = new InputSystem(this.world, this.keys);
    const physicsSystem = new PhysicsSystem({ fixedDt: 1 / 120 });
    const aeroSystem = new AeroSystem();
    const powerSystem = new PowerUpSystem(TRACK_DATA, this.random);
    const collisionSystem = new CollisionSystem(TRACK_DATA);
    const lapSystem = new LapSystem(TRACK_DATA);
    this.rendering = new RenderingSystem(this.canvas, TRACK_DATA);

    this.systems.push(inputSystem, new AISystem(this.trackLookup, this.random), physicsSystem, aeroSystem, powerSystem, collisionSystem, lapSystem, this.rendering);

    this.bestGhost = [];
    this.rendering.setGhost([]);
    this.lastLapCount = 0;
    this.bestLapTime = Infinity;

    const registry = getPartRegistry();
    this.cars = [];
    this.playerId = this.spawnCar("Player", blueprint, true, "clean", "#7c5cff", registry);
    this.cars.push({ id: this.playerId, name: "Player", isPlayer: true, behavior: "clean", color: "#7c5cff" });
    const behaviors: Array<"clean" | "rammer"> = ["clean", "clean", "clean", "rammer", "rammer"];
    for (let i = 0; i < behaviors.length; i++) {
      const preset = blueprint;
      const color = behaviors[i] === "clean" ? "#7cff7c" : "#ff6b6b";
      const id = this.spawnCar(`AI ${i + 1}`, preset, false, behaviors[i], color, registry, i + 1);
      this.cars.push({ id, name: `AI ${i + 1}`, isPlayer: false, behavior: behaviors[i], color });
    }

    this.replay = new ReplaySystem(this.world, this.playerId);
  }

  private spawnCar(
    name: string,
    blueprint: Blueprint,
    isPlayer: boolean,
    behavior: "clean" | "rammer",
    color: string,
    registry = getPartRegistry(),
    index = 0
  ): number {
    const entity = this.world.createEntity();
    const start = TRACK_DATA.start.position;
    const offset: Vec3 = [start[0] + index * 3 - 6, start[1], start[2] + index * 2];
    this.world.addComponent<Transform>(entity, "transform", { position: [...offset] as Vec3, rotation: [0, TRACK_DATA.start.forward[2], 0] });

    const baseMass = 140 + blueprint.parts.reduce((sum, part) => sum + (findPart(part.partName)?.mass ?? 0), 0);
    const baseDrag = 0.8 + blueprint.parts.reduce((sum, part) => sum + (findPart(part.partName)?.drag_coeff ?? 0), 0);

    this.world.addComponent<RigidBody>(entity, "rigidBody", {
      velocity: vec3(),
      angularVelocity: vec3(),
      mass: baseMass,
      drag: baseDrag,
      inertia: baseMass * 0.8,
      onGround: true,
      baseMass,
      baseDrag
    });
    this.world.addComponent<Armor>(entity, "armor", { durability: 100, integrity: 100 });
    this.world.addComponent<Ballast>(entity, "ballast", { mass: 10, position: [0, 0, 0] });

    const power: PowerUp = { type: "none", active: false, timer: 0, cooldown: 0, remainingCooldown: 0 };
    this.world.addComponent<PowerUp>(entity, "powerUp", power);

    const lap: LapCounter = { lap: 0, totalLaps: TRACK_DATA.laps, checkpoint: 0, time: 0, bestLap: 0 };
    this.world.addComponent<LapCounter>(entity, "lap", lap);

    if (isPlayer) {
      this.world.addComponent<PlayerInput>(entity, "playerInput", { throttle: 0, brake: 0, steer: 0, usePower: false });
      this.playerId = entity;
    } else {
      this.world.addComponent<PlayerInput>(entity, "playerInput", { throttle: 0, brake: 0, steer: 0, usePower: false });
      this.world.addComponent<AIController>(entity, "ai", {
        behavior,
        targetNode: Math.floor(this.random.next() * this.trackLookup.nodes.length),
        aggression: behavior === "rammer" ? 1.2 : 0.6,
        seed: this.random.nextInt(10000),
        cooldown: this.random.nextRange(2, 4)
      });
    }

    const wheels: Wheel["wheels"] = [];
    let aeroArea = 0;
    let aeroDrag = 0;
    let aeroLift = 0;
    let pitchStability = 0;
    let yawStability = 0;
    for (const part of blueprint.parts) {
      const data = registry.byName.get(part.partName);
      if (!data) continue;
      if (data.category === "aero") {
        const area = data.length_blocks * data.width_blocks;
        aeroArea += area;
        aeroDrag += data.drag_coeff;
        aeroLift += 0.6 + data.drag_coeff * 0.5;
        pitchStability += 0.1 + data.length_blocks * 0.05;
        yawStability += 0.08 + data.width_blocks * 0.04;
      }
      if (data.category === "wheel") {
        wheels.push({
          radius: data.height_blocks / 2,
          grip: data.grip_coeff,
          drive: part.position[2] >= 0,
          steer: part.position[2] < 0,
          axleOffset: part.position[2]
        });
      }
    }
    this.world.addComponent<Wheel>(entity, "wheel", { wheels });
    this.world.addComponent<AeroSurface>(entity, "aero", {
      area: Math.max(1, aeroArea),
      dragCoeff: 0.2 + aeroDrag,
      liftCoeff: 1.2 + aeroLift,
      pitchStab: 0.4 + pitchStability,
      yawStab: 0.4 + yawStability
    });

    this.rendering.registerCar(entity, color);
    if (isPlayer) {
      this.rendering.setFollow(entity);
    }

    return entity;
  }

  private updateHud(): void {
    const playerLap = this.world.getComponent<LapCounter>(this.playerId, "lap");
    if (playerLap) {
      this.lapHud.textContent = `Lap ${Math.min(playerLap.lap + 1, playerLap.totalLaps)}/${playerLap.totalLaps} | Lap Time ${playerLap.time.toFixed(2)}s`;
    }
    const power = this.world.getComponent<PowerUp>(this.playerId, "powerUp");
    if (power) {
      const state = power.type === "none" ? "No power-up" : `${power.type} ${power.active ? power.timer.toFixed(1) + "s" : "ready"}`;
      const cooldown = power.remainingCooldown > 0 ? ` | CD ${power.remainingCooldown.toFixed(1)}s` : "";
      this.powerHud.textContent = `Power: ${state}${cooldown}`;
    }

    const standings = this.cars
      .map((car) => {
        const lap = this.world.getComponent<LapCounter>(car.id, "lap");
        const transform = this.world.getComponent<Transform>(car.id, "transform");
        if (!lap || !transform) return { name: car.name, progress: 0, color: car.color };
        const progress = lap.lap * 1000 + lap.checkpoint * 10 + transform.position[2];
        return { name: car.name, progress, color: car.color };
      })
      .sort((a, b) => b.progress - a.progress);

    this.leaderboardHud.innerHTML = "";
    standings.forEach((entry, i) => {
      const li = document.createElement("li");
      li.textContent = `${i + 1}. ${entry.name}`;
      li.style.color = entry.color;
      this.leaderboardHud.appendChild(li);
      if (entry.name === "Player") {
        this.posHud.textContent = `Position ${i + 1}/${standings.length}`;
      }
    });
  }

  private toggleReplay(): void {
    if (this.replayIndicator.style.display === "none") {
      this.replayIndicator.style.display = "block";
      this.rendering.setReplay(this.replay.frames);
      this.replay.recording = false;
    } else {
      this.replayIndicator.style.display = "none";
      this.rendering.clearReplay();
      this.replay.reset();
    }
  }
}
