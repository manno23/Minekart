import type { Vec3 } from "../utils/math";

export interface Transform {
  position: Vec3;
  rotation: Vec3;
}

export interface RigidBody {
  velocity: Vec3;
  angularVelocity: Vec3;
  mass: number;
  drag: number;
  inertia: number;
  onGround: boolean;
  baseMass: number;
  baseDrag: number;
}

export interface WheelState {
  radius: number;
  grip: number;
  drive: boolean;
  steer: boolean;
  axleOffset: number;
}

export interface Wheel {
  wheels: WheelState[];
}

export interface Mount {
  mountType: string;
  position: Vec3;
}

export interface AeroSurface {
  area: number;
  dragCoeff: number;
  liftCoeff: number;
  pitchStab: number;
  yawStab: number;
}

export interface Armor {
  durability: number;
  integrity: number;
}

export interface Ballast {
  mass: number;
  position: Vec3;
}

export type PowerUpKind = "none" | "dragonWings" | "toad";

export interface PowerUp {
  type: PowerUpKind;
  timer: number;
  cooldown: number;
  active: boolean;
  remainingCooldown: number;
}

export interface PlayerInput {
  throttle: number;
  brake: number;
  steer: number;
  usePower: boolean;
}

export type AIBehavior = "clean" | "rammer";

export interface AIController {
  behavior: AIBehavior;
  targetNode: number;
  aggression: number;
  seed: number;
  cooldown: number;
}

export interface LapCounter {
  lap: number;
  totalLaps: number;
  checkpoint: number;
  time: number;
  bestLap: number;
}

export type ComponentKey =
  | "transform"
  | "rigidBody"
  | "wheel"
  | "mount"
  | "aero"
  | "armor"
  | "ballast"
  | "powerUp"
  | "playerInput"
  | "ai"
  | "lap";

export const COMPONENT_KEYS: Record<ComponentKey, ComponentKey> = {
  transform: "transform",
  rigidBody: "rigidBody",
  wheel: "wheel",
  mount: "mount",
  aero: "aero",
  armor: "armor",
  ballast: "ballast",
  powerUp: "powerUp",
  playerInput: "playerInput",
  ai: "ai",
  lap: "lap"
};
