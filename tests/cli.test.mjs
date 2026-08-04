import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  APPROVAL_TTL_SECONDS,
  MAX_PROMPT_CHARACTERS,
  MIN_IMAGE_DIMENSION,
  MODEL,
  STYLE_CONTROL_DEFAULTS,
  buildConversionPrompt,
  buildRequest,
  createApprovalToken,
  credentialFingerprint,
  enforceBudget,
  estimateCostUsd,
  extractFrameFromVideo,
  idempotencyKeyForApproval,
  inspectMp4Buffer,
  inspectRasterBuffer,
  isMp4Buffer,
  main,
  parseApprovalToken,
  parseArgs,
  parseEnvText,
  redactPayload,
  requestHash,
  resolveRenderControls,
  submitTask,
  validateExecutionMode,
  workflowRequestHash,
  writeSubmissionJournal,
} from "../scripts/hiapi-2d-to-3d-video.mjs";

const TEST_API_KEY = "fake-test-key";
const OTHER_API_KEY = "different-fake-test-key";
const TEST_CREDENTIAL = credentialFingerprint(TEST_API_KEY);

function box(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function syntheticMp4({ seconds = 8, width = 1920, height = 1080 } = {}) {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, tkhd.length - 8);
  tkhd.writeUInt32BE(height * 65536, tkhd.length - 4);
  return Buffer.concat([
    box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2")])),
    box("moov", Buffer.concat([box("mvhd", mvhd), box("trak", box("tkhd", tkhd))])),
    box("mdat", Buffer.from([0, 1, 2, 3])),
  ]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function syntheticPng({ width = 640, height = 360, shade = 80 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 4] = shade;
      row[1 + x * 4 + 1] = (shade + 40) % 256;
      row[1 + x * 4 + 2] = (shade + 80) % 256;
      row[1 + x * 4 + 3] = 255;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function frameResult(bytes, timestampSeconds = 0) {
  const raster = inspectRasterBuffer(bytes);
  return {
    url: `data:${raster.mime};base64,${bytes.toString("base64")}`,
    facts: {
      type: "video-extracted-local",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: raster.width,
      height: raster.height,
      timestampSeconds,
    },
  };
}

function baseArgs(storyboardImageFile = "storyboard.png", realWorldStartImageFile = "real-world-start.png") {
  return [
    "--storyboard-image-file", storyboardImageFile,
    "--real-world-start-image-file", realWorldStartImageFile,
    "--action-description", "The character walks forward, catches one foot on a raised curb, stumbles, and falls onto both hands.",
    "--real-world-scene", "A real urban sidewalk with weathered concrete, natural daylight, believable scale, and grounded contact shadows.",
    "--subject-map", "animated cat protagonist => real living gray domestic shorthair cat with natural fur, whiskers, paws, and the same role",
    "--asset-rights-confirmed",
    "--real-world-start-image-approved",
  ];
}

async function withTempMedia(callback, sourceOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "hiapi-kling-2d3d-"));
  const source = join(directory, "storyboard.png");
  const realWorldStart = join(directory, "real-world-start.png");
  const envFile = join(directory, ".env");
  await writeFile(source, syntheticPng(sourceOptions));
  await writeFile(realWorldStart, syntheticPng({ ...sourceOptions, shade: 150 }));
  await writeFile(envFile, `HIAPI_API_KEY=${TEST_API_KEY}\n`);
  try {
    return await callback({ directory, source, realWorldStart, envFile });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function pricing(unitPrice = 0.1, policies = []) {
  return { data: [{ model_name: MODEL, factors: ["duration"], base_usd_value: unitPrice, policies }] };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

test("argument parser separates storyboard inputs from the real-world start image", () => {
  const options = parseArgs([
    ...baseArgs(),
    "--camera-description", "Low tracking shot from the side",
    "--storyboard-frame-seconds", "0.2",
    "--ffmpeg-path", "D:\\tools\\ffmpeg.exe",
    "--subject-map", "boy => real living human child with natural skin and the same role",
    "--subject-map", "curb => real physical concrete curb with weathered aggregate",
    "--preview",
  ]);
  assert.deepEqual(options.characterMaps, ["animated cat protagonist => real living gray domestic shorthair cat with natural fur, whiskers, paws, and the same role", "boy => real living human child with natural skin and the same role", "curb => real physical concrete curb with weathered aggregate"]);
  assert.equal(options.sourceFrameSeconds, 0.2);
  assert.equal(validateExecutionMode(options), "preview");
  assert.throws(() => parseArgs([...baseArgs(), "--target-images-approved", "--preview"]), /Unknown option/);
});

test("skill defaults video reconstruction to a source-locked acceptance contract", async () => {
  const skill = await readFile(new URL("../SKILL.md", import.meta.url), "utf8");
  const fidelity = await readFile(new URL("../references/temporal-fidelity.md", import.meta.url), "utf8");
  const sourceLock = await readFile(new URL("../references/source-lock.md", import.meta.url), "utf8");
  assert.match(skill, /Default every supplied source video to `source-locked`/);
  assert.match(skill, /Seedance 2\.0 `balanced` only as a generative candidate/);
  assert.match(skill, /Never use Seedance `replace` for whole-world reconstruction/);
  assert.match(skill, /Never use Kling for a source-locked request/);
  assert.match(skill, /--reference-video-file/);
  assert.match(skill, /--reference-image-file/);
  assert.doesNotMatch(skill, /--replacement-image-file "D:\\media/);
  assert.match(fidelity, /The dry-run does not call HiAPI pricing/);
  assert.match(fidelity, /subject\/background segmentation, temporal masks, tracked subject IDs/);
  assert.match(sourceLock, /source_lock_rejected/);
  assert.match(sourceLock, /frame_exact_blocked/);
  assert.match(sourceLock, /No missing, invented, reordered, or duplicated event/);
});

test("Kling video storyboards require explicit appearance-first acknowledgement", async () => {
  const options = parseArgs([
    "--storyboard-video-file", "source.mp4",
    "--real-world-start-image-file", "real-world-start.png",
    "--action-description", "Walk forward.",
    "--real-world-scene", "A real room with physical materials, natural scale, and grounded contacts.",
    "--subject-map", "animated mouse => real living field mouse with natural fur and anatomy",
    "--asset-rights-confirmed",
    "--real-world-start-image-approved",
    "--preview",
  ]);
  await assert.rejects(() => buildRequest(options), /cannot satisfy source-locked synchronization/);
  assert.equal(parseArgs(["--appearance-first-acknowledged", "--preview"]).appearanceFirstAcknowledged, true);
});

test("render controls resolve style defaults and explicit overrides", () => {
  for (const [style, expected] of Object.entries(STYLE_CONTROL_DEFAULTS)) {
    assert.deepEqual(resolveRenderControls(style).controls, expected);
    assert.deepEqual(resolveRenderControls(style).overrides, []);
  }
  const resolved = resolveRenderControls("photoreal", { lighting: "dramatic", realism: 96 });
  assert.deepEqual(resolved.controls, { ...STYLE_CONTROL_DEFAULTS.photoreal, lighting: "dramatic", realism: 96 });
  assert.deepEqual(resolved.overrides, ["lighting", "realism"]);
  assert.throws(() => resolveRenderControls("stylized-cgi"), /Unsupported --style/);
  assert.throws(() => resolveRenderControls("photoreal", { surface: "glass" }), /Unsupported --surface/);
  assert.throws(() => parseArgs([...baseArgs(), "--realism", "101", "--preview"]), /integer from 0 to 100/);
});

test("execution mode and environment parsing reject ambiguity", () => {
  assert.throws(() => validateExecutionMode(parseArgs([...baseArgs(), "--preview", "--spend"])), /exactly one/);
  assert.deepEqual(parseEnvText("export HIAPI_API_KEY='secret'\nIGNORED\n"), { HIAPI_API_KEY: "secret" });
});

test("media inspectors validate MP4 and raster structure", () => {
  const mp4 = syntheticMp4({ seconds: 9, width: 1280, height: 720 });
  assert.equal(isMp4Buffer(mp4), true);
  assert.deepEqual(inspectMp4Buffer(mp4), { duration: 9, width: 1280, height: 720 });
  assert.deepEqual(inspectRasterBuffer(syntheticPng({ width: 12, height: 7 }))?.width, 12);
  assert.equal(inspectRasterBuffer(Buffer.from("not an image")), null);
});

test("prompt treats the real-world start image as the only Kling visual input", () => {
  const prompt = buildConversionPrompt({
    style: "photoreal",
    targetLook: "A real city sidewalk with weathered concrete and natural daylight",
    characterMaps: ["animated cat => real living gray domestic shorthair cat with natural fur and paws"],
    actionDescription: "Walk, trip on the curb, then fall forward.",
    cameraDescription: "Side tracking shot at waist height.",
    hasEndImage: false,
    extraPrompt: "Keep the curb position fixed.",
    audioEnabled: false,
  });
  assert.match(prompt, /approved photoreal opening still/);
  assert.match(prompt, /Hollywood-quality live-action cinematic/);
  assert.match(prompt, /never 3D-cartoon, Pixar, game-model, or plastic-CGI imagery/);
  assert.match(prompt, /Action: Walk, trip on the curb/);
  assert.match(prompt, /Camera: Side tracking shot/);
  assert.match(prompt, /Storyboard stays upstream/);
  assert.match(prompt, /surface=natural/);
  assert.match(prompt, /motion=physical/);
  assert.match(prompt, /preserve appearance, anatomy, fur\/skin detail, materials, environment, light, exposure, and cinematic color/);
  assert.match(prompt, /Natural breathing, restrained facial motion, realistic body physics/);
  assert.match(prompt, /no redesign, artificial animation, melting detail, or texture boiling/);
  assert.match(prompt, /Audio: none/);
  assert.ok(Array.from(prompt).length <= MAX_PROMPT_CHARACTERS);
  assert.doesNotMatch(prompt, /Video 1/);
});

test("photoreal prompts prohibit recreating the animation medium", () => {
  const prompt = buildConversionPrompt({
    style: "photoreal",
    targetLook: "A lived-in wooden room lit by a warm practical lamp and cool window bounce.",
    characterMaps: ["brown cartoon mouse => real living brown field mouse with short fur, whiskers, and realistic paws"],
    actionDescription: "The mouse takes two careful steps, pauses, and looks toward the doorway.",
    cameraDescription: "Static medium-wide side view; one continuous take.",
    hasEndImage: false,
    extraPrompt: "Do not retain the source illustration style.",
    audioEnabled: false,
  });
  assert.match(prompt, /never 3D-cartoon, Pixar, game-model, or plastic-CGI imagery/);
  assert.match(prompt, /no line art, flat fills, cel shading, cartoon anatomy/);
  assert.match(prompt, /physical identity/);
  assert.ok(Array.from(prompt).length <= MAX_PROMPT_CHARACTERS);
});

test("only the real-world start image enters the Kling image-to-video contract", async () => {
  await withTempMedia(async ({ source, realWorldStart }) => {
    const built = await buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--preview"]));
    assert.equal(built.payload.model, "kling-3.0-omni/image-to-video");
    assert.deepEqual(Object.keys(built.payload.input).sort(), ["duration", "image_urls", "prompt", "resolution", "sound"]);
    assert.equal(built.payload.input.duration, 5);
    assert.equal(built.payload.input.resolution, "720p");
    assert.equal(built.payload.input.sound, false);
    assert.equal(built.payload.input.image_urls.length, 1);
    assert.match(built.payload.input.image_urls[0], /^data:image\/png;base64,/);
    assert.equal(built.ratio, "16:9");
    assert.equal(built.sourceFacts.kind, "image");
    assert.equal(built.payload.input.image_urls[0].includes(Buffer.from(await readFile(source)).toString("base64")), false);
  });
});

test("storyboard video is locally hashed while Kling receives the separate real-world start image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hiapi-kling-video-"));
  try {
    const source = join(directory, "source.mp4");
    const realWorldStart = join(directory, "real-world-start.png");
    await writeFile(source, syntheticMp4({ seconds: 7, width: 1080, height: 1920 }));
    const frame = syntheticPng({ width: 360, height: 640 });
    await writeFile(realWorldStart, syntheticPng({ width: 360, height: 640, shade: 140 }));
    const calls = [];
    const built = await buildRequest(parseArgs([
      "--storyboard-video-file", source,
      "--real-world-start-image-file", realWorldStart,
      "--action-description", "Walk forward and trip.",
      "--real-world-scene", "A real sidewalk with rough concrete, natural scale, and motivated daylight.",
      "--subject-map", "animated cat => real living domestic shorthair cat with natural fur and paws",
      "--asset-rights-confirmed",
      "--real-world-start-image-approved",
      "--appearance-first-acknowledged",
      "--preview",
    ]), {
      extractFrameImpl: async (path, seconds, executable) => {
        calls.push({ path, seconds, executable });
        return frameResult(frame, seconds);
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].seconds, 0.25);
    assert.equal(calls[0].executable, "ffmpeg");
    assert.equal(built.sourceFacts.duration, 7);
    assert.equal(built.sourceFacts.kind, "video");
    assert.equal(built.approvalBinding.appearanceFirstAcknowledged, true);
    assert.equal(built.rightsConfirmation.appearanceFirstAcknowledged, true);
    assert.equal(built.sourceFrameFacts.type, "video-extracted-local");
    assert.equal(built.payload.input.duration, 7);
    assert.equal(built.payload.input.image_urls.length, 1);
    assert.equal(built.ratio, "9:16");
    assert.match(built.warnings.join(" "), /storyboard video.*not/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ffmpeg extraction uses a shell-free deterministic argument list", async () => {
  const frame = syntheticPng({ width: 4, height: 3 });
  let observed;
  const result = await extractFrameFromVideo("relative-source.mp4", 0.125, "custom-ffmpeg", {
    runFfmpeg: async (executable, args) => {
      observed = { executable, args };
      return frame;
    },
  });
  assert.equal(observed.executable, "custom-ffmpeg");
  assert.deepEqual(observed.args.slice(0, 6), ["-hide_banner", "-loglevel", "error", "-ss", "0.125", "-i"]);
  assert.equal(observed.args.at(-1), "pipe:1");
  assert.equal(result.facts.timestampSeconds, 0.125);
});

test("workflow approval binds source-video bytes even when extracted frame is unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hiapi-kling-binding-"));
  try {
    const source = join(directory, "source.mp4");
    const realWorldStart = join(directory, "real-world-start.png");
    const frame = syntheticPng();
    const args = [
      "--storyboard-video-file", source,
      "--real-world-start-image-file", realWorldStart,
      "--action-description", "Walk and fall.",
      "--real-world-scene", "A real street with concrete, natural light, physical scale, and contact shadows.",
      "--subject-map", "animated cat => real living domestic cat with natural fur and paws",
      "--asset-rights-confirmed",
      "--real-world-start-image-approved",
      "--appearance-first-acknowledged",
      "--preview",
    ];
    const deps = { extractFrameImpl: async (_path, seconds) => frameResult(frame, seconds) };
    await writeFile(source, syntheticMp4({ width: 1920, height: 1080 }));
    await writeFile(realWorldStart, syntheticPng({ shade: 150 }));
    const first = await buildRequest(parseArgs(args), deps);
    await writeFile(source, syntheticMp4({ width: 1280, height: 720 }));
    const second = await buildRequest(parseArgs(args), deps);
    assert.equal(requestHash(first.payload), requestHash(second.payload));
    assert.notEqual(workflowRequestHash(first), workflowRequestHash(second));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("request validates action, media dimensions, audio, duration, resolution, and first/last ratio", async () => {
  await withTempMedia(async ({ directory, source, realWorldStart }) => {
    await assert.rejects(() => buildRequest(parseArgs(["--storyboard-image-file", source, "--real-world-start-image-file", realWorldStart, "--asset-rights-confirmed", "--real-world-start-image-approved", "--preview"])), /action-description/);
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--sound", "soft footsteps", "--preview"])), /--sound requires --audio/);
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--resolution", "480p", "--preview"])), /supports 720p, 1080p, or 4K/);
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--resolution", "4K", "--preview"])), /premium-resolution-approved/);
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--seconds", "2", "--preview"])), /integer from 3 to 15/);
    const tooSmall = join(directory, "too-small.png");
    await writeFile(tooSmall, syntheticPng({ width: MIN_IMAGE_DIMENSION, height: MIN_IMAGE_DIMENSION - 1 }));
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(tooSmall, realWorldStart), "--preview"])), /at least 300px wide and high/);
    await assert.rejects(
      () => buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--prompt", "x".repeat(MAX_PROMPT_CHARACTERS), "--preview"])),
      /Compiled Kling prompt is .* stay within 2500/,
    );
    const end = join(directory, "end.png");
    await writeFile(end, syntheticPng({ width: 360, height: 640 }));
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--end-image-file", end, "--preview"])), /same aspect ratio/);
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(source, source), "--preview"])), /separately reconstructed/);
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--subject-map", "animated cat => cartoon cat", "--preview"])), /real or living physical counterpart/);
  });
});

test("optional end frame produces two Kling images and 4K uses canonical spelling", async () => {
  await withTempMedia(async ({ directory, source, realWorldStart }) => {
    const end = join(directory, "end.png");
    await writeFile(end, syntheticPng({ width: 640, height: 360, shade: 140 }));
    const built = await buildRequest(parseArgs([
      ...baseArgs(source, realWorldStart),
      "--end-image-file", end,
      "--resolution", "4k",
      "--premium-resolution-approved",
      "--audio",
      "--sound", "Footsteps and one soft impact",
      "--preview",
    ]));
    assert.equal(built.payload.input.image_urls.length, 2);
    assert.equal(built.payload.input.resolution, "4K");
    assert.equal(built.payload.input.sound, true);
    assert.match(built.prompt, /Image 2 is the approved photoreal ending anchor/);
  });
});

test("optional end frame enforces Kling's minimum image dimensions", async () => {
  await withTempMedia(async ({ directory, source, realWorldStart }) => {
    const end = join(directory, "small-end.png");
    await writeFile(end, syntheticPng({ width: MIN_IMAGE_DIMENSION - 1, height: MIN_IMAGE_DIMENSION }));
    await assert.rejects(
      () => buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--end-image-file", end, "--preview"])),
      /End image must be at least 300px wide and high/,
    );
  });
});

test("production-sized conversion prompt stays inside Kling's single-shot limit", async () => {
  await withTempMedia(async ({ source, realWorldStart }) => {
    const built = await buildRequest(parseArgs([
      "--storyboard-image-file", source,
      "--real-world-start-image-file", realWorldStart,
      "--storyboard-duration", "8.4",
      "--action-description", "Starting at the left side of the frame, the small blue-gray mouse rides a folded white paper airplane rapidly toward the open doorway on the right while the larger brown mouse watches. The plane glides to a stop near the doorway and the small mouse steps off. The brown mouse dashes after him, brakes to a stop beside him, regains his upright posture, tosses a triangular yellow piece of cheese upward, catches it in his mouth and swallows it, then points toward the open doorway. The small mouse turns toward the doorway, pauses, and looks back at the brown mouse.",
      "--camera-description", "Static medium-wide side view matching the start composition; keep both mice, the paper airplane, floor, and open doorway readable; stable horizon; one continuous take; no pan, zoom, or cut.",
      "--style", "photoreal",
      "--surface", "natural",
      "--lighting", "cinematic",
      "--depth-strength", "strong",
      "--motion-fidelity", "physical",
      "--realism", "95",
      "--subject-map", "small blue-gray cartoon mouse => real living blue-gray field mouse with short fur, rosy inner ears, pale muzzle and belly, realistic paws, and the same smaller role",
      "--subject-map", "larger brown cartoon mouse => real living warm-brown field mouse with a tan muzzle and belly, large pink inner ears, realistic proportions, and the same larger role",
      "--real-world-scene", "A real lived-in wooden room with tactile wood grain, a folded paper airplane, cheese, warm practical interior light, natural shadows, physical scale, deep parallax, and grounded contact shadows; preserve the green doorway and warm color relationships.",
      "--seconds", "8",
      "--resolution", "720p",
      "--no-audio",
      "--asset-rights-confirmed",
      "--real-world-start-image-approved",
      "--preview",
    ]));
    assert.ok(Array.from(built.prompt).length <= MAX_PROMPT_CHARACTERS);
  });
});

test("redaction removes Kling input image values", () => {
  const redacted = redactPayload({ model: MODEL, input: { image_urls: ["secret-start", "secret-end"] } });
  assert.deepEqual(redacted.input.image_urls, ["[image 1 omitted]", "[image 2 omitted]"]);
  assert.equal(JSON.stringify(redacted).includes("secret"), false);
});

test("pricing chooses the most specific Kling sound policy", () => {
  const payload = { model: MODEL, input: { duration: 8, resolution: "720p", sound: false } };
  const live = pricing(0.2, [
    { rule: { resolution: { match: "720p" } }, pricing_type: "fixed", usd_value: 0.15 },
    { rule: { resolution: { match: "720p" }, sound: { match: false } }, pricing_type: "fixed", usd_value: 0.1 },
  ]);
  assert.equal(estimateCostUsd(live, payload), 0.8);
  assert.doesNotThrow(() => enforceBudget(0.8, 1));
  assert.throws(() => enforceBudget(0.8, 0.7), /exceeds/);
  assert.throws(
    () => estimateCostUsd(pricing(0.129, [
      { rule: { resolution: { match: "4K" } }, pricing_type: "fixed", usd_value: 0.479 },
    ]), { model: MODEL, input: { duration: 5, resolution: "4K", sound: true } }),
    /does not contain a sound-enabled policy/,
  );
});

test("approval token binds request, quote, account, expiry, and idempotency", () => {
  const hash = requestHash({ model: MODEL, input: { duration: 8 } });
  const now = Date.UTC(2026, 6, 29, 0, 0, 0);
  const approval = createApprovalToken("2d3d", hash, 0.8, TEST_CREDENTIAL, now);
  const parsed = parseApprovalToken(approval.token, "2d3d", hash, TEST_CREDENTIAL, now);
  const key = idempotencyKeyForApproval(undefined, parsed);
  assert.match(key, new RegExp(`^2d3d-${hash.slice(0, 12)}-`));
  assert.equal(idempotencyKeyForApproval(key, parsed), key);
  assert.throws(() => createApprovalToken("char3d", hash, 0.8, TEST_CREDENTIAL, now), /Unsupported approval stage/);
  assert.throws(() => parseApprovalToken(approval.token, "2d3d", "a".repeat(64), TEST_CREDENTIAL, now), /does not match/);
  assert.throws(() => parseApprovalToken(approval.token, "2d3d", hash, credentialFingerprint(OTHER_API_KEY), now), /different HiAPI credential/);
  assert.throws(() => parseApprovalToken(approval.token, "2d3d", hash, TEST_CREDENTIAL, now + APPROVAL_TTL_SECONDS * 1000), /expired/);
});

test("preview is offline and prints only redacted Kling media", async () => {
  await withTempMedia(async ({ source, realWorldStart }) => {
    const output = [];
    await main([...baseArgs(source, realWorldStart), "--preview"], {
      print: (value) => output.push(String(value)),
      fetchImpl: async () => { throw new Error("preview must not access network"); },
    });
    const result = JSON.parse(output.at(-1));
    assert.equal(result.model, MODEL);
    assert.equal(result.networkAccess, false);
    assert.equal(result.estimatedCostUsd, null);
    assert.equal(result.promptCharacters, Array.from(result.payload.input.prompt).length);
    assert.ok(result.promptCharacters <= MAX_PROMPT_CHARACTERS);
    assert.deepEqual(result.payload.input.image_urls, ["[image 1 omitted]"]);
    assert.equal(JSON.stringify(result).includes("data:image"), false);
    assert.equal(JSON.stringify(result).includes(source), false);
  });
});

test("dry-run reads Kling pricing but never creates a task", async () => {
  await withTempMedia(async ({ source, realWorldStart, envFile }) => {
    const seen = [];
    const output = [];
    await main([...baseArgs(source, realWorldStart), "--env-file", envFile, "--dry-run"], {
      print: (value) => output.push(String(value)),
      fetchImpl: async (url) => {
        seen.push(String(url));
        return jsonResponse(pricing(0.1));
      },
    });
    assert.deepEqual(seen, ["https://api.hiapi.ai/api/pricing"]);
    const result = JSON.parse(output.at(-1));
    assert.equal(result.estimatedCostUsd, 0.5);
    assert.equal(result.promptCharacters, Array.from(result.payload.input.prompt).length);
    assert.match(result.approvalToken, /^apv2\.2d3d\./);
    assert.match(result.idempotencyKey, /^2d3d-/);
  });
});

test("changed local source invalidates approval before pricing", async () => {
  await withTempMedia(async ({ source, realWorldStart, envFile }) => {
    const args = [...baseArgs(source, realWorldStart), "--env-file", envFile];
    const built = await buildRequest(parseArgs([...args, "--preview"]));
    const now = Date.UTC(2026, 6, 29, 0, 0, 0);
    const approval = createApprovalToken("2d3d", workflowRequestHash(built), 0.5, TEST_CREDENTIAL, now);
    await writeFile(source, syntheticPng({ shade: 160 }));
    await assert.rejects(
      () => main([...args, "--spend", "--approval-token", approval.token], {
        now: () => now,
        fetchImpl: async () => { throw new Error("pricing must not run after media drift"); },
      }),
      /does not match the current request/,
    );
  });
});

test("invalid source raster and legacy approval fail before submission", async () => {
  await withTempMedia(async ({ directory, source, realWorldStart, envFile }) => {
    const invalid = join(directory, "invalid.png");
    await writeFile(invalid, Buffer.from("not an image"));
    await assert.rejects(() => buildRequest(parseArgs([...baseArgs(invalid), "--preview"])), /structurally valid/);
    const built = await buildRequest(parseArgs([...baseArgs(source, realWorldStart), "--preview"]));
    await assert.rejects(
      () => main([...baseArgs(source, realWorldStart), "--env-file", envFile, "--spend", "--approved-request-hash", workflowRequestHash(built)], {
        fetchImpl: async () => { throw new Error("legacy approval must stay offline"); },
      }),
      /legacy approval/,
    );
  });
});

test("price increase above approved Kling quote blocks task submission", async () => {
  await withTempMedia(async ({ source, realWorldStart, envFile }) => {
    const args = [...baseArgs(source, realWorldStart), "--env-file", envFile];
    const built = await buildRequest(parseArgs([...args, "--preview"]));
    const now = Date.UTC(2026, 6, 29, 0, 0, 0);
    const approval = createApprovalToken("2d3d", workflowRequestHash(built), 0.5, TEST_CREDENTIAL, now);
    const seen = [];
    await assert.rejects(
      () => main([...args, "--spend", "--approval-token", approval.token], {
        now: () => now,
        fetchImpl: async (url) => {
          seen.push(String(url));
          return jsonResponse(pricing(0.11));
        },
      }),
      /exceeds the approved quote/,
    );
    assert.deepEqual(seen, ["https://api.hiapi.ai/api/pricing"]);
  });
});

test("submission guard rechecks token expiry before every retry", async () => {
  let nowMs = 1_000_000;
  let calls = 0;
  await assert.rejects(
    () => submitTask(
      { baseUrl: "https://api.hiapi.ai", apiKey: TEST_API_KEY },
      { model: MODEL, input: {} },
      "2d3d-aaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbb",
      {
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ message: "busy" }, 503);
        },
        sleepImpl: async () => { nowMs = 2_000_000; },
      },
      { approvalExpiresAt: 1500, now: () => nowMs },
    ),
    (error) => error.code === "APPROVAL_EXPIRED_DURING_SUBMISSION" && error.submissionOutcome === "unresolved",
  );
  assert.equal(calls, 1);
});

test("deterministic HTTP rejection is not reported as an unresolved submission", async () => {
  let calls = 0;
  await assert.rejects(
    () => submitTask(
      { baseUrl: "https://api.hiapi.ai", apiKey: TEST_API_KEY },
      { model: MODEL, input: {} },
      "2d3d-aaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbb",
      { fetchImpl: async () => { calls += 1; return jsonResponse({ message: "invalid" }, 400); } },
    ),
    (error) => error.code === "SUBMISSION_REJECTED" && error.submissionOutcome === "rejected" && error.httpStatus === 400,
  );
  assert.equal(calls, 1);
});

test("submission journal replacement preserves the previous file when atomic rename fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hiapi-kling-journal-"));
  try {
    const idempotencyKey = "2d3d-aaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbb";
    const options = { outputDir: directory };
    const base = {
      stage: "2d3d",
      state: "submission_pending",
      model: MODEL,
      requestHash: "a".repeat(64),
      idempotencyKey,
    };
    const journalPath = await writeSubmissionJournal(options, base);
    const before = await readFile(journalPath, "utf8");
    await assert.rejects(
      () => writeSubmissionJournal(options, { ...base, state: "task_id_received", taskId: "task-atomic" }, {
        renameImpl: async () => { throw new Error("simulated atomic replacement failure"); },
      }),
      /simulated atomic replacement failure/,
    );
    assert.equal(await readFile(journalPath, "utf8"), before);
    assert.equal(JSON.parse(before).state, "submission_pending");
    assert.deepEqual(await readdir(join(directory, ".hiapi-submissions")), [`${idempotencyKey}.json`]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resumed task stops an oversized video while streaming", async () => {
  await withTempMedia(async ({ directory, envFile }) => {
    await assert.rejects(
      () => main([
        "--task-id", "task-kling-oversized",
        "--output-dir", directory,
        "--env-file", envFile,
      ], {
        maxDownloadBytes: 12,
        fetchImpl: async (url) => {
          const value = String(url);
          if (value === "https://api.hiapi.ai/v1/tasks/task-kling-oversized") {
            return jsonResponse({ data: {
              id: "task-kling-oversized",
              status: "success",
              model: MODEL,
              output: { video_url: "https://cdn.example.com/oversized.mp4" },
            } });
          }
          if (value === "https://cdn.example.com/oversized.mp4") {
            return new Response(new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(8));
                controller.enqueue(new Uint8Array(8));
                controller.close();
              },
            }), { status: 200 });
          }
          throw new Error(`Unexpected mocked request: ${value}`);
        },
      }),
      /Video download exceeds the 12-byte limit/,
    );
  });
});

test("resumed task times out a stalled video download", async () => {
  await withTempMedia(async ({ directory, envFile }) => {
    await assert.rejects(
      () => main([
        "--task-id", "task-kling-stalled",
        "--output-dir", directory,
        "--env-file", envFile,
      ], {
        downloadTimeoutMs: 10,
        fetchImpl: async (url, init = {}) => {
          const value = String(url);
          if (value === "https://api.hiapi.ai/v1/tasks/task-kling-stalled") {
            return jsonResponse({ data: {
              id: "task-kling-stalled",
              status: "success",
              model: MODEL,
              output: { video_url: "https://cdn.example.com/stalled.mp4" },
            } });
          }
          if (value === "https://cdn.example.com/stalled.mp4") {
            return new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
            });
          }
          throw new Error(`Unexpected mocked request: ${value}`);
        },
      }),
      /Video download timed out after 10 ms/,
    );
  });
});

test("generated package records Kling contract, controls, hashes, and replay evidence", async () => {
  await withTempMedia(async ({ directory, source, realWorldStart, envFile }) => {
    const requestArgs = [
      ...baseArgs(source, realWorldStart),
      "--style", "photoreal",
      "--surface", "natural",
      "--lighting", "natural",
      "--depth-strength", "strong",
      "--motion-fidelity", "physical",
      "--realism", "95",
      "--output-dir", directory,
      "--env-file", envFile,
    ];
    const built = await buildRequest(parseArgs([...requestArgs, "--preview"]));
    const approvedHash = workflowRequestHash(built);
    const now = Date.UTC(2026, 6, 29, 0, 0, 0);
    const approval = createApprovalToken("2d3d", approvedHash, 0.5, TEST_CREDENTIAL, now);
    const output = [];
    const submittedBodies = [];
    const submittedKeys = [];
    await main([...requestArgs, "--spend", "--approval-token", approval.token], {
      now: () => now,
      print: (value) => output.push(String(value)),
      sleepImpl: async () => {},
      fetchImpl: async (url, init = {}) => {
        const value = String(url);
        if (value === "https://api.hiapi.ai/api/pricing") return jsonResponse(pricing(0.1));
        if (value === "https://api.hiapi.ai/v1/tasks" && init.method === "POST") {
          submittedBodies.push(init.body);
          submittedKeys.push(init.headers["Idempotency-Key"]);
          assert.deepEqual(JSON.parse(init.body).input, built.payload.input);
          if (submittedBodies.length === 1) throw new TypeError("simulated response loss after accept");
          if (submittedBodies.length === 2) return jsonResponse({ code: 409, data: null }, 409, { "Retry-After": "1" });
          return jsonResponse({ data: { id: "task-kling-controls" } }, 200, { "Idempotent-Replay": "true" });
        }
        if (value === "https://api.hiapi.ai/v1/tasks/task-kling-controls") {
          return jsonResponse({ data: {
            id: "task-kling-controls",
            status: "success",
            model: MODEL,
            output: { video_url: "https://cdn.example.com/kling-controls.mp4" },
          } });
        }
        if (value === "https://cdn.example.com/kling-controls.mp4") {
          return new Response(syntheticMp4({ seconds: 5 }), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        throw new Error(`Unexpected mocked request: ${value}`);
      },
    });
    const result = JSON.parse(output.at(-1));
    const manifest = JSON.parse(await readFile(join(result.outputDirectory, "manifest.json"), "utf8"));
    const qc = JSON.parse(await readFile(join(result.outputDirectory, "qc.json"), "utf8"));
    const brief = await readFile(join(result.outputDirectory, "brief.md"), "utf8");
    assert.equal(manifest.model, MODEL);
    assert.equal(manifest.requestHash, approvedHash);
    assert.deepEqual(manifest.renderControls, built.renderControls);
    assert.equal(manifest.approvalVersion, "apv2");
    assert.equal(manifest.approvedQuoteUsd, 0.5);
    assert.equal(manifest.submissionReplayed, true);
    assert.equal(manifest.submissionReplayEvidence, "idempotent-replay-header");
    assert.equal(manifest.taskEchoVerification.inputEcho, "not-returned");
    assert.match(manifest.storyboardMedia.sha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.storyboardFrameMedia.sha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.realWorldStartImageMedia.sha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.inputImageMedia[0].sha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.outputVideo.sha256, /^[a-f0-9]{64}$/);
    assert.equal(new Set(submittedBodies).size, 1);
    assert.equal(new Set(submittedKeys).size, 1);
    const journal = JSON.parse(await readFile(join(directory, ".hiapi-submissions", `${manifest.idempotencyKey}.json`), "utf8"));
    assert.equal(journal.state, "package_saved");
    assert.equal(journal.taskId, "task-kling-controls");
    assert.equal(JSON.stringify(journal).includes(approval.token), false);
    assert.equal(JSON.stringify(manifest).includes(source), false);
    assert.deepEqual(qc.requestedControls, built.renderControls);
    assert.match(brief, /Model: kling-3\.0-omni\/image-to-video/);
    assert.match(brief, /Surface: natural \(explicit override\)/);
    assert.match(brief, /Action: The character walks forward/);
  });
});

test("resumed task reports unknown audio when the task omits sound", async () => {
  await withTempMedia(async ({ directory, envFile }) => {
    const output = [];
    await main([
      "--task-id", "task-kling-resume",
      "--output-dir", directory,
      "--env-file", envFile,
    ], {
      print: (value) => output.push(String(value)),
      fetchImpl: async (url) => {
        const value = String(url);
        if (value === "https://api.hiapi.ai/v1/tasks/task-kling-resume") {
          return jsonResponse({ data: {
            id: "task-kling-resume",
            status: "success",
            model: MODEL,
            input: { duration: 5, resolution: "720p" },
            output: { video_url: "https://cdn.example.com/kling-resume.mp4" },
          } });
        }
        if (value === "https://cdn.example.com/kling-resume.mp4") {
          return new Response(syntheticMp4({ seconds: 5 }), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        throw new Error(`Unexpected mocked request: ${value}`);
      },
    });
    const result = JSON.parse(output.at(-1));
    const brief = await readFile(join(result.outputDirectory, "brief.md"), "utf8");
    assert.match(brief, /Generated audio: unknown/);
    assert.doesNotMatch(brief, /Generated audio: enabled/);
  });
});
