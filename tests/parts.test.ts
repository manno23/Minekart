import { describe, expect, it } from "vitest";
import { getPartRegistry, parsePartsCsv } from "../src/data/parts";
import partsCsvRaw from "../src/assets/parts_catalog.csv?raw";

describe("parts registry", () => {
  it("parses CSV data", () => {
    const records = parsePartsCsv(partsCsvRaw);
    expect(records.length).toBeGreaterThan(10);
    const wheel = records.find((part) => part.name === "Medium Wheel 2.0x");
    expect(wheel?.category).toBe("wheel");
    expect(wheel?.mass).toBeGreaterThan(1);
  });

  it("provides lookup by name", () => {
    const registry = getPartRegistry();
    const ballast = registry.byName.get("Ballast Cube 1x1x1 (dense)");
    expect(ballast?.category).toBe("ballast");
    expect(registry.byCategory.get("aero")?.length).toBeGreaterThan(3);
  });
});
