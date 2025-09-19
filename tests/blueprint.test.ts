import { describe, expect, it } from "vitest";
import { deserializeBlueprint, serializeBlueprint, type Blueprint } from "../src/game/blueprint";
import preset from "../src/game/presets";

describe("blueprint serialization", () => {
  it("round trips data", () => {
    const base: Blueprint = preset[0];
    const json = serializeBlueprint(base);
    const restored = deserializeBlueprint(json);
    expect(restored.parts.length).toBe(base.parts.length);
    expect(restored.tuning.diff).toBe(base.tuning.diff);
  });
});
