import partsCsvRaw from "../assets/parts_catalog.csv?raw";

type PartCategory =
  | "chassis"
  | "wheel"
  | "aero"
  | "armor"
  | "drive"
  | "ballast"
  | "suspension"
  | "utility";

export interface Part {
  name: string;
  category: PartCategory;
  length_blocks: number;
  width_blocks: number;
  height_blocks: number;
  mass: number;
  drag_coeff: number;
  grip_coeff: number;
  durability: number;
  allowed_mounts: string;
  notes: string;
}

export interface PartRegistry {
  list: Part[];
  byName: Map<string, Part>;
  byCategory: Map<PartCategory, Part[]>;
}

export const parsePartsCsv = (csv: string): Part[] => {
  const [headerLine, ...rows] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const required = [
    "name",
    "category",
    "length_blocks",
    "width_blocks",
    "height_blocks",
    "mass",
    "drag_coeff",
    "grip_coeff",
    "durability",
    "allowed_mounts",
    "notes"
  ];
  for (const key of required) {
    if (!headers.includes(key)) {
      throw new Error(`Missing column ${key} in parts CSV`);
    }
  }

  const records: Part[] = [];
  for (const row of rows) {
    if (!row.trim()) {
      continue;
    }
    const values = row.split(",");
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = values[i] ?? "";
    });
    records.push({
      name: record.name,
      category: record.category as PartCategory,
      length_blocks: Number(record.length_blocks),
      width_blocks: Number(record.width_blocks),
      height_blocks: Number(record.height_blocks),
      mass: Number(record.mass),
      drag_coeff: Number(record.drag_coeff),
      grip_coeff: Number(record.grip_coeff),
      durability: Number(record.durability),
      allowed_mounts: record.allowed_mounts,
      notes: record.notes
    });
  }
  return records;
};

const registry: PartRegistry = (() => {
  const list = parsePartsCsv(partsCsvRaw);
  const byName = new Map<string, Part>();
  const byCategory = new Map<PartCategory, Part[]>();
  for (const part of list) {
    byName.set(part.name, part);
    const bucket = byCategory.get(part.category) ?? [];
    bucket.push(part);
    byCategory.set(part.category, bucket);
  }
  for (const [key, bucket] of byCategory.entries()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
    byCategory.set(key, bucket);
  }
  return { list, byName, byCategory };
})();

export const getPartRegistry = (): PartRegistry => registry;

export const findPart = (name: string): Part | undefined => registry.byName.get(name);

export const partMounts = (part: Part): string[] => part.allowed_mounts.split(";").map((v) => v.trim());

export const partProjectedArea = (part: Part): number => part.length_blocks * part.width_blocks;
