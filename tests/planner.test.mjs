import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPlan, inspectSource, parseArgs, validateOptions } from "../scripts/plan-animation-forge.mjs";

async function withSource(extension, callback) {
  const directory = await mkdtemp(join(tmpdir(), "animation-forge-plan-"));
  try {
    const source = join(directory, `source${extension}`);
    await writeFile(source, Buffer.from("authorized-test-source"));
    await callback({ directory, source, facts: await inspectSource(source) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function baseArgs(source) {
  return [
    "--source-file", source,
    "--goal", "cinematic-video",
    "--fidelity", "source-locked",
    "--source-style", "animation-frame",
    "--subject-topology", "animal",
    "--scene-mode", "dynamic",
    "--rights-confirmed",
  ];
}

test("source-locked video with Seedance alone remains candidate-only", async () => {
  await withSource(".mp4", async ({ source, facts }) => {
    const options = parseArgs([...baseArgs(source), "--available-adapter", "seedance"]);
    const plan = buildPlan(options, facts);
    assert.equal(plan.status, "source_lock_candidate_only");
    assert.equal(plan.createsPaidTask, false);
    assert.equal(plan.creates3dAsset, false);
    assert.match(plan.nextAction, /candidate-only/);
    assert.ok(plan.warnings.some((warning) => /Kling is ineligible/.test(warning)));
  });
});

test("frame-exact stays blocked when any deterministic capability is missing", async () => {
  await withSource(".mp4", async ({ source, facts }) => {
    const args = baseArgs(source);
    args[args.indexOf("source-locked")] = "frame-exact";
    const options = parseArgs([
      ...args,
      "--available-adapter", "anigen",
      "--available-adapter", "blender",
      "--available-adapter", "segmentation-tracking",
      "--available-adapter", "camera-solver",
    ]);
    const plan = buildPlan(options, facts);
    assert.equal(plan.status, "frame_exact_blocked");
    assert.ok(plan.blockers.some((blocker) => blocker.stage === "motion-solve" && blocker.missingAll.includes("pose-depth-solver")));
  });
});

test("complete declared deterministic capabilities produce only a plan", async () => {
  await withSource(".mp4", async ({ source, facts }) => {
    const args = baseArgs(source);
    args[args.indexOf("source-locked")] = "frame-exact";
    const options = parseArgs([
      ...args,
      "--available-adapter", "anigen",
      "--available-adapter", "blender",
      "--available-adapter", "segmentation-tracking",
      "--available-adapter", "pose-depth-solver",
      "--available-adapter", "camera-solver",
      "--available-adapter", "compositor",
      "--available-adapter", "seedance",
    ]);
    const plan = buildPlan(options, facts);
    assert.equal(plan.status, "pipeline_planned");
    assert.equal(plan.creates3dAsset, false);
    assert.equal(plan.createsPaidTask, false);
    assert.equal(plan.blockers.length, 0);
  });
});

test("flat humanoid drawings route to DrawingSpinUp with explicit license warning", async () => {
  await withSource(".png", async ({ source, facts }) => {
    const options = parseArgs([
      "--source-file", source,
      "--goal", "rigged-asset",
      "--fidelity", "source-locked",
      "--source-style", "flat-drawing",
      "--subject-topology", "humanoid",
      "--scene-mode", "none",
      "--available-adapter", "drawingspinup",
      "--available-adapter", "blender",
      "--rights-confirmed",
    ]);
    const plan = buildPlan(options, facts);
    assert.equal(plan.geometryRoute.primary, "drawingspinup");
    assert.ok(plan.warnings.some((warning) => /license is unverified/.test(warning)));
  });
});

test("Gaussian Splatting is optional only for static multi-view scenes and warns for commercial use", async () => {
  await withSource(".mp4", async ({ source, facts }) => {
    const options = parseArgs([
      ...baseArgs(source).map((value) => value === "dynamic" ? "static" : value),
      "--multi-view-evidence",
      "--commercial-use",
      "--available-adapter", "gaussian-splatting",
      "--available-adapter", "seedance",
    ]);
    const plan = buildPlan(options, facts);
    const scene = plan.stages.find((item) => item.id === "scene-camera");
    assert.deepEqual(scene.optional, ["gaussian-splatting"]);
    assert.ok(plan.warnings.some((warning) => /non-commercial/.test(warning)));
  });
});

test("planner validates incompatible contracts and adapter names", () => {
  assert.throws(() => validateOptions(parseArgs([
    "--source-file", "source.png",
    "--goal", "rigged-asset",
    "--fidelity", "appearance-first",
    "--source-style", "flat-drawing",
    "--subject-topology", "humanoid",
    "--scene-mode", "none",
  ])), /cannot satisfy/);
  assert.throws(() => validateOptions(parseArgs([
    "--source-file", "source.png",
    "--goal", "rigged-asset",
    "--fidelity", "source-locked",
    "--source-style", "flat-drawing",
    "--subject-topology", "humanoid",
    "--scene-mode", "none",
    "--available-adapter", "imaginary-one-click-model",
  ])), /--available-adapter must be one of/);
});
