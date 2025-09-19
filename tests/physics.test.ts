import { describe, expect, it } from "vitest";
import { World } from "../src/ecs/world";
import type { Transform, RigidBody, PlayerInput, PowerUp } from "../src/ecs/components";
import { PhysicsSystem } from "../src/game/racePhase";
import { vec3 } from "../src/utils/math";

const createWorld = () => {
  const world = new World();
  const entity = world.createEntity();
  world.addComponent<Transform>(entity, "transform", { position: vec3(), rotation: vec3() });
  world.addComponent<RigidBody>(entity, "rigidBody", {
    velocity: vec3(),
    angularVelocity: vec3(),
    mass: 150,
    drag: 1,
    inertia: 120,
    onGround: true,
    baseMass: 150,
    baseDrag: 1
  });
  world.addComponent<PlayerInput>(entity, "playerInput", { throttle: 1, brake: 0, steer: 0, usePower: false });
  world.addComponent<PowerUp>(entity, "powerUp", { type: "none", timer: 0, cooldown: 0, active: false, remainingCooldown: 0 });
  return { world, entity };
};

describe("physics system", () => {
  it("produces deterministic steps", () => {
    const { world: a, entity: entityA } = createWorld();
    const { world: b, entity: entityB } = createWorld();
    const physics = new PhysicsSystem({ fixedDt: 1 / 120 });
    for (let i = 0; i < 240; i++) {
      physics.update(a, 1 / 120);
      physics.update(b, 1 / 120);
    }
    const transformA = a.getComponent<Transform>(entityA, "transform");
    const transformB = b.getComponent<Transform>(entityB, "transform");
    expect(transformA).toBeTruthy();
    expect(transformB).toBeTruthy();
    expect(transformA?.position[2]).toBeCloseTo(transformB?.position[2] ?? 0, 5);
    expect(transformA?.position[0]).toBeCloseTo(transformB?.position[0] ?? 0, 5);
  });
});
