# Minekart: Voxel Sprint

A two-phase voxel racer that blends a timed car construction phase with a hazard-strewn sprint inspired by classic kart racers, now presented through a full 3D preview in the garage and a chase-cam perspective during the race. Build your machine from the supplied parts catalog, then launch into a high-downforce dash against mixed-behaviour AI opponents.

## Quickstart

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Start the local dev server** (Vite)
   ```bash
   npm run dev
   ```
   Visit [http://localhost:5173](http://localhost:5173) in your browser.
3. **Create a production build**
   ```bash
   npm run build
   ```

Vitest unit tests live in the `tests/` directory and can be executed with `npm test`.

## Build Phase

* 120-second timer with audible cues in the HUD.
* Searchable, category-aware palette sourced from `src/assets/parts_catalog.csv`.
* Grid-snapped editor with mirror toggle, rotation control, and height slider.
* Live 3D preview renders your current build with subtle lighting so you can judge proportions while placing parts.
* Symmetry validator and live stats panel for mass, CG height, drag, wheelbase, and more.
* Preset loader for the recommended **Wedge-Glide v1** blueprint.
* Allowed mount checks that honour `allowed_mounts` from the CSV.
* Lock the build to serialize a race-ready blueprint.

### Tuning Tips

* Keep heavy parts low (`Ballast Cube`) to reduce CG height and increase stability.
* Use `Outrigger Beam` to widen track width for bump resistance.
* Add `Tailplane`/`Winglet` surfaces for exaggerated aero stability on ramps.
* Swap to `Soft Tire` for more grip when planning aggressive driving, but expect higher drag.

## Race Phase

* Three-lap sprint on **Hazard Loop – Seed A** featuring curbs, ramps, debris and rumble strips.
* Five AI rivals (three clean racers, two aggressive rammers) using a seeded, deterministic planner.
* Item pads roll power-ups and display cooldowns in the HUD.
* Fixed-step physics (120 Hz) with drag, grip, and aero exaggeration.
* 3D chase camera with depth-sorted track rendering, ramps, hazards, and ghost overlays.
* Replay system with best-lap ghost (`R` to toggle) and deterministic seeding for repeatable runs.

### Controls

| Action | Key |
| ------ | --- |
| Throttle | `W` |
| Brake/Reverse | `S` |
| Steer | `A` / `D` |
| Use Power-up | `Space` |
| Toggle Replay | `R` |

### Power-ups

* **Dragon Wings** – +lift & +downforce for 3s, improved glide stability, 10s cooldown.
* **Toad** – 30% lighter, 25% less drag, rammer-disrupting slip aura for 2s, 12s cooldown.

## Extending the Game

* **Add Parts** – Edit `src/assets/parts_catalog.csv`. The build palette and physics registry update automatically on reload.
* **Add Presets** – Drop additional blueprints in `src/game/presets.ts` or import JSON via the build phase.
* **Modify Track** – Adjust `src/assets/track.json`. Nodes, checkpoints, ramps, and hazards are hot-loaded at start.

Enjoy the ride, and tweak the aero to taste!
