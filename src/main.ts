import "./style.css";
import { BuildPhase } from "./build/buildPhase";
import type { Blueprint } from "./game/blueprint";
import { RacePhase } from "./game/racePhase";

const app = document.getElementById("app");
if (!app) {
  throw new Error("App container missing");
}

const header = document.createElement("header");
const title = document.createElement("h1");
const phaseIndicator = document.createElement("span");
phaseIndicator.className = "phase-indicator";
title.textContent = "Minekart: Voxel Sprint";
phaseIndicator.textContent = "Build Phase";
header.appendChild(title);
header.appendChild(phaseIndicator);

const main = document.createElement("main");
app.appendChild(header);
app.appendChild(main);

let buildPhase: BuildPhase | null = null;
let racePhase: RacePhase | null = null;

const buildContainer = document.createElement("div");
main.appendChild(buildContainer);

const startRace = (blueprint: Blueprint) => {
  phaseIndicator.textContent = "Race Phase";
  buildContainer.innerHTML = "";
  if (buildPhase) {
    buildPhase.dispose();
    buildPhase = null;
  }
  const raceContainer = document.createElement("div");
  main.innerHTML = "";
  main.appendChild(raceContainer);
  racePhase = new RacePhase(raceContainer, {
    onComplete() {
      phaseIndicator.textContent = "Race Complete";
    }
  });
  racePhase.start(blueprint);
};

const startBuild = () => {
  phaseIndicator.textContent = "Build Phase";
  main.innerHTML = "";
  main.appendChild(buildContainer);
  buildContainer.innerHTML = "";
  buildPhase = new BuildPhase(buildContainer, {
    onComplete(blueprint) {
      startRace(blueprint);
    }
  });
};

startBuild();
