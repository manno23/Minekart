export interface BlueprintPart {
  partName: string;
  position: [number, number, number];
  rotation: [0 | 90 | 180 | 270, 0 | 90 | 180 | 270, 0 | 90 | 180 | 270];
  mirrored?: boolean;
}

export interface BlueprintBallast {
  position: [number, number, number];
  qty: number;
}

export type DifferentialSetting = "open" | "locked";

export interface Blueprint {
  parts: BlueprintPart[];
  tuning: {
    wheelbase: number;
    track: number;
    toeFront: number;
    toeRear: number;
    ballast: BlueprintBallast[];
    diff: DifferentialSetting;
  };
}

export const serializeBlueprint = (blueprint: Blueprint): string => JSON.stringify(blueprint);

export const deserializeBlueprint = (data: string): Blueprint => JSON.parse(data) as Blueprint;
