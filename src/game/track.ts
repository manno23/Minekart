import trackJson from "../assets/track.json";
import type { Vec3 } from "../utils/math";

export interface TrackNode extends Array<number> {
  0: number;
  1: number;
  2: number;
}

export interface TrackRamp {
  position: Vec3;
  forward: Vec3;
  width: number;
  length: number;
  height: number;
}

export interface TrackRumble {
  p1: Vec3;
  p2: Vec3;
}

export interface TrackHazard {
  type: string;
  position: Vec3;
  radius: number;
}

export interface TrackItemPad {
  position: Vec3;
}

export interface TrackData {
  name: string;
  version: number;
  units: string;
  seed: number;
  laps: number;
  start: { position: Vec3; forward: Vec3 };
  nodes: TrackNode[];
  checkpoints: Array<{ index: number; width: number }>;
  finishLine: { p1: Vec3; p2: Vec3 };
  ramps: TrackRamp[];
  rumbleStrips: TrackRumble[];
  hazards: TrackHazard[];
  itemPads: TrackItemPad[];
}

export const TRACK_DATA = trackJson as TrackData;
