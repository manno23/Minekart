import { getPartRegistry, partMounts, type Part } from "../data/parts";
import type { Blueprint, BlueprintPart } from "../game/blueprint";
import PRESETS from "../game/presets";
import { add, clamp, rotateYaw, scale, toFixed, vec3, type Vec3 } from "../utils/math";
import { createCameraSpace, projectPoint, type CameraSpace, type ProjectedPoint } from "../utils/camera";
import { darken, lighten } from "../utils/color";

const BUILD_DURATION_SECONDS = 120;

interface BuildCallbacks {
  onComplete(blueprint: Blueprint): void;
}

interface Placement extends BlueprintPart {
  part: Part;
}

const STARTER_MASS = 120;
const STARTER_DRAG = 0.6;

const STARTER_MOUNTS: Array<{ position: Vec3; tag: string }> = [
  { position: [-2, 0, -3], tag: "front_axle" },
  { position: [2, 0, -3], tag: "front_axle" },
  { position: [-2, 0, 3], tag: "axle" },
  { position: [2, 0, 3], tag: "axle" }
];

const rotationSequence: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];

const inferPlacementTags = (position: Vec3): string[] => {
  const [x, y, z] = position;
  const tags = new Set<string>(["any"]);
  if (y <= 0.5) tags.add("underside");
  if (y >= 2.5) tags.add("roof");
  if (z <= -2) tags.add("nose");
  if (z >= 2) tags.add("tail");
  if (Math.abs(x) >= 2) tags.add("sides");
  if (Math.abs(x) >= 2 && z >= 2) tags.add("rear_corners");
  if (Math.abs(x) >= 2 && z <= -2) tags.add("front_corners");
  if (Math.abs(z) <= 1.5) tags.add("between_axles");
  if (Math.abs(z) <= 0.5) tags.add("center");
  if (z <= -2) tags.add("front");
  if (z >= 2) tags.add("rear");
  if (Math.abs(x) <= 1.5) tags.add("spine");
  if (Math.abs(z) >= 2.2) tags.add("axle");
  if (z <= -2.2) tags.add("front_axle");
  if (z >= 2.2) tags.add("rear_axle");
  return Array.from(tags);
};

const computeStats = (placements: Placement[]) => {
  let mass = STARTER_MASS;
  let drag = STARTER_DRAG;
  let weightedY = STARTER_MASS * 1.2;
  const wheelPositions: Vec3[] = [];
  let totalGrip = 0;
  for (const placement of placements) {
    mass += placement.part.mass;
    drag += placement.part.drag_coeff;
    weightedY += placement.part.mass * placement.position[1];
    if (placement.part.category === "wheel") {
      wheelPositions.push(placement.position);
      totalGrip += placement.part.grip_coeff;
    }
  }
  const cgHeight = weightedY / mass;
  let track = 0;
  let wheelbase = 0;
  if (wheelPositions.length >= 2) {
    let minX = wheelPositions[0][0];
    let maxX = wheelPositions[0][0];
    let minZ = wheelPositions[0][2];
    let maxZ = wheelPositions[0][2];
    for (const pos of wheelPositions) {
      minX = Math.min(minX, pos[0]);
      maxX = Math.max(maxX, pos[0]);
      minZ = Math.min(minZ, pos[2]);
      maxZ = Math.max(maxZ, pos[2]);
    }
    track = maxX - minX;
    wheelbase = maxZ - minZ;
  }
  const estimatedTopSpeed = clamp(46 - drag * 40 + totalGrip * 5, 24, 58);
  const stabilityHint = cgHeight <= 1.8
    ? "CG low: launch ready"
    : cgHeight <= 2.3
    ? "CG balanced: mind ramps"
    : "High CG: add ballast low";
  return {
    mass,
    drag,
    cgHeight,
    track,
    wheelbase,
    estimatedTopSpeed,
    stabilityHint,
    wheelCount: wheelPositions.length
  };
};

const toBlueprint = (placements: Placement[]): Blueprint => ({
  parts: placements.map((p) => ({
    partName: p.part.name,
    position: p.position,
    rotation: p.rotation,
    mirrored: p.mirrored
  })),
  tuning: {
    wheelbase: 8,
    track: 12,
    toeFront: -0.5,
    toeRear: 0,
    ballast: [],
    diff: "locked"
  }
});

export class BuildPhase {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private previewCanvas: HTMLCanvasElement;
  private previewCtx: CanvasRenderingContext2D;
  private previewCamera: CameraSpace;
  private placements: Placement[] = [];
  private selected: Part | null = null;
  private hoverCell: Vec3 | null = null;
  private height = 1;
  private rotationIndex = 0;
  private mirrorMode = false;
  private timerHandle: number | null = null;
  private drawHandle: number | null = null;
  private endTime: number;
  private callbacks: BuildCallbacks;
  private registry = getPartRegistry();
  private statusLabel: HTMLDivElement;
  private statsList: HTMLDivElement;
  private symmetryLabel: HTMLDivElement;
  private timerLabel: HTMLSpanElement;
  private canvasRect: DOMRect;
  private scale = 28;
  private offset: Vec3 = [0, 0, 0];
  private paletteList: HTMLDivElement;
  private categoryFilter: string = "all";
  private searchTerm = "";

  constructor(root: HTMLElement, callbacks: BuildCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.root.innerHTML = "";
    this.root.appendChild(this.buildLayout());
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas context unavailable");
    }
    this.ctx = ctx;
    const previewCtx = this.previewCanvas.getContext("2d");
    if (!previewCtx) {
      throw new Error("Preview context unavailable");
    }
    this.previewCtx = previewCtx;
    this.previewCamera = createCameraSpace({
      position: vec3(16, 14, -18),
      target: vec3(0, 2.2, 0),
      up: vec3(0, 1, 0),
      fov: Math.PI / 3,
      near: 0.2,
      far: 160
    });
    this.canvasRect = this.canvas.getBoundingClientRect();
    this.endTime = performance.now() + BUILD_DURATION_SECONDS * 1000;
    this.attachEvents();
    this.updatePalette();
    this.updateStats();
    this.draw();
    this.setStatus("Select a part to begin voxelizing your chassis.");
  }

  dispose(): void {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    if (this.drawHandle !== null) {
      window.clearInterval(this.drawHandle);
      this.drawHandle = null;
    }
  }

  private buildLayout(): HTMLElement {
    const container = document.createElement("div");
    container.className = "build-phase";

    const palette = document.createElement("section");
    palette.className = "palette";
    const paletteHeader = document.createElement("h2");
    paletteHeader.textContent = "Parts";
    palette.appendChild(paletteHeader);

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search parts";
    search.addEventListener("input", () => {
      this.searchTerm = search.value.toLowerCase();
      this.updatePalette();
    });
    palette.appendChild(search);

    const categories = document.createElement("div");
    categories.className = "category-select";
    const categoryKeys = ["all", ...new Set(this.registry.list.map((p) => p.category))];
    categoryKeys.forEach((category) => {
      const button = document.createElement("button");
      button.textContent = category.toString();
      button.addEventListener("click", () => {
        this.categoryFilter = category.toString();
        this.updatePalette();
      });
      categories.appendChild(button);
    });
    palette.appendChild(categories);

    this.paletteList = document.createElement("div");
    this.paletteList.className = "parts-list";
    palette.appendChild(this.paletteList);

    const editor = document.createElement("section");
    editor.className = "editor-surface";
    this.canvas = document.createElement("canvas");
    this.canvas.width = 900;
    this.canvas.height = 680;
    editor.appendChild(this.canvas);

    const controls = document.createElement("div");
    controls.className = "controls";
    const mirrorBtn = document.createElement("button");
    mirrorBtn.textContent = "Mirror Mode: Off";
    mirrorBtn.addEventListener("click", () => {
      this.mirrorMode = !this.mirrorMode;
      mirrorBtn.textContent = this.mirrorMode ? "Mirror Mode: On" : "Mirror Mode: Off";
      this.setStatus(this.mirrorMode ? "Mirroring across centerline." : "Single-sided placement.");
    });
    controls.appendChild(mirrorBtn);

    const rotateBtn = document.createElement("button");
    rotateBtn.textContent = "Rotate 90°";
    rotateBtn.addEventListener("click", () => {
      this.rotationIndex = (this.rotationIndex + 1) % rotationSequence.length;
    });
    controls.appendChild(rotateBtn);

    const heightLabel = document.createElement("label");
    heightLabel.textContent = "Height";
    const heightInput = document.createElement("input");
    heightInput.type = "range";
    heightInput.min = "0";
    heightInput.max = "5";
    heightInput.value = "1";
    heightInput.addEventListener("input", () => {
      this.height = Number(heightInput.value);
    });
    const heightWrap = document.createElement("div");
    heightWrap.appendChild(heightLabel);
    heightWrap.appendChild(heightInput);
    controls.appendChild(heightWrap);

    editor.appendChild(controls);

    const stats = document.createElement("section");
    stats.className = "stats-panel";
    const statsHeader = document.createElement("h2");
    statsHeader.textContent = "Vehicle Stats";
    stats.appendChild(statsHeader);

    const previewTitle = document.createElement("h3");
    previewTitle.className = "preview-title";
    previewTitle.textContent = "3D Preview";
    stats.appendChild(previewTitle);

    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.width = 260;
    this.previewCanvas.height = 180;
    this.previewCanvas.className = "preview-canvas";
    stats.appendChild(this.previewCanvas);

    this.statsList = document.createElement("div");
    this.statsList.className = "stat-grid";
    stats.appendChild(this.statsList);

    this.symmetryLabel = document.createElement("div");
    this.symmetryLabel.className = "symmetry-status";
    stats.appendChild(this.symmetryLabel);

    const presetsWrap = document.createElement("div");
    const presetBtn = document.createElement("button");
    presetBtn.textContent = "Load Wedge-Glide v1";
    presetBtn.addEventListener("click", () => {
      this.loadPreset();
    });
    presetsWrap.appendChild(presetBtn);
    stats.appendChild(presetsWrap);

    const finalizeBtn = document.createElement("button");
    finalizeBtn.textContent = "Lock Build & Race";
    finalizeBtn.addEventListener("click", () => this.complete());
    stats.appendChild(finalizeBtn);

    const status = document.createElement("div");
    status.className = "symmetry-status";
    this.statusLabel = status;
    stats.appendChild(status);

    container.appendChild(palette);
    container.appendChild(editor);
    container.appendChild(stats);

    const footer = document.createElement("div");
    footer.className = "footer";
    const timer = document.createElement("span");
    timer.className = "timer";
    footer.appendChild(timer);
    this.timerLabel = timer;
    const tips = document.createElement("span");
    tips.textContent = "WASD = drive | Space = power-up | R = replay";
    footer.appendChild(tips);
    this.root.appendChild(footer);

    this.timerHandle = window.setInterval(() => this.updateTimer(), 200);

    return container;
  }

  private updateTimer(): void {
    const now = performance.now();
    const remaining = Math.max(0, this.endTime - now);
    const seconds = Math.ceil(remaining / 1000);
    this.timerLabel.textContent = `Build Timer: ${seconds}s`;
    if (remaining <= 0) {
      this.complete();
    }
  }

  private updatePalette(): void {
    this.paletteList.innerHTML = "";
    const list = this.registry.list.filter((part) => {
      const categoryMatch = this.categoryFilter === "all" || part.category === this.categoryFilter;
      const searchMatch = !this.searchTerm || part.name.toLowerCase().includes(this.searchTerm);
      return categoryMatch && searchMatch;
    });
    list.forEach((part) => {
      const card = document.createElement("div");
      card.className = "part-card";
      if (this.selected?.name === part.name) {
        card.classList.add("active");
      }
      const name = document.createElement("strong");
      name.textContent = part.name;
      const notes = document.createElement("span");
      notes.textContent = part.notes;
      const stats = document.createElement("span");
      stats.textContent = `Mass ${part.mass.toFixed(1)} | Drag ${part.drag_coeff.toFixed(2)} | Grip ${part.grip_coeff.toFixed(2)}`;
      card.appendChild(name);
      card.appendChild(notes);
      card.appendChild(stats);
      card.addEventListener("click", () => {
        this.selected = part;
        this.updatePalette();
        this.setStatus(`Selected ${part.name}. Place with left click, remove with right click.`);
      });
      this.paletteList.appendChild(card);
    });
  }

  private attachEvents(): void {
    this.canvas.addEventListener("mousemove", (event) => {
      const pos = this.canvasPositionToGrid(event.offsetX, event.offsetY);
      this.hoverCell = pos;
    });
    this.canvas.addEventListener("mouseleave", () => {
      this.hoverCell = null;
    });
    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const pos = this.canvasPositionToGrid(event.offsetX, event.offsetY);
      this.removePlacement(pos);
    });
    this.canvas.addEventListener("click", (event) => {
      if (!this.selected) return;
      const pos = this.canvasPositionToGrid(event.offsetX, event.offsetY);
      this.placePart(pos);
    });
    this.drawHandle = window.setInterval(() => this.draw(), 60);
  }

  private canvasPositionToGrid(x: number, y: number): Vec3 {
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    const gridX = Math.round((x - centerX - this.offset[0]) / this.scale);
    const gridZ = Math.round((y - centerY - this.offset[2]) / this.scale);
    return [gridX, this.height, gridZ];
  }

  private placePart(position: Vec3): void {
    const part = this.selected;
    if (!part) return;
    if (!this.canPlace(part, position)) {
      return;
    }
    const rotation = rotationSequence[this.rotationIndex];
    const placement: Placement = {
      part,
      partName: part.name,
      position: [...position] as Vec3,
      rotation: [0, rotation, 0],
      mirrored: false
    };
    this.placements.push(placement);
    if (this.mirrorMode && Math.abs(position[0]) > 0.001) {
      const mirrored: Placement = {
        part,
        partName: part.name,
        position: [-position[0], position[1], position[2]],
        rotation: [0, (360 - rotation) % 360 as 0 | 90 | 180 | 270, 0],
        mirrored: true
      };
      if (this.canPlace(part, mirrored.position, true)) {
        this.placements.push(mirrored);
      }
    }
    this.updateStats();
    this.draw();
  }

  private canPlace(part: Part, position: Vec3, mirrored = false): boolean {
    const tags = inferPlacementTags(position);
    const allowed = partMounts(part);
    const isAllowed = allowed.includes("any") || allowed.some((tag) => tags.includes(tag));
    if (!isAllowed) {
      this.setStatus(`Cannot mount ${part.name} at ${tags.join(", ")}. Allowed: ${allowed.join("/")}.`);
      return false;
    }
    const exists = this.placements.some(
      (placement) => placement.part.name === part.name && placement.position[0] === position[0] && placement.position[1] === position[1] && placement.position[2] === position[2]
    );
    if (exists) {
      this.setStatus("That cell is already occupied.");
      return false;
    }
    if (!mirrored && part.category === "wheel") {
      const axleCount = this.placements.filter((p) => p.part.category === "wheel" && Math.abs(p.position[2] - position[2]) < 0.1).length;
      if (axleCount >= 2) {
        this.setStatus("Axle already has two wheels. Consider different z.");
        return false;
      }
    }
    this.setStatus(`${part.name} placed.`);
    return true;
  }

  private removePlacement(position: Vec3): void {
    const before = this.placements.length;
    this.placements = this.placements.filter((placement) => !(placement.position[0] === position[0] && placement.position[1] === position[1] && placement.position[2] === position[2]));
    if (this.placements.length !== before) {
      this.setStatus(`Removed placement at ${position.join(",")}.`);
      this.updateStats();
      this.draw();
    }
  }

  private loadPreset(): void {
    const [preset] = PRESETS;
    if (!preset) return;
    this.placements = preset.parts
      .map((part) => {
        const data = this.registry.byName.get(part.partName);
        if (!data) return null;
        return {
          part: data,
          partName: data.name,
          position: [...part.position] as Vec3,
          rotation: [...part.rotation],
          mirrored: part.mirrored
        } as Placement;
      })
      .filter((p): p is Placement => p !== null);
    this.setStatus("Preset loaded. Tweak to taste.");
    this.updateStats();
    this.draw();
  }

  private updateStats(): void {
    const stats = computeStats(this.placements);
    this.statsList.innerHTML = `
      <div>Mass</div><div>${stats.mass.toFixed(1)} kg</div>
      <div>CG Height</div><div>${toFixed(stats.cgHeight, 2)} blocks</div>
      <div>Track Width</div><div>${toFixed(stats.track, 2)} blocks</div>
      <div>Wheelbase</div><div>${toFixed(stats.wheelbase, 2)} blocks</div>
      <div>Drag Sum</div><div>${toFixed(stats.drag, 2)}</div>
      <div>Est. Top Speed</div><div>${stats.estimatedTopSpeed.toFixed(1)} u/s</div>
      <div>Wheels</div><div>${stats.wheelCount}</div>
      <div>Stability</div><div>${stats.stabilityHint}</div>
    `;

    const actualKeys = new Set(
      this.placements.map(
        (placement) =>
          `${placement.part.name}|${placement.position[0].toFixed(3)}|${placement.position[1].toFixed(3)}|${placement.position[2].toFixed(3)}|${placement.rotation[0]}|${placement.rotation[1]}|${placement.rotation[2]}`
      )
    );
    const symmetric = this.placements.every((placement) => {
      if (Math.abs(placement.position[0]) <= 0.01) return true;
      const mirroredKey = `${placement.part.name}|${(-placement.position[0]).toFixed(3)}|${placement.position[1].toFixed(3)}|${placement.position[2].toFixed(3)}|${placement.rotation[0]}|${placement.rotation[1]}|${placement.rotation[2]}`;
      return actualKeys.has(mirroredKey);
    });
    this.symmetryLabel.textContent = symmetric ? "Symmetry check: OK" : "Symmetry warning: consider mirroring key mass.";
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    ctx.save();
    ctx.translate(centerX + this.offset[0], centerY + this.offset[2]);

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let x = -18; x <= 18; x++) {
      ctx.beginPath();
      ctx.moveTo(x * this.scale, -18 * this.scale);
      ctx.lineTo(x * this.scale, 18 * this.scale);
      ctx.stroke();
    }
    for (let z = -18; z <= 18; z++) {
      ctx.beginPath();
      ctx.moveTo(-18 * this.scale, z * this.scale);
      ctx.lineTo(18 * this.scale, z * this.scale);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.moveTo(0, -18 * this.scale);
    ctx.lineTo(0, 18 * this.scale);
    ctx.stroke();

    for (const mount of STARTER_MOUNTS) {
      ctx.fillStyle = "rgba(124,92,255,0.6)";
      ctx.beginPath();
      ctx.arc(mount.position[0] * this.scale, mount.position[2] * this.scale, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const placement of this.placements) {
      const color = placement.part.category === "wheel" ? "#7cfcff" : placement.part.category === "aero" ? "#ff8fd6" : "#7cff7c";
      ctx.fillStyle = color;
      ctx.fillRect(
        placement.position[0] * this.scale - 12,
        placement.position[2] * this.scale - 12,
        24,
        24
      );
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.font = "10px monospace";
      ctx.fillText(placement.part.name.replace(/[^A-Z]/g, "").slice(0, 3), placement.position[0] * this.scale - 11, placement.position[2] * this.scale + 3);
    }

    if (this.hoverCell) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.strokeRect(this.hoverCell[0] * this.scale - 14, this.hoverCell[2] * this.scale - 14, 28, 28);
    }

    ctx.restore();
    this.drawPreview();
  }

  private drawPreview(): void {
    const ctx = this.previewCtx;
    const canvas = this.previewCanvas;
    const camera = this.previewCamera;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0f172a");
    gradient.addColorStop(1, "#020617");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const floorCorners = [vec3(-8, 0, -8), vec3(8, 0, -8), vec3(8, 0, 8), vec3(-8, 0, 8)];
    const projectedFloor = floorCorners
      .map((corner) => projectPoint(corner, camera, width, height))
      .filter((point): point is ProjectedPoint => point !== null);
    if (projectedFloor.length === floorCorners.length) {
      ctx.beginPath();
      ctx.moveTo(projectedFloor[0].x, projectedFloor[0].y);
      for (let i = 1; i < projectedFloor.length; i++) {
        ctx.lineTo(projectedFloor[i].x, projectedFloor[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(31, 41, 55, 0.85)";
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.lineWidth = 1;
    for (let g = -8; g <= 8; g++) {
      const lineStart = projectPoint(vec3(g, 0.02, -8), camera, width, height);
      const lineEnd = projectPoint(vec3(g, 0.02, 8), camera, width, height);
      if (lineStart && lineEnd) {
        ctx.beginPath();
        ctx.moveTo(lineStart.x, lineStart.y);
        ctx.lineTo(lineEnd.x, lineEnd.y);
        ctx.stroke();
      }
      const crossStart = projectPoint(vec3(-8, 0.02, g), camera, width, height);
      const crossEnd = projectPoint(vec3(8, 0.02, g), camera, width, height);
      if (crossStart && crossEnd) {
        ctx.beginPath();
        ctx.moveTo(crossStart.x, crossStart.y);
        ctx.lineTo(crossEnd.x, crossEnd.y);
        ctx.stroke();
      }
    }

    if (this.hoverCell) {
      const [hx, , hz] = this.hoverCell;
      const hoverCorners = [
        vec3(hx - 0.5, 0.03, hz - 0.5),
        vec3(hx + 0.5, 0.03, hz - 0.5),
        vec3(hx + 0.5, 0.03, hz + 0.5),
        vec3(hx - 0.5, 0.03, hz + 0.5)
      ];
      const projectedHover = hoverCorners
        .map((corner) => projectPoint(corner, camera, width, height))
        .filter((point): point is ProjectedPoint => point !== null);
      if (projectedHover.length === hoverCorners.length) {
        ctx.beginPath();
        ctx.moveTo(projectedHover[0].x, projectedHover[0].y);
        for (let i = 1; i < projectedHover.length; i++) {
          ctx.lineTo(projectedHover[i].x, projectedHover[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(124, 92, 255, 0.18)";
        ctx.fill();
      }
    }

    const faces: Array<{ points: ProjectedPoint[]; depth: number; color: string }> = [];

    const baseColor = "#334155";
    const baseTop = [vec3(-3.5, 0.6, -6), vec3(3.5, 0.6, -6), vec3(3.5, 0.6, 6), vec3(-3.5, 0.6, 6)];
    const baseWalls = [
      [vec3(-3.5, 0.6, -6), vec3(3.5, 0.6, -6), vec3(3.5, 0, -6), vec3(-3.5, 0, -6)],
      [vec3(3.5, 0.6, -6), vec3(3.5, 0.6, 6), vec3(3.5, 0, 6), vec3(3.5, 0, -6)],
      [vec3(-3.5, 0.6, 6), vec3(-3.5, 0.6, -6), vec3(-3.5, 0, -6), vec3(-3.5, 0, 6)],
      [vec3(-3.5, 0.6, 6), vec3(3.5, 0.6, 6), vec3(3.5, 0, 6), vec3(-3.5, 0, 6)]
    ];

    const baseTopProjected = baseTop
      .map((corner) => projectPoint(corner, camera, width, height))
      .filter((point): point is ProjectedPoint => point !== null);
    if (baseTopProjected.length === baseTop.length) {
      const depth = baseTopProjected.reduce((sum, p) => sum + p.depth, 0) / baseTopProjected.length;
      faces.push({ points: baseTopProjected, depth, color: lighten(baseColor, 0.1) });
    }
    for (const wall of baseWalls) {
      const projected = wall
        .map((corner) => projectPoint(corner, camera, width, height))
        .filter((point): point is ProjectedPoint => point !== null);
      if (projected.length !== wall.length) continue;
      const depth = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
      faces.push({ points: projected, depth, color: darken(baseColor, 0.1) });
    }

    const up = vec3(0, 1, 0);
    for (const placement of this.placements) {
      const part = placement.part;
      const color = this.colorForPart(part);
      const yaw = (placement.rotation[1] * Math.PI) / 180;
      const forward = rotateYaw([0, 0, 1], yaw);
      const right = rotateYaw([1, 0, 0], yaw);
      const center = placement.position;
      const halfLength = Math.max(0.45, part.length_blocks / 2);
      const halfWidth = Math.max(0.45, part.width_blocks / 2);
      const halfHeight = Math.max(0.45, part.height_blocks / 2);

      const compose = (f: number, r: number, u: number): Vec3 =>
        add(add(add(center, scale(forward, f)), scale(right, r)), scale(up, u));

      const topFrontRight = compose(halfLength, halfWidth, halfHeight);
      const topFrontLeft = compose(halfLength, -halfWidth, halfHeight);
      const topRearLeft = compose(-halfLength, -halfWidth, halfHeight);
      const topRearRight = compose(-halfLength, halfWidth, halfHeight);
      const bottomFrontRight = compose(halfLength, halfWidth, -halfHeight);
      const bottomFrontLeft = compose(halfLength, -halfWidth, -halfHeight);
      const bottomRearLeft = compose(-halfLength, -halfWidth, -halfHeight);
      const bottomRearRight = compose(-halfLength, halfWidth, -halfHeight);

      const partFaces: Array<{ corners: Vec3[]; tint: string }> = [
        { corners: [topFrontLeft, topFrontRight, topRearRight, topRearLeft], tint: lighten(color, 0.2) },
        { corners: [topFrontRight, bottomFrontRight, bottomRearRight, topRearRight], tint: darken(color, 0.15) },
        { corners: [topFrontLeft, topRearLeft, bottomRearLeft, bottomFrontLeft], tint: darken(color, 0.2) },
        { corners: [topFrontLeft, bottomFrontLeft, bottomFrontRight, topFrontRight], tint: lighten(color, 0.05) },
        { corners: [topRearLeft, topRearRight, bottomRearRight, bottomRearLeft], tint: darken(color, 0.25) }
      ];

      for (const face of partFaces) {
        const projected = face.corners
          .map((corner) => projectPoint(corner, camera, width, height))
          .filter((point): point is ProjectedPoint => point !== null);
        if (projected.length !== face.corners.length) continue;
        const depth = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
        faces.push({ points: projected, depth, color: face.tint });
      }
    }

    faces.sort((a, b) => b.depth - a.depth);
    for (const face of faces) {
      ctx.beginPath();
      ctx.moveTo(face.points[0].x, face.points[0].y);
      for (let i = 1; i < face.points.length; i++) {
        ctx.lineTo(face.points[i].x, face.points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = face.color;
      ctx.fill();
    }

    for (const mount of STARTER_MOUNTS) {
      const marker = projectPoint(vec3(mount.position[0], 0.7, mount.position[2]), camera, width, height);
      if (!marker) continue;
      ctx.fillStyle = "rgba(124, 92, 255, 0.8)";
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private colorForPart(part: Part): string {
    switch (part.category) {
      case "wheel":
        return "#7cfcff";
      case "aero":
        return "#ff8fd6";
      case "armor":
        return "#f97316";
      case "drive":
        return "#facc15";
      case "ballast":
        return "#94a3b8";
      case "suspension":
        return "#4ade80";
      case "utility":
        return "#38bdf8";
      default:
        return "#7cff7c";
    }
  }

  private setStatus(message: string): void {
    this.statusLabel.textContent = message;
  }

  private complete(): void {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    if (this.drawHandle !== null) {
      window.clearInterval(this.drawHandle);
      this.drawHandle = null;
    }
    const blueprint = toBlueprint(this.placements);
    this.callbacks.onComplete(blueprint);
  }
}
