#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const GOALS = new Set(["cinematic-video", "rigged-asset", "blender-scene", "stylized-animation"]);
export const FIDELITIES = new Set(["source-locked", "frame-exact", "appearance-first"]);
export const SOURCE_STYLES = new Set(["flat-drawing", "animation-frame", "render", "photo"]);
export const SUBJECT_TOPOLOGIES = new Set(["humanoid", "animal", "mechanical", "mixed"]);
export const SCENE_MODES = new Set(["none", "static", "dynamic"]);
export const ADAPTERS = new Set([
  "anigen", "drawingspinup", "img2threejs", "wonder3d", "zero123",
  "gaussian-splatting", "mesh2motion", "blender", "seedance", "kling", "veo",
  "animatediff-depth", "segmentation-tracking", "pose-depth-solver",
  "camera-solver", "compositor",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);

export function usage() {
  return `HiAPI Animation Forge - Offline Pipeline Planner

Usage:
  node scripts/plan-animation-forge.mjs --source-file PATH --goal GOAL --fidelity CONTRACT --source-style STYLE --subject-topology TYPE --scene-mode MODE --rights-confirmed [options]

Required:
  --source-file PATH
  --goal cinematic-video|rigged-asset|blender-scene|stylized-animation
  --fidelity source-locked|frame-exact|appearance-first
  --source-style flat-drawing|animation-frame|render|photo
  --subject-topology humanoid|animal|mechanical|mixed
  --scene-mode none|static|dynamic
  --rights-confirmed

Options:
  --available-adapter NAME   Repeat only for an executable, pinned and license-reviewed adapter
  --multi-view-evidence     Confirm genuine multi-view scene evidence exists
  --commercial-use         Apply commercial-use license gates
  --output PATH            Save the same JSON plan to a local file
  --help                   Show this help

This command is offline. It creates no 3D asset and no paid model task.`;
}

export function parseArgs(args) {
  const options = { availableAdapters: [] };
  const valueFlags = new Map([
    ["--source-file", "sourceFile"], ["--goal", "goal"], ["--fidelity", "fidelity"],
    ["--source-style", "sourceStyle"], ["--subject-topology", "subjectTopology"],
    ["--scene-mode", "sceneMode"], ["--output", "output"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--rights-confirmed") options.rightsConfirmed = true;
    else if (arg === "--multi-view-evidence") options.multiViewEvidence = true;
    else if (arg === "--commercial-use") options.commercialUse = true;
    else if (arg === "--available-adapter") {
      options.availableAdapters.push(requireValue(args, index, arg));
      index += 1;
    } else if (valueFlags.has(arg)) {
      options[valueFlags.get(arg)] = requireValue(args, index, arg);
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function validateChoice(value, values, flag) {
  if (!values.has(value)) throw new Error(`${flag} must be one of: ${[...values].join(", ")}.`);
}

export function validateOptions(options) {
  for (const key of ["sourceFile", "goal", "fidelity", "sourceStyle", "subjectTopology", "sceneMode"]) {
    if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required.`);
  }
  validateChoice(options.goal, GOALS, "--goal");
  validateChoice(options.fidelity, FIDELITIES, "--fidelity");
  validateChoice(options.sourceStyle, SOURCE_STYLES, "--source-style");
  validateChoice(options.subjectTopology, SUBJECT_TOPOLOGIES, "--subject-topology");
  validateChoice(options.sceneMode, SCENE_MODES, "--scene-mode");
  for (const adapter of options.availableAdapters) validateChoice(adapter, ADAPTERS, "--available-adapter");
  if (options.fidelity === "appearance-first" && options.goal === "rigged-asset") {
    throw new Error("appearance-first is a video-render contract and cannot satisfy --goal rigged-asset.");
  }
  if (options.multiViewEvidence && options.sceneMode === "none") {
    throw new Error("--multi-view-evidence requires --scene-mode static or dynamic.");
  }
}

function inferSourceKind(path) {
  const extension = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  throw new Error(`Unsupported source extension: ${extension || "(none)"}.`);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolvePromise);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export async function inspectSource(path) {
  const resolved = resolve(path);
  const facts = await stat(resolved);
  if (!facts.isFile() || facts.size === 0) throw new Error("--source-file must be a non-empty local file.");
  return {
    name: basename(resolved),
    kind: inferSourceKind(resolved),
    bytes: facts.size,
    sha256: await sha256File(resolved),
  };
}

function geometryRoute(options) {
  if (options.subjectTopology === "mixed") {
    return { primary: "split-assets", candidates: ["anigen", "wonder3d", "img2threejs"], note: "Split organic and mechanical assets; no single adapter owns the shot." };
  }
  if (options.sourceStyle === "flat-drawing" && options.subjectTopology === "humanoid") {
    return { primary: "drawingspinup", candidates: ["drawingspinup", "anigen"], note: "DrawingSpinUp requires an isolated drawing and foreground mask; its external rig/retarget and license gates remain." };
  }
  if (options.subjectTopology === "mechanical") {
    return { primary: "img2threejs", candidates: ["img2threejs", "anigen", "wonder3d"], note: "Prefer code-first hierarchy for articulated props; use mesh reconstruction only when procedural geometry is insufficient." };
  }
  return { primary: "anigen", candidates: ["anigen", "wonder3d"], note: "AniGen is the primary rigged-asset research candidate; Wonder3D can provide a static mesh or view evidence only." };
}

function stage(id, purpose, requirements = {}, gate = "human review required") {
  const { requiredAll = [], requiredAny = [], optional = [] } = requirements;
  return { id, purpose, requiredAll, requiredAny, optional, gate };
}

export function buildPlan(options, source) {
  validateOptions(options);
  const available = new Set(options.availableAdapters);
  const geometry = geometryRoute(options);
  const stages = [
    stage("intake", "Bind rights, source hash, media facts and shot boundaries", {}, "rights and clean-source gate"),
    stage("analysis", "Build stable asset IDs, source-lock timeline, bibles and uncertainty map", { optional: ["segmentation-tracking"] }, "identity and screen-geography gate"),
    stage("evidence", "Extract masks, clean plates and character/object views", {
      requiredAll: source.kind === "video" ? ["segmentation-tracking"] : [],
      optional: ["wonder3d", "zero123"],
    }, "evidence sufficiency gate"),
    stage("geometry", geometry.note, {
      requiredAny: geometry.primary === "split-assets" ? geometry.candidates : [geometry.primary],
      optional: geometry.candidates.filter((name) => name !== geometry.primary),
    }, "silhouette, unseen-side and topology gate"),
    stage("rig", "Create or validate skeleton, skin weights, rest pose and sockets", {
      requiredAny: geometry.primary === "anigen" ? ["anigen"] : ["blender", "mesh2motion"],
      optional: ["mesh2motion"],
    }, "deformation and detached-part gate"),
  ];

  if (options.sceneMode !== "none") {
    const sceneOptional = options.sceneMode === "static" && options.multiViewEvidence ? ["gaussian-splatting"] : [];
    stages.push(stage("scene-camera", "Build scene scale, tracked camera, materials, lights and occlusion", {
      requiredAll: ["blender"], optional: sceneOptional,
    }, "framing, parallax and scale gate"));
  }

  if (source.kind === "video" && options.fidelity !== "appearance-first") {
    stages.push(stage("motion-solve", "Solve frame-addressable pose/depth, contacts, prop ownership and camera motion", {
      requiredAll: ["pose-depth-solver", "camera-solver"], optional: ["anigen"],
    }, "source-lock timing and contact gate"));
  }

  if (options.fidelity !== "appearance-first" || options.goal !== "stylized-animation") {
    stages.push(stage("deterministic-preview", "Render a frame-addressable Blender preview before generative finishing", {
      requiredAll: options.fidelity === "frame-exact" ? ["blender", "compositor"] : ["blender"],
      optional: options.fidelity === "frame-exact" ? [] : ["compositor"],
    }, "full source-lock preview gate"));
  }

  const eligibleRenderers = options.fidelity === "appearance-first" ? ["kling", "seedance", "veo"] : ["seedance"];
  if (options.goal === "cinematic-video" || options.goal === "stylized-animation") {
    stages.push(stage("final-render", options.fidelity === "appearance-first"
      ? "Generate new motion from approved appearance references"
      : "Generate an optional candidate after deterministic preview; preserve the source-lock acceptance contract",
    options.fidelity === "appearance-first"
      ? { requiredAny: eligibleRenderers, optional: ["animatediff-depth"] }
      : { optional: eligibleRenderers },
    "paid preflight, approval and full-video QC"));
  }

  const missing = stages.flatMap((item) => {
    const missingAll = item.requiredAll.filter((name) => !available.has(name));
    const missesAny = item.requiredAny.length > 0 && !item.requiredAny.some((name) => available.has(name));
    if (missingAll.length === 0 && !missesAny) return [];
    return [{ stage: item.id, missingAll, requiredAny: missesAny ? item.requiredAny : [] }];
  });
  const warnings = [];
  if (options.sceneMode === "dynamic" && options.multiViewEvidence) warnings.push("Gaussian Splatting remains ineligible for deforming characters or a materially dynamic environment.");
  if (options.commercialUse && available.has("gaussian-splatting")) warnings.push("The reference Gaussian Splatting implementation is non-commercial; remove it or obtain explicit permission.");
  if (available.has("drawingspinup")) warnings.push("DrawingSpinUp license is unverified and its documented workflow includes external Mixamo/Rokoko steps.");
  if (available.has("anigen")) warnings.push("AniGen requires a pinned Linux/CUDA/checkpoint environment and third-party license review before commercial use.");
  if (options.fidelity !== "appearance-first") warnings.push("Kling is ineligible because it does not receive or synchronize to the source video.");

  let status;
  if (!options.rightsConfirmed) status = "authorization_required";
  else if (options.fidelity === "frame-exact" && missing.length > 0) status = "frame_exact_blocked";
  else if (options.fidelity === "source-locked" && missing.length > 0 && available.has("seedance")) status = "source_lock_candidate_only";
  else if (missing.length > 0) status = "external_setup_required";
  else status = "pipeline_planned";

  return {
    schemaVersion: 1,
    product: "HiAPI Animation Forge",
    status,
    createsPaidTask: false,
    creates3dAsset: false,
    source,
    request: {
      goal: options.goal,
      fidelity: options.fidelity,
      sourceStyle: options.sourceStyle,
      subjectTopology: options.subjectTopology,
      sceneMode: options.sceneMode,
      multiViewEvidence: Boolean(options.multiViewEvidence),
      commercialUse: Boolean(options.commercialUse),
    },
    geometryRoute: geometry,
    availableAdapters: [...available].sort(),
    stages,
    blockers: options.rightsConfirmed ? missing : [{ stage: "intake", requiredAny: ["rights-confirmation"] }, ...missing],
    warnings,
    nextAction: status === "source_lock_candidate_only"
      ? "Either configure the missing deterministic stages or run a free Seedance balanced preflight and keep the result candidate-only until source-lock QC."
      : status === "pipeline_planned"
        ? "Execute each external stage in order and stop at every artifact gate; this plan is not evidence that any stage completed."
        : "Resolve every blocker before execution or pricing.",
  };
}

export async function main(args = process.argv.slice(2), deps = {}) {
  const print = deps.print || console.log;
  const options = parseArgs(args);
  if (options.help) {
    print(usage());
    return;
  }
  validateOptions(options);
  const source = await inspectSource(options.sourceFile);
  const plan = buildPlan(options, source);
  const json = `${JSON.stringify(plan, null, 2)}\n`;
  if (options.output) await writeFile(resolve(options.output), json, { encoding: "utf8", flag: "wx" });
  print(json.trimEnd());
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
