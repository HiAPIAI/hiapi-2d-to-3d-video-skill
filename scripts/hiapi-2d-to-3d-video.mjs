#!/usr/bin/env node
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BASE_URL = "https://api.hiapi.ai";
export const MODEL = "kling-3.0-omni/image-to-video";
export const DEFAULT_MAX_COST_USD = 3;
export const APPROVAL_TTL_SECONDS = 12 * 60 * 60;
export const APPROVAL_VERSION = "apv2";
export const MAX_PROMPT_CHARACTERS = 2500;
export const MIN_IMAGE_DIMENSION = 300;
const APPROVAL_STAGES = new Set(["2d3d"]);
export const STYLES = Object.freeze({
  photoreal: {
    label: "Hollywood-quality live-action cinematic",
    direction: "a photographed real-world scene with natural anatomy, micro-textured physical materials, environmental wear, motivated light, and cinema-lens behavior",
  },
});

export const STYLE_CONTROL_DEFAULTS = Object.freeze({
  photoreal: Object.freeze({ surface: "natural", lighting: "natural", depthStrength: "strong", motionFidelity: "physical", realism: 95 }),
});

const SURFACES = Object.freeze({
  natural: "distinct material-appropriate surfaces",
  pbr: "stable PBR materials",
  clay: "matte sculpted clay volume",
  plastic: "molded material with controlled gloss",
  plush: "sewn fibers with contact compression",
  miniature: "crafted materials with coherent scale cues",
});

const LIGHTING = Object.freeze({
  source: "match source direction, exposure, and contrast",
  natural: "motivated light with soft bounce",
  studio: "soft key, controlled fill, subtle rim",
  cinematic: "motivated contrast and readable shadows",
  dramatic: "strong contrast without hiding faces or contacts",
});

const DEPTH_STRENGTHS = Object.freeze({
  subtle: "restrained volume and parallax",
  balanced: "clear geometry, parallax, and contact shadows",
  strong: "geometry, parallax, occlusion, and contact shadows",
});

const MOTION_FIDELITIES = Object.freeze({
  strict: "follow order and contacts; add no beats",
  balanced: "preserve beats; adapt flat deformation into stable 3D motion",
  physical: "believable weight, inertia, collision, and contact",
});

const VALUE_FLAGS = new Map([
  ["--style", "style"],
  ["--surface", "surface"],
  ["--lighting", "lighting"],
  ["--depth-strength", "depthStrength"],
  ["--motion-fidelity", "motionFidelity"],
  ["--realism", "realism"],
  ["--real-world-scene", "targetLook"],
  ["--action-description", "actionDescription"],
  ["--camera-description", "cameraDescription"],
  ["--prompt", "prompt"],
  ["--sound", "sound"],
  ["--storyboard-video-file", "sourceVideoFile"],
  ["--storyboard-image-file", "sourceImageFile"],
  ["--real-world-start-image-file", "realWorldStartImageFile"],
  ["--end-image-file", "endImageFile"],
  ["--storyboard-frame-seconds", "sourceFrameSeconds"],
  ["--ffmpeg-path", "ffmpegPath"],
  ["--storyboard-duration", "sourceDuration"],
  ["--seconds", "seconds"],
  ["--resolution", "resolution"],
  ["--output-dir", "outputDir"],
  ["--env-file", "envFile"],
  ["--max-cost-usd", "maxCostUsd"],
  ["--poll-interval-seconds", "pollIntervalSeconds"],
  ["--poll-timeout-seconds", "pollTimeoutSeconds"],
  ["--idempotency-key", "idempotencyKey"],
  ["--approval-token", "approvalToken"],
  ["--approved-request-hash", "approvedRequestHash"],
  ["--task-id", "taskId"],
]);

const REPEAT_FLAGS = new Map([
  ["--subject-map", "characterMaps"],
]);

const VIDEO_MIME_TYPES = new Map([
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
]);
const SUPPORTED_RESOLUTIONS = new Map([["720p", "720p"], ["1080p", "1080p"], ["4k", "4K"]]);
const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FAILURE_STATUSES = new Set(["fail", "failed", "error", "cancelled", "canceled"]);
const RETRYABLE_STATUSES = new Set([409, 429, 503]);
const MAX_SUBMISSION_ATTEMPTS = 12;
const MAX_VIDEO_BYTES = 180 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TASK_REQUEST_BYTES = 120 * 1024 * 1024;
const MAX_OUTPUT_VIDEO_BYTES = 200 * 1024 * 1024;
const OUTPUT_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export function usage() {
  return `HiAPI 2D To 3D Video - Kling Appearance-First Path

Usage:
  node scripts/hiapi-2d-to-3d-video.mjs --storyboard-video-file PATH --real-world-start-image-file PATH --action-description TEXT --real-world-scene TEXT --subject-map TEXT --asset-rights-confirmed --real-world-start-image-approved --appearance-first-acknowledged --preview [options]
  node scripts/hiapi-2d-to-3d-video.mjs --storyboard-image-file PATH --real-world-start-image-file PATH --action-description TEXT --real-world-scene TEXT --subject-map TEXT --asset-rights-confirmed --real-world-start-image-approved --preview [options]
  node scripts/hiapi-2d-to-3d-video.mjs ... --spend --approval-token TOKEN
  node scripts/hiapi-2d-to-3d-video.mjs --task-id ID --env-file PATH
  node scripts/hiapi-2d-to-3d-video.mjs --check --env-file PATH

Target styles:
  photoreal       Real animals, people, objects, materials, and live-action depth (fixed)

Reality controls (optional; defaults come from --style):
  --surface VALUE               natural | pbr | clay | plastic | plush | miniature
  --lighting VALUE              source | natural | studio | cinematic | dramatic
  --depth-strength VALUE        subtle | balanced | strong
  --motion-fidelity VALUE       strict | balanced | physical
  --realism VALUE               Integer 0-100; stylized to real-world plausible

Kling appearance-first options:
  --storyboard-video-file PATH   One clean local 2D storyboard shot, 2-15 seconds; never sent to Kling
  --storyboard-image-file PATH   One local 2D storyboard frame; never sent to Kling
  --real-world-start-image-file PATH  Human-approved photoreal start image; the only initial visual sent to Kling
  --end-image-file PATH          Optional photoreal final frame, same ratio and 300px minimum per side
  --storyboard-frame-seconds VALUE  Frame extraction time for a storyboard video; defaults near the start
  --ffmpeg-path PATH             ffmpeg executable used to extract the storyboard frame; default ffmpeg
  --storyboard-duration SECONDS  Required for an uninspectable storyboard video; optional action-duration hint for an image
  --action-description TEXT      Required motion and event sequence for Kling
  --camera-description TEXT      Optional camera movement and framing over time
  --style VALUE                  photoreal only; other styles belong in a different workflow
  --subject-map TEXT             Repeatable animation-subject => real-world counterpart mapping
  --real-world-scene TEXT        Required physical scene, materials, lighting, and scale direction
  --prompt TEXT                  Optional extra creative constraint
  --seconds VALUE                Integer output duration, 3-15; defaults near source length or 5 seconds
  --resolution VALUE             720p | 1080p | 4K; default 720p
  --audio                        Generate new action-matched audio; disabled by default
  --no-audio                     Explicitly disable generated audio
  --sound TEXT                   New sound direction; does not copy protected source audio
  --asset-rights-confirmed       Confirm rights to every source and target reference
  --real-world-start-image-approved  Confirm the start image passed visual review as photoreal
  --appearance-first-acknowledged  Confirm that Kling generates new motion without receiving or synchronizing to the storyboard video
  --premium-resolution-approved  Required for 4k

Execution options:
  --preview                      Offline validation and redacted payload; no network or charge
  --dry-run                      Bind local media bytes and read public live pricing; no task or charge
  --spend                        Create exactly one paid task after matching quote approval
  --approval-token TOKEN         Required with --spend; copy from the matching dry-run
  --approved-request-hash HASH   Legacy approval; rejected because it does not bind price
  --task-id ID                   Resume an existing task without resubmission
  --check                        Check live catalog and authentication without creating a task
  --env-file PATH                Read HIAPI_API_KEY without printing it
  --max-cost-usd VALUE           Local public-price estimate limit; default 3.00
  --output-dir PATH              Result package root; default outputs
  --help                         Show this help`;
}

export function parseArgs(args) {
  const options = {
    characterMaps: [],
    outputDir: "outputs",
    maxCostUsd: DEFAULT_MAX_COST_USD,
    pollIntervalSeconds: 5,
    pollTimeoutSeconds: 3600,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--preview") options.preview = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--spend") options.spend = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--audio") options.audio = true;
    else if (arg === "--no-audio") options.noAudio = true;
    else if (arg === "--asset-rights-confirmed") options.assetRightsConfirmed = true;
    else if (arg === "--real-world-start-image-approved") options.realWorldStartImageApproved = true;
    else if (arg === "--appearance-first-acknowledged") options.appearanceFirstAcknowledged = true;
    else if (arg === "--premium-resolution-approved") options.premiumResolutionApproved = true;
    else if (REPEAT_FLAGS.has(arg)) {
      options[REPEAT_FLAGS.get(arg)].push(requireOptionValue(args, index, arg));
      index += 1;
    } else if (VALUE_FLAGS.has(arg)) {
      options[VALUE_FLAGS.get(arg)] = requireOptionValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  for (const key of ["sourceDuration", "sourceFrameSeconds", "seconds", "realism", "maxCostUsd", "pollIntervalSeconds", "pollTimeoutSeconds"]) {
    if (options[key] !== undefined) options[key] = Number(options[key]);
  }
  if (options.realism !== undefined && (!Number.isInteger(options.realism) || options.realism < 0 || options.realism > 100)) {
    throw new Error("--realism must be an integer from 0 to 100.");
  }
  validateNumber(options.maxCostUsd, "--max-cost-usd", 0.01, 1000);
  validateNumber(options.pollIntervalSeconds, "--poll-interval-seconds", 1, 300);
  validateNumber(options.pollTimeoutSeconds, "--poll-timeout-seconds", 1, 86400);
  return options;
}

function requireOptionValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function validateNumber(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
}

export function validateExecutionMode(options) {
  if (options.help) return "help";
  const active = [
    options.preview && "preview",
    options.dryRun && "dry-run",
    options.spend && "spend",
    options.check && "check",
  ].filter(Boolean);
  if (options.taskId) {
    if (active.length > 0) throw new Error("--task-id cannot be combined with --preview, --dry-run, --spend, or --check.");
    if (hasRequestInput(options)) throw new Error("--task-id is resume-only; remove generation inputs.");
    return "resume";
  }
  if (active.length !== 1) throw new Error("Choose exactly one of --preview, --dry-run, --spend, or --check.");
  if (active[0] === "check" && hasRequestInput(options)) throw new Error("--check cannot include generation inputs.");
  return active[0];
}

function hasRequestInput(options) {
  return Boolean(
    options.style || options.surface || options.lighting || options.depthStrength || options.motionFidelity || options.realism !== undefined ||
    options.targetLook || options.actionDescription || options.cameraDescription || options.prompt || options.sound || options.sourceVideoFile || options.sourceImageFile || options.realWorldStartImageFile || options.endImageFile || options.ffmpegPath ||
    options.sourceFrameSeconds !== undefined || options.sourceDuration !== undefined || options.seconds !== undefined || options.resolution || options.audio ||
    options.noAudio || options.assetRightsConfirmed || options.realWorldStartImageApproved || options.appearanceFirstAcknowledged || options.premiumResolutionApproved || options.approvalToken || options.approvedRequestHash ||
    options.idempotencyKey || options.characterMaps.length
  );
}

export function parseEnvText(text) {
  const parsed = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    parsed[key] = value;
  }
  return parsed;
}

export async function resolveConfig(options, env = process.env) {
  const fileEnv = options.envFile ? parseEnvText(await readFile(resolve(options.envFile), "utf8")) : {};
  const apiKey = (options.envFile ? fileEnv.HIAPI_API_KEY : env.HIAPI_API_KEY)?.trim();
  return { apiKey, baseUrl: BASE_URL };
}

function requireApiKey(config) {
  if (!config.apiKey) throw new Error("HIAPI_API_KEY is missing. Set it in the environment or pass --env-file PATH; do not paste it into chat.");
}

function normalizeStyle(value = "photoreal") {
  const style = String(value).trim().toLowerCase();
  if (!Object.hasOwn(STYLES, style)) throw new Error(`Unsupported --style: ${style}.`);
  return style;
}

function normalizeControl(value, fallback, choices, flag) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!Object.hasOwn(choices, normalized)) throw new Error(`Unsupported ${flag}: ${normalized}.`);
  return normalized;
}

export function resolveRenderControls(styleValue = "photoreal", options = {}) {
  const style = normalizeStyle(styleValue);
  const defaults = STYLE_CONTROL_DEFAULTS[style];
  const controls = {
    surface: normalizeControl(options.surface, defaults.surface, SURFACES, "--surface"),
    lighting: normalizeControl(options.lighting, defaults.lighting, LIGHTING, "--lighting"),
    depthStrength: normalizeControl(options.depthStrength, defaults.depthStrength, DEPTH_STRENGTHS, "--depth-strength"),
    motionFidelity: normalizeControl(options.motionFidelity, defaults.motionFidelity, MOTION_FIDELITIES, "--motion-fidelity"),
    realism: options.realism === undefined ? defaults.realism : Number(options.realism),
  };
  if (!Number.isInteger(controls.realism) || controls.realism < 0 || controls.realism > 100) {
    throw new Error("--realism must be an integer from 0 to 100.");
  }
  const overrides = ["surface", "lighting", "depthStrength", "motionFidelity", "realism"]
    .filter((key) => options[key] !== undefined);
  return { controls, overrides };
}

function realismDirection(value) {
  if (value < 90) return "insufficient for a real-world reconstruction";
  return "high real-world plausibility without adding a real person's identity";
}

const NON_REAL_WORLD_TERMS = /\b(?:animation|animated|anime|cartoon|cgi|3d|illustration|illustrated|line\s*art|cel[-\s]*shad(?:ing)?|flat\s*fill|stylized|stylised|toy|plush|clay)\b/i;
const REAL_COUNTERPART_CUE = /\b(?:real(?:[-\s]world)?|living|physical)\b/i;

function requireRealWorldControls(style, controls) {
  if (style !== "photoreal") throw new Error("This workflow only supports --style photoreal. Use a different skill for CGI or stylized animation.");
  if (controls.surface !== "natural") throw new Error("Real-world reconstruction requires --surface natural.");
  if (controls.depthStrength !== "strong") throw new Error("Real-world reconstruction requires --depth-strength strong.");
  if (controls.motionFidelity !== "physical") throw new Error("Real-world reconstruction requires --motion-fidelity physical.");
  if (controls.realism < 90) throw new Error("Real-world reconstruction requires --realism from 90 to 100.");
  if (!new Set(["natural", "cinematic", "dramatic"]).has(controls.lighting)) {
    throw new Error("Real-world reconstruction requires --lighting natural, cinematic, or dramatic; source and studio lighting are not allowed.");
  }
}

function requireRealWorldScene(value) {
  const scene = String(value || "").trim();
  if (!scene) throw new Error("--real-world-scene is required. Describe the physical location, light, scale, and materials to reconstruct.");
  if (NON_REAL_WORLD_TERMS.test(scene)) throw new Error("--real-world-scene must describe a physical world, not animation, illustration, CGI, or stylized rendering.");
  return scene;
}

function requireRealWorldSubjectMaps(values) {
  if (values.length === 0) {
    throw new Error("At least one --subject-map is required. Map every major animated subject to a specific real-world counterpart before preview.");
  }
  return values.map((value) => {
    const [source, ...targetParts] = value.split("=>");
    const target = targetParts.join("=>").trim();
    if (!source?.trim() || !target) throw new Error(`Invalid --subject-map: ${value}. Use 'animated subject => real-world counterpart'.`);
    if (!REAL_COUNTERPART_CUE.test(target) || NON_REAL_WORLD_TERMS.test(target)) {
      throw new Error(`The target side of --subject-map must name a real or living physical counterpart without animation terms: ${value}`);
    }
    return `${source.trim()} => ${target}`;
  });
}

function normalizeResolution(value = "720p", premiumApproved = false) {
  const normalized = String(value).trim().toLowerCase();
  if (!SUPPORTED_RESOLUTIONS.has(normalized)) throw new Error(`Unsupported --resolution: ${value}. Kling supports 720p, 1080p, or 4K.`);
  if (normalized === "4k" && !premiumApproved) throw new Error("4K requires --premium-resolution-approved after cost review.");
  return SUPPORTED_RESOLUTIONS.get(normalized);
}

function normalizeOutputSeconds(value, sourceDuration) {
  const inferred = Number.isFinite(sourceDuration) ? Math.round(sourceDuration) : 5;
  const seconds = value === undefined ? Math.min(15, Math.max(3, inferred)) : value;
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) throw new Error("--seconds must be an integer from 3 to 15.");
  return seconds;
}

function validateReferenceDuration(value) {
  validateNumber(value, "Source video duration", 2, 15);
  return Number(value);
}

function readMp4Box(bytes, offset, limit) {
  if (offset + 8 > limit) return null;
  let size = bytes.readUInt32BE(offset);
  const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > limit) return null;
    const largeSize = bytes.readBigUInt64BE(offset + 8);
    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(largeSize);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }
  if (size < headerSize || offset + size > limit) return null;
  return { type, size, headerSize, offset, contentStart: offset + headerSize, next: offset + size };
}

function childBoxes(bytes, start, end) {
  const boxes = [];
  let offset = start;
  while (offset < end) {
    const box = readMp4Box(bytes, offset, end);
    if (!box) return null;
    boxes.push(box);
    offset = box.next;
  }
  return offset === end ? boxes : null;
}

function fixed1616(bytes, offset) {
  return bytes.readUInt32BE(offset) / 65536;
}

export function inspectMp4Buffer(bytes) {
  const top = childBoxes(bytes, 0, bytes.length);
  const ftyp = top?.find((box) => box.type === "ftyp");
  const moov = top?.find((box) => box.type === "moov");
  if (!ftyp || !moov) throw new Error("Source .mp4 is not a complete MP4 container with ftyp and moov metadata.");
  const moovChildren = childBoxes(bytes, moov.contentStart, moov.next);
  const mvhd = moovChildren?.find((box) => box.type === "mvhd");
  if (!mvhd) throw new Error("Source .mp4 is missing movie duration metadata.");
  const version = bytes[mvhd.contentStart];
  let timescale;
  let durationUnits;
  if (version === 0) {
    if (mvhd.contentStart + 20 > mvhd.next) throw new Error("Source .mp4 has truncated duration metadata.");
    timescale = bytes.readUInt32BE(mvhd.contentStart + 12);
    durationUnits = bytes.readUInt32BE(mvhd.contentStart + 16);
  } else if (version === 1) {
    if (mvhd.contentStart + 32 > mvhd.next) throw new Error("Source .mp4 has truncated duration metadata.");
    timescale = bytes.readUInt32BE(mvhd.contentStart + 20);
    const rawDuration = bytes.readBigUInt64BE(mvhd.contentStart + 24);
    if (rawDuration > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Source .mp4 duration is too large to inspect safely.");
    durationUnits = Number(rawDuration);
  } else {
    throw new Error(`Unsupported MP4 movie-header version: ${version}.`);
  }
  if (!timescale || !durationUnits) throw new Error("Source .mp4 has no usable duration metadata.");
  let dimensions = null;
  for (const trak of moovChildren.filter((box) => box.type === "trak")) {
    const tkhd = childBoxes(bytes, trak.contentStart, trak.next)?.find((box) => box.type === "tkhd");
    if (!tkhd || tkhd.next - 8 < tkhd.contentStart) continue;
    const width = Math.round(fixed1616(bytes, tkhd.next - 8));
    const height = Math.round(fixed1616(bytes, tkhd.next - 4));
    if (width > 0 && height > 0 && (!dimensions || width * height > dimensions.width * dimensions.height)) dimensions = { width, height };
  }
  return { duration: durationUnits / timescale, ...dimensions };
}

function inferRatio(width, height) {
  if (!width || !height) return "adaptive";
  const actual = width / height;
  const ratios = new Map([
    ["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["21:9", 21 / 9],
  ]);
  let best = null;
  for (const [label, numeric] of ratios) {
    const error = Math.abs(Math.log(actual / numeric));
    if (!best || error < best.error) best = { label, error };
  }
  return best && best.error <= 0.035 ? best.label : "adaptive";
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = bytes.subarray(offset + 4, offset + 8);
    const name = type.toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([type, data])) !== expectedCrc) return null;
    if (!sawHeader) {
      if (name !== "IHDR" || length !== 13) return null;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width < 1 || height < 1) return null;
      sawHeader = true;
    } else if (name === "IHDR") return null;
    if (name === "IDAT") sawData = true;
    if (name === "IEND") return length === 0 && sawHeader && sawData && end === bytes.length
      ? { mime: "image/png", width, height }
      : null;
    offset = end;
  }
  return null;
}

function inspectJpeg(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset + 1 < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isStartOfFrame) {
      if (length < 8) return null;
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
      if (width < 1 || height < 1) return null;
    }
    if (marker === 0xda) return width > 0 && height > 0 ? { mime: "image/jpeg", width, height } : null;
    offset += length;
  }
  return null;
}

function inspectWebp(bytes) {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const end = dataStart + length;
    if (end > bytes.length) return null;
    let width = 0;
    let height = 0;
    if (type === "VP8X" && length >= 10) {
      width = 1 + bytes.readUIntLE(dataStart + 4, 3);
      height = 1 + bytes.readUIntLE(dataStart + 7, 3);
    } else if (type === "VP8L" && length >= 5 && bytes[dataStart] === 0x2f) {
      const bits = bytes.readUInt32LE(dataStart + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === "VP8 " && length >= 10 && bytes.subarray(dataStart + 3, dataStart + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      width = bytes.readUInt16LE(dataStart + 6) & 0x3fff;
      height = bytes.readUInt16LE(dataStart + 8) & 0x3fff;
    }
    if (width > 0 && height > 0) return { mime: "image/webp", width, height };
    offset = end + (length % 2);
  }
  return null;
}

export function inspectRasterBuffer(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  return inspectPng(bytes) || inspectJpeg(bytes) || inspectWebp(bytes);
}

export function assertTaskRequestSize(payload) {
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > MAX_TASK_REQUEST_BYTES) {
    throw new Error("Serialized task request exceeds 120 MiB; reduce or recompress the local Kling input images before pricing.");
  }
  return bytes;
}

async function resolveVideoFile(filePath, suppliedDuration) {
  const absolutePath = resolve(filePath);
  const extension = extname(absolutePath).toLowerCase();
  const mime = VIDEO_MIME_TYPES.get(extension);
  if (!mime) throw new Error("Source video file must be .mp4, .mov, or .webm.");
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error("Source video path is not a file.");
  if (info.size > MAX_VIDEO_BYTES) throw new Error("Source video exceeds 180 MiB; trim or recompress it before pricing.");
  const bytes = await readFile(absolutePath);
  let inspected = null;
  if (extension === ".mp4") inspected = inspectMp4Buffer(bytes);
  const duration = suppliedDuration ?? inspected?.duration;
  if (duration === undefined) throw new Error("This local video container is not inspectable; provide --storyboard-duration.");
  validateReferenceDuration(duration);
  if (suppliedDuration !== undefined && inspected?.duration && Math.abs(suppliedDuration - inspected.duration) > 0.25) {
    throw new Error(`--storyboard-duration (${suppliedDuration}) does not match MP4 metadata (${inspected.duration.toFixed(3)}).`);
  }
  return {
    path: absolutePath,
    facts: {
      type: "local",
      bytes: info.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      duration,
      width: inspected?.width ?? null,
      height: inspected?.height ?? null,
    },
  };
}

async function resolveRasterFile(filePath, label = "Image") {
  const absolutePath = resolve(filePath);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error(`${label} path is not a file.`);
  const bytes = await readFile(absolutePath);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${label} exceeds 20 MiB.`);
  const raster = inspectRasterBuffer(bytes);
  if (!raster) throw new Error(`${label} must be a structurally valid JPG, PNG, or WebP raster.`);
  return {
    url: `data:${raster.mime};base64,${bytes.toString("base64")}`,
    facts: {
      type: "local",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: raster.width,
      height: raster.height,
    },
  };
}

function runFfmpeg(executable, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      rejectRun(error);
    };
    child.on("error", (error) => fail(new Error(`Unable to run ffmpeg: ${error.message}`)));
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_IMAGE_BYTES) {
        child.kill();
        fail(new Error("Extracted storyboard frame exceeds 20 MiB."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.concat(stderr).length < 64 * 1024) stderr.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        rejectRun(new Error(`ffmpeg frame extraction failed${detail ? `: ${detail}` : ` with exit code ${code}`}.`));
        return;
      }
      resolveRun(Buffer.concat(stdout));
    });
  });
}

export async function extractFrameFromVideo(filePath, atSeconds, ffmpegPath = "ffmpeg", deps = {}) {
  const run = deps.runFfmpeg || runFfmpeg;
  const bytes = await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-ss", Number(atSeconds).toFixed(3),
    "-i", resolve(filePath), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
  ]);
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_IMAGE_BYTES) throw new Error("ffmpeg did not return a usable storyboard frame.");
  const raster = inspectRasterBuffer(bytes);
  if (!raster) throw new Error("ffmpeg output is not a structurally valid PNG, JPG, or WebP frame.");
  return {
    url: `data:${raster.mime};base64,${bytes.toString("base64")}`,
    facts: {
      type: "video-extracted-local",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: raster.width,
      height: raster.height,
      timestampSeconds: Number(atSeconds),
    },
  };
}

export function buildConversionPrompt({
  style,
  renderControls,
  targetLook,
  characterMaps,
  actionDescription,
  cameraDescription,
  hasEndImage = false,
  extraPrompt,
  audioEnabled,
  sound,
}) {
  const normalizedStyle = normalizeStyle(style);
  const styleSpec = STYLES[normalizedStyle];
  const controls = resolveRenderControls(normalizedStyle, renderControls).controls;
  const mappings = characterMaps.map((mapping, index) => `${index + 1}. ${mapping}`).join("\n");
  const imageRoles = hasEndImage
    ? "Image 1 is the approved photoreal opening still; Image 2 is the approved photoreal ending anchor. Keep one real-world scene."
    : "Image 1 is the approved photoreal opening still and the only visual start reference sent to Kling.";
  const audio = audioEnabled
    ? `Audio: generate synchronized ${sound || "movement, impacts, room tone, and restrained non-verbal reactions"}; never copy source music, dialogue, or voices.`
    : "Audio: none.";
  return [
    `One continuous ${styleSpec.label} shot of a photographed physical world; never 3D-cartoon, Pixar, game-model, or plastic-CGI imagery.`,
    imageRoles,
    "Storyboard stays upstream, never sent to Kling. Real from frame one: no line art, flat fills, cel shading, cartoon anatomy, toy materials, or transformation.",
    `Action: ${actionDescription}`,
    `Camera: ${cameraDescription || "preserve the approved framing and cinema-lens perspective; stable motivated camera; no cut, angle change, or zoom"}`,
    `Physical world: ${targetLook || styleSpec.direction}.`,
    `Real-world subject counterparts:\n${mappings}`,
    extraPrompt ? `Constraints: ${extraPrompt}` : "",
    "Consistency: preserve appearance, anatomy, fur/skin detail, materials, environment, light, exposure, and cinematic color. Natural breathing, restrained facial motion, realistic body physics and contacts; no redesign, artificial animation, melting detail, or texture boiling.",
    `Controls: surface=${controls.surface}; lighting=${controls.lighting}; depth=${controls.depthStrength}; motion=${controls.motionFidelity}; realism=${controls.realism}/100.`,
    audio,
    "Lock count, physical identity, markings, scale, props, layout, gravity, and contacts. No extra beats/cuts, UI, text, flat remnants, duplicates, extra limbs, sliding feet, or lost props.",
  ].filter(Boolean).join("\n\n");
}

function assertKlingImageDimensions(facts, label) {
  if (facts.width < MIN_IMAGE_DIMENSION || facts.height < MIN_IMAGE_DIMENSION) {
    throw new Error(`${label} must be at least ${MIN_IMAGE_DIMENSION}px wide and high for Kling; got ${facts.width}x${facts.height}.`);
  }
}

export async function buildRequest(options, deps = {}) {
  if (!options.assetRightsConfirmed) throw new Error("Media generation requires --asset-rights-confirmed.");
  if (Boolean(options.sourceVideoFile) === Boolean(options.sourceImageFile)) throw new Error("Provide exactly one --storyboard-video-file or --storyboard-image-file.");
  if (options.sourceVideoFile && !options.appearanceFirstAcknowledged) {
    throw new Error("Kling never receives the storyboard video and cannot satisfy source-locked synchronization. Use Seedance balanced as a generative candidate under source-lock QC, or pass --appearance-first-acknowledged only after the user explicitly accepts newly generated motion.");
  }
  if (!options.realWorldStartImageFile) throw new Error("--real-world-start-image-file is required. Kling must receive a reviewed photoreal image, never the animation storyboard.");
  if (!options.realWorldStartImageApproved) throw new Error("Review the photoreal start image first, then pass --real-world-start-image-approved.");
  if (options.audio && options.noAudio) throw new Error("Choose either --audio or --no-audio.");
  if (options.sound && !options.audio) throw new Error("--sound requires --audio.");
  const actionDescription = String(options.actionDescription || "").trim();
  if (!actionDescription) throw new Error("Kling image-to-video requires --action-description because the source video itself is not sent to the model.");
  if (actionDescription.length > 2000) throw new Error("--action-description must be at most 2000 characters.");
  const cameraDescription = String(options.cameraDescription || "").trim();
  if (cameraDescription.length > 1000) throw new Error("--camera-description must be at most 1000 characters.");
  const style = normalizeStyle(options.style);
  const { controls: renderControls, overrides: controlOverrides } = resolveRenderControls(style, options);
  requireRealWorldControls(style, renderControls);
  const targetLook = requireRealWorldScene(options.targetLook);
  const resolution = normalizeResolution(options.resolution, options.premiumResolutionApproved);
  let source;
  let sourceFrame;
  let sourceFrameSeconds = null;
  if (options.sourceVideoFile) {
    source = await resolveVideoFile(options.sourceVideoFile, options.sourceDuration);
    source.facts.kind = "video";
    sourceFrameSeconds = options.sourceFrameSeconds === undefined
      ? Math.min(0.25, source.facts.duration * 0.05)
      : Number(options.sourceFrameSeconds);
    if (!Number.isFinite(sourceFrameSeconds) || sourceFrameSeconds < 0 || sourceFrameSeconds >= source.facts.duration) {
      throw new Error(`--storyboard-frame-seconds must be at least 0 and less than the storyboard duration (${source.facts.duration.toFixed(3)}).`);
    }
    const extract = deps.extractFrameImpl || extractFrameFromVideo;
    sourceFrame = await extract(source.path, sourceFrameSeconds, options.ffmpegPath || "ffmpeg", deps);
  } else {
    if (options.sourceFrameSeconds !== undefined) throw new Error("--storyboard-frame-seconds applies only to --storyboard-video-file.");
    sourceFrame = await resolveRasterFile(options.sourceImageFile, "Storyboard image");
    const duration = options.sourceDuration === undefined ? null : Number(options.sourceDuration);
    if (duration !== null) validateNumber(duration, "Source action duration", 3, 15);
    source = { facts: { ...sourceFrame.facts, kind: "image", duration } };
  }
  assertKlingImageDimensions(sourceFrame.facts, source.facts.kind === "video" ? "Extracted storyboard frame" : "Storyboard image");
  const realWorldStart = await resolveRasterFile(options.realWorldStartImageFile, "Real-world start image");
  assertKlingImageDimensions(realWorldStart.facts, "Real-world start image");
  if (realWorldStart.facts.sha256 === sourceFrame.facts.sha256) {
    throw new Error("--real-world-start-image-file must be a separately reconstructed photoreal image, not the storyboard frame copied into Kling.");
  }
  const seconds = normalizeOutputSeconds(options.seconds, source.facts.duration);
  const endImage = options.endImageFile ? await resolveRasterFile(options.endImageFile, "End image") : null;
  if (endImage) {
    assertKlingImageDimensions(endImage.facts, "End image");
    const startAspect = realWorldStart.facts.width / realWorldStart.facts.height;
    const endAspect = endImage.facts.width / endImage.facts.height;
    if (Math.abs(Math.log(startAspect / endAspect)) > 0.02) {
      throw new Error("--end-image-file must use the same aspect ratio as --real-world-start-image-file.");
    }
  }
  const inputImages = [realWorldStart, ...(endImage ? [endImage] : [])];
  const ratio = inferRatio(realWorldStart.facts.width, realWorldStart.facts.height);
  const characterMaps = requireRealWorldSubjectMaps(options.characterMaps.map((value) => String(value).trim()).filter(Boolean));
  if (characterMaps.some((value) => value.length > 500)) throw new Error("Each --subject-map must be at most 500 characters.");
  const audioEnabled = Boolean(options.audio);
  const prompt = buildConversionPrompt({
    style,
    renderControls,
    targetLook,
    characterMaps,
    actionDescription,
    cameraDescription,
    hasEndImage: Boolean(endImage),
    extraPrompt: options.prompt?.trim(),
    audioEnabled,
    sound: options.sound?.trim(),
  });
  const promptCharacters = Array.from(prompt).length;
  if (promptCharacters > MAX_PROMPT_CHARACTERS) {
    throw new Error(`Compiled Kling prompt is ${promptCharacters} characters; shorten action, camera, target look, character maps, or extra prompt to stay within ${MAX_PROMPT_CHARACTERS}.`);
  }
  const payload = {
    model: MODEL,
    storage: "temp",
    input: {
      prompt,
      duration: seconds,
      resolution,
      sound: audioEnabled,
      image_urls: inputImages.map((image) => image.url),
    },
  };
  assertTaskRequestSize(payload);
  const warnings = [
    source.facts.kind === "video"
      ? "The storyboard video is only local analysis evidence. Kling receives the approved photoreal start image and text instructions, not any storyboard frame. Exact source motion, timing, camera movement, and cuts are not transferred."
      : "The storyboard image is only local semantic evidence. Kling receives the separately reviewed photoreal start image and text instructions only.",
    "The real-world start image passed a declared human review, but visual generation can still drift. Reject any output that returns to animation, line art, flat fills, or cartoon anatomy.",
  ];
  if (endImage) warnings.push("Image 2 anchors the final composition and may reduce Kling's freedom to maintain one consistent 3D style.");
  return {
    style,
    renderControls,
    controlOverrides,
    prompt,
    promptCharacters,
    payload,
    sourceFacts: source.facts,
    sourceFrameFacts: sourceFrame.facts,
    sourceFrameSeconds,
    realWorldStartFacts: realWorldStart.facts,
    inputImageFacts: inputImages.map((image) => image.facts),
    actionDescription,
    cameraDescription,
    seconds,
    resolution,
    ratio,
    audioEnabled,
    characterMaps,
    inputImageCount: inputImages.length,
    warnings,
    rightsConfirmation: {
      assetRightsConfirmed: true,
      realWorldStartImageApproved: true,
      appearanceFirstAcknowledged: options.sourceVideoFile ? true : null,
    },
    approvalBinding: {
      storyboardKind: source.facts.kind,
      storyboardSha256: source.facts.sha256,
      storyboardDuration: source.facts.duration,
      storyboardFrameSha256: sourceFrame.facts.sha256,
      storyboardFrameSeconds: sourceFrameSeconds,
      realWorldStartImageSha256: realWorldStart.facts.sha256,
      inputImageSha256: inputImages.map((image) => image.facts.sha256),
      appearanceFirstAcknowledged: Boolean(options.appearanceFirstAcknowledged),
    },
  };
}

export function requireByteBoundMedia(built) {
  if (built.sourceFacts?.type !== "local" || !/^[a-f0-9]{64}$/.test(built.sourceFacts?.sha256 || "")) {
    throw new Error("--dry-run and --spend require local storyboard media so approval binds the exact storyboard bytes.");
  }
  if (built.realWorldStartFacts?.type !== "local" || !/^[a-f0-9]{64}$/.test(built.realWorldStartFacts?.sha256 || "")) {
    throw new Error("--dry-run and --spend require a byte-bound local real-world start image.");
  }
  if (!(built.inputImageFacts || []).length || built.inputImageFacts.some((image) => !["local", "video-extracted-local"].includes(image.type) || !/^[a-f0-9]{64}$/.test(image.sha256 || ""))) {
    throw new Error("--dry-run and --spend require byte-bound local Kling input images.");
  }
}

function responseRows(pricingResponse) {
  if (Array.isArray(pricingResponse)) return pricingResponse;
  if (Array.isArray(pricingResponse?.data)) return pricingResponse.data;
  return [];
}

function hasValue(value) {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "" && value !== false;
}

function policyMatches(policy, input) {
  return Object.entries(policy?.rule || {}).every(([field, condition]) => {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) throw new Error(`Unsupported live pricing condition for ${field}.`);
    const operators = Object.keys(condition);
    if (operators.length === 0 || operators.some((operator) => operator !== "match" && operator !== "with")) throw new Error(`Unsupported live pricing condition for ${field}.`);
    const value = input[field];
    if (Object.hasOwn(condition, "match")) {
      const expected = condition.match;
      if (Array.isArray(expected) ? !expected.includes(value) : value !== expected) return false;
    }
    if (Object.hasOwn(condition, "with") && hasValue(value) !== Boolean(condition.with)) return false;
    return true;
  });
}

function positiveNumber(value, label) {
  const numeric = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be greater than zero.`);
  return numeric;
}

function baseUnitPrice(row, model) {
  return positiveNumber(row.base_usd_value ?? row.model_price, `Live pricing base USD value for ${model}`);
}

function policyUnitPrice(policy, row, model) {
  const pricingType = policy.pricing_type || (policy.usd_value !== undefined ? "fixed" : "");
  if (pricingType === "fixed") return positiveNumber(policy.usd_value, `Live fixed policy USD value for ${model}`);
  if (pricingType === "multiply") return baseUnitPrice(row, model) * positiveNumber(policy.times ?? policy.pricing_value, `Live policy multiplier for ${model}`);
  throw new Error(`Live pricing for ${model} has unsupported policy type: ${pricingType || "missing"}.`);
}

export function estimateCostUsd(pricingResponse, payload) {
  const requestedModel = String(payload.model).trim().toLowerCase();
  const row = responseRows(pricingResponse).find((item) => String(item.model_name || "").trim().toLowerCase() === requestedModel);
  if (!row) throw new Error(`Live pricing does not contain ${payload.model}.`);
  const factors = row.factors ?? [];
  if (!Array.isArray(factors)) throw new Error(`Live pricing for ${payload.model} has malformed factors.`);
  const policies = row.policies ?? [];
  if (!Array.isArray(policies)) throw new Error(`Live pricing for ${payload.model} has malformed policies.`);
  const matches = policies.filter((policy) => policyMatches(policy, payload.input));
  if (payload.input.sound === true && !matches.some((policy) => Object.hasOwn(policy.rule || {}, "sound"))) {
    throw new Error(`Live pricing for ${payload.model} does not contain a sound-enabled policy for ${payload.input.resolution}; refusing to underestimate generated audio.`);
  }
  let unitPrice;
  if (matches.length > 0) {
    const specificity = Math.max(...matches.map((policy) => Object.keys(policy.rule || {}).length));
    unitPrice = Math.max(...matches.filter((policy) => Object.keys(policy.rule || {}).length === specificity).map((policy) => policyUnitPrice(policy, row, payload.model)));
  } else unitPrice = baseUnitPrice(row, payload.model);
  if (factors.length === 0) {
    if (payload.input.duration !== undefined) throw new Error(`Live pricing for ${payload.model} is missing its duration factor.`);
    return Number(unitPrice.toFixed(6));
  }
  if (factors.length !== 1) throw new Error(`Live pricing for ${payload.model} must contain zero or one pricing factor.`);
  const factor = String(factors[0]).trim().toLowerCase();
  if (!new Set(["duration", "seconds", "duration_seconds"]).has(factor)) throw new Error(`Live pricing for ${payload.model} has unsupported factor: ${factor}.`);
  return Number((unitPrice * positiveNumber(payload.input.duration, `${payload.model} duration`)).toFixed(6));
}

export function enforceBudget(estimatedCostUsd, maxCostUsd) {
  if (!Number.isFinite(estimatedCostUsd)) throw new Error("Estimated cost is unavailable; refusing a paid request.");
  if (estimatedCostUsd > maxCostUsd) throw new Error(`Estimated cost $${estimatedCostUsd.toFixed(4)} exceeds the $${maxCostUsd.toFixed(2)} limit.`);
}

export function redactPayload(payload) {
  const copy = structuredClone(payload);
  if (Array.isArray(copy.input?.image_urls)) {
    copy.input.image_urls = copy.input.image_urls.map((_, index) => `[image ${index + 1} omitted]`);
  }
  return copy;
}

export function requestHash(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function workflowRequestHash(built) {
  return requestHash({ schemaVersion: 1, payload: built.payload, approvalBinding: built.approvalBinding });
}

function approvalTag(canonical) {
  return createHash("sha256").update(`approval-v1\0${canonical}`).digest("hex").slice(0, 20);
}

function equalFixedText(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function usdToMicros(value) {
  const numeric = positiveNumber(value, "Approved quote USD");
  const micros = Math.round(numeric * 1_000_000);
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error("Approved quote USD cannot be represented safely.");
  return micros;
}

export function credentialFingerprint(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) throw new Error("A HiAPI credential is required to bind paid approval to one account key.");
  return createHash("sha256").update(`hiapi-credential-v1\0${value}`).digest("hex").slice(0, 20);
}

export function createApprovalToken(stage, hash, estimatedCostUsd, expectedCredentialFingerprint, nowMs = Date.now()) {
  const safeStage = String(stage).trim().toLowerCase();
  if (!APPROVAL_STAGES.has(safeStage)) throw new Error(`Unsupported approval stage: ${stage}.`);
  const safeHash = String(hash).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(safeHash)) throw new Error("Approval request hash must be 64 lowercase hexadecimal characters.");
  const safeCredentialFingerprint = String(expectedCredentialFingerprint || "").trim().toLowerCase();
  if (!/^[a-f0-9]{20}$/.test(safeCredentialFingerprint)) throw new Error("Approval credential fingerprint must be 20 lowercase hexadecimal characters.");
  const issuedAt = Math.floor(Number(nowMs) / 1000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) throw new Error("Approval issue time is invalid.");
  const quoteMicrousd = usdToMicros(estimatedCostUsd);
  const canonical = `${APPROVAL_VERSION}.${safeStage}.${issuedAt}.${safeHash}.${quoteMicrousd}.${safeCredentialFingerprint}`;
  const token = `${canonical}.${approvalTag(canonical)}`;
  return {
    token,
    version: APPROVAL_VERSION,
    stage: safeStage,
    requestHash: safeHash,
    credentialFingerprint: safeCredentialFingerprint,
    quoteMicrousd,
    approvedQuoteUsd: quoteMicrousd / 1_000_000,
    issuedAt,
    issuedAtIso: new Date(issuedAt * 1000).toISOString(),
    expiresAt: issuedAt + APPROVAL_TTL_SECONDS,
    expiresAtIso: new Date((issuedAt + APPROVAL_TTL_SECONDS) * 1000).toISOString(),
  };
}

export function parseApprovalToken(token, expectedStage, expectedHash, expectedCredentialFingerprint, nowMs = Date.now()) {
  const raw = String(token || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 7) throw new Error("--approval-token is malformed or uses the retired unbound format. Run --dry-run again.");
  const [version, stage, issuedAtText, hash, quoteText, tokenCredentialFingerprint, tag] = parts;
  if (version !== APPROVAL_VERSION || !APPROVAL_STAGES.has(stage)) throw new Error("--approval-token has an unsupported version or stage.");
  if (!/^[1-9][0-9]{0,11}$/.test(issuedAtText) || !/^[a-f0-9]{64}$/.test(hash) || !/^[1-9][0-9]{0,15}$/.test(quoteText) || !/^[a-f0-9]{20}$/.test(tokenCredentialFingerprint) || !/^[a-f0-9]{20}$/.test(tag)) {
    throw new Error("--approval-token contains invalid fields. Run --dry-run again.");
  }
  const canonical = `${version}.${stage}.${issuedAtText}.${hash}.${quoteText}.${tokenCredentialFingerprint}`;
  if (!equalFixedText(tag, approvalTag(canonical))) throw new Error("--approval-token checksum does not match. Run --dry-run again.");
  const safeExpectedStage = String(expectedStage).trim().toLowerCase();
  const safeExpectedHash = String(expectedHash).trim().toLowerCase();
  const safeExpectedCredentialFingerprint = String(expectedCredentialFingerprint || "").trim().toLowerCase();
  if (stage !== safeExpectedStage) throw new Error(`--approval-token belongs to ${stage}, not ${safeExpectedStage}.`);
  if (hash !== safeExpectedHash) throw new Error("--approval-token does not match the current request. Run --dry-run again.");
  if (!equalFixedText(tokenCredentialFingerprint, safeExpectedCredentialFingerprint)) {
    throw new Error("--approval-token belongs to a different HiAPI credential. Use the same API key as the matching --dry-run or obtain a new approval.");
  }
  const issuedAt = Number(issuedAtText);
  const quoteMicrousd = Number(quoteText);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(quoteMicrousd)) throw new Error("--approval-token numeric fields are unsafe.");
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) throw new Error("Current time is invalid.");
  if (issuedAt > nowSeconds + 60) throw new Error("--approval-token was issued in the future. Run --dry-run again.");
  if (nowSeconds >= issuedAt + APPROVAL_TTL_SECONDS) throw new Error("--approval-token has expired. Run --dry-run again for current pricing.");
  return {
    token: raw,
    version,
    stage,
    requestHash: hash,
    credentialFingerprint: tokenCredentialFingerprint,
    quoteMicrousd,
    approvedQuoteUsd: quoteMicrousd / 1_000_000,
    issuedAt,
    issuedAtIso: new Date(issuedAt * 1000).toISOString(),
    expiresAt: issuedAt + APPROVAL_TTL_SECONDS,
    expiresAtIso: new Date((issuedAt + APPROVAL_TTL_SECONDS) * 1000).toISOString(),
  };
}

export function idempotencyKeyForApproval(providedKey, approval) {
  if (!approval?.token || !APPROVAL_STAGES.has(approval.stage) || !/^[a-f0-9]{64}$/.test(approval.requestHash || "")) {
    throw new Error("A validated approval token is required to derive the idempotency key.");
  }
  const digest = createHash("sha256").update(`idempotency-v1\0${approval.token}`).digest("hex").slice(0, 20);
  const expected = `${approval.stage}-${approval.requestHash.slice(0, 12)}-${digest}`;
  if (providedKey && !equalFixedText(providedKey, expected)) {
    throw new Error("--idempotency-key must exactly match the key derived from --approval-token.");
  }
  return expected;
}

export async function fetchJson(url, init = {}, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Request timed out: ${url}`);
    throw new Error(`Request failed: ${error?.message || "unknown network error"}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  return { response, body };
}

export async function runChecks(config, deps = {}) {
  requireApiKey(config);
  const pricing = await fetchJson(`${config.baseUrl}/api/pricing`, {}, deps);
  if (!pricing.response.ok) throw new Error(`Live pricing check failed: HTTP ${pricing.response.status}.`);
  const auth = await fetchJson(`${config.baseUrl}/v1/tasks?page=1&size=1`, { headers: { Authorization: `Bearer ${config.apiKey}` } }, deps);
  if (!auth.response.ok) throw new Error(`Authentication check failed: HTTP ${auth.response.status}.`);
  return { authentication: "ok", livePricing: "ok", modelAvailable: responseRows(pricing.body).some((row) => row.model_name === MODEL) };
}

export function extractTaskId(body) {
  return body?.data?.taskId || body?.data?.task_id || body?.data?.id || body?.taskId || body?.task_id || body?.id || "";
}

function errorSummary(body, status) {
  return body?.error?.message || body?.message || body?.error || `HTTP ${status}`;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function makeSubmissionError(message, { code = "SUBMISSION_FAILED", outcome = "unresolved", httpStatus = null, cause = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.submissionOutcome = outcome;
  if (httpStatus !== null) error.httpStatus = httpStatus;
  if (cause) error.cause = cause;
  return error;
}

export async function submitTask(config, payload, idempotencyKey, deps = {}, guard = {}) {
  const sleepImpl = deps.sleepImpl || sleep;
  const nowImpl = typeof guard.now === "function" ? guard.now : Date.now;
  const approvalExpiresAt = Number(guard.approvalExpiresAt || 0);
  const body = JSON.stringify(payload);
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= MAX_SUBMISSION_ATTEMPTS; attempt += 1) {
    if (approvalExpiresAt > 0 && Math.floor(Number(nowImpl()) / 1000) >= approvalExpiresAt) {
      throw makeSubmissionError(
        "Approval expired during task submission. Do not mint a new token until the submission journal confirms whether an earlier attempt created a task.",
        { code: "APPROVAL_EXPIRED_DURING_SUBMISSION", outcome: attemptsMade === 0 ? "not-submitted" : "unresolved" },
      );
    }
    let result;
    try {
      attemptsMade += 1;
      result = await fetchJson(`${config.baseUrl}/v1/tasks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body,
      }, deps);
    } catch (error) {
      if (attempt === MAX_SUBMISSION_ATTEMPTS) {
        throw makeSubmissionError(
          "Task submission transport remained unresolved after bounded same-key retries. Do not create a new approval; inspect the submission journal and retry the exact command with the same token before it expires.",
          { code: "SUBMISSION_TRANSPORT_UNRESOLVED", outcome: "unresolved", cause: error },
        );
      }
      await sleepImpl(Math.min(attempt, 5) * 1000);
      continue;
    }
    const taskId = extractTaskId(result.body);
    if (result.response.ok) {
      if (!taskId) {
        if (attempt === MAX_SUBMISSION_ATTEMPTS) {
          throw makeSubmissionError(
            "Task submission returned success without a task ID after bounded same-key retries. Do not create a new approval; inspect the submission journal.",
            { code: "SUBMISSION_SUCCESS_WITHOUT_TASK_ID", outcome: "unresolved", httpStatus: result.response.status },
          );
        }
        await sleepImpl(5000);
        continue;
      }
      const replayed = String(result.response.headers.get("Idempotent-Replay") || "").toLowerCase() === "true";
      return { taskId, replayed, replayEvidence: replayed ? "idempotent-replay-header" : "none", httpStatus: result.response.status };
    }
    if (result.response.status === 409 && taskId) {
      return { taskId, replayed: true, replayEvidence: "compat-409-task-id", httpStatus: result.response.status };
    }
    const retryable = RETRYABLE_STATUSES.has(result.response.status) || result.response.status >= 500;
    if (!retryable || attempt === MAX_SUBMISSION_ATTEMPTS) {
      const definitelyRejected = new Set([400, 401, 402, 403, 404, 405, 413, 415, 422]).has(result.response.status);
      throw makeSubmissionError(`Task submission failed: ${errorSummary(result.body, result.response.status)}`, {
        code: definitelyRejected ? "SUBMISSION_REJECTED" : "SUBMISSION_UNRESOLVED",
        outcome: definitelyRejected ? "rejected" : "unresolved",
        httpStatus: result.response.status,
      });
    }
    const retryAfter = Number(result.response.headers.get("retry-after"));
    await sleepImpl((Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) : attempt * 2) * 1000);
  }
  throw new Error("Task submission failed after bounded retries.");
}

function unwrapTask(body, taskId) {
  const task = body?.data || body;
  return { ...task, taskId: task?.taskId || task?.task_id || task?.id || taskId };
}

export function assertTaskMatchesRequest(task, payload) {
  const taskModel = String(task.model || task.model_name || "").trim();
  if (!taskModel || taskModel.toLowerCase() !== payload.model.toLowerCase()) throw new Error("Returned task model does not match the approved request.");
  const expectedFields = ["prompt", "duration", "resolution", "sound", "image_urls"]
    .filter((field) => Object.hasOwn(payload.input, field));
  if (!task.input || typeof task.input !== "object") return { modelMatched: true, inputEcho: "not-returned", comparedFields: [] };
  const comparedFields = [];
  for (const field of expectedFields) {
    if (!Object.hasOwn(task.input, field)) continue;
    comparedFields.push(field);
    if (JSON.stringify(task.input[field]) !== JSON.stringify(payload.input[field])) throw new Error(`Returned task input mismatch: ${field}.`);
  }
  const inputEcho = comparedFields.length === 0 ? "not-returned" : comparedFields.length === expectedFields.length ? "complete" : "partial";
  return { modelMatched: true, inputEcho, comparedFields };
}

function assertRecoveredTaskModel(task, expectedModel) {
  const taskModel = String(task.model || task.model_name || "").trim();
  if (!taskModel || taskModel.toLowerCase() !== expectedModel.toLowerCase()) {
    throw new Error(`Task ${task.taskId || ""} is not a ${expectedModel} task and cannot be recovered by this CLI.`);
  }
}

export async function pollTask(config, taskId, intervalSeconds, timeoutSeconds, deps = {}) {
  const sleepImpl = deps.sleepImpl || sleep;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = await fetchJson(`${config.baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${config.apiKey}` } }, deps);
    if (RETRYABLE_STATUSES.has(result.response.status)) {
      await sleepImpl(intervalSeconds * 1000);
      continue;
    }
    if (!result.response.ok) throw new Error(`Task polling failed: HTTP ${result.response.status}.`);
    const task = unwrapTask(result.body, taskId);
    const status = String(task.status || "").toLowerCase();
    if (SUCCESS_STATUSES.has(status)) return task;
    if (FAILURE_STATUSES.has(status)) throw new Error(`${task.error?.code || "TASK_FAILED"}: ${task.error?.message || task.fail_reason || "Generation failed."}`);
    await sleepImpl(intervalSeconds * 1000);
  }
  return { taskId, status: "timeout" };
}

export function isMp4Buffer(bytes) {
  try {
    const top = childBoxes(bytes, 0, bytes.length);
    return Boolean(top?.some((box) => box.type === "ftyp") && top?.some((box) => box.type === "moov") && top?.some((box) => box.type === "mdat" && box.size > box.headerSize));
  } catch {
    return false;
  }
}

function findVideoUrl(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return "";
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? value : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const key of ["output", "outputs", "result", "results", "video_url", "file_url", "url", "data"]) {
      if (Object.hasOwn(value, key)) {
        const found = findVideoUrl(value[key], depth + 1);
        if (found) return found;
      }
    }
  }
  return "";
}

async function downloadVideoBytes(url, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const maxBytes = deps.maxDownloadBytes ?? MAX_OUTPUT_VIDEO_BYTES;
  const timeoutMs = deps.downloadTimeoutMs ?? OUTPUT_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Video download byte limit is invalid.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Video download timeout is invalid.");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (response.status !== 200) throw new Error(`Video download failed: HTTP ${response.status}.`);
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const declaredBytes = Number(contentLength);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        throw new Error(`Video download exceeds the ${maxBytes}-byte limit.`);
      }
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new Error("Video download returned no readable response body.");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel("video download byte limit exceeded");
          } catch {
            // Preserve the size-limit error even if stream cancellation fails.
          }
          throw new Error(`Video download exceeds the ${maxBytes}-byte limit.`);
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    if (timedOut || (controller.signal.aborted && error?.name === "AbortError")) {
      throw new Error(`Video download timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadTaskVideo(task, directory, deps = {}) {
  const url = findVideoUrl(task);
  if (!url) throw new Error("Task succeeded without a downloadable MP4 URL.");
  const bytes = await downloadVideoBytes(url, deps);
  if (!isMp4Buffer(bytes)) throw new Error("Downloaded output is not a valid MP4 container.");
  const videoPath = resolve(directory, "final.mp4");
  await writeFile(videoPath, bytes);
  return { videoPath, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");
}

async function writeTextAtomically(filePath, text, deps = {}) {
  const openImpl = deps.openImpl || open;
  const renameImpl = deps.renameImpl || rename;
  const rmImpl = deps.rmImpl || rm;
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle = null;
  try {
    handle = await openImpl(temporaryPath, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await renameImpl(temporaryPath, filePath);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the original write or replacement error.
      }
    }
    try {
      await rmImpl(temporaryPath, { force: true });
    } catch {
      // A failed cleanup must not hide the journal write failure.
    }
    throw error;
  }
}

export async function writeSubmissionJournal(options, record, deps = {}) {
  const idempotencyKey = String(record.idempotencyKey || "");
  if (!/^[a-z0-9_-]{20,128}$/i.test(idempotencyKey)) throw new Error("Cannot write a submission journal for an invalid idempotency key.");
  const directory = resolve(options.outputDir, ".hiapi-submissions");
  await mkdir(directory, { recursive: true });
  const journalPath = resolve(directory, `${idempotencyKey}.json`);
  let existing = {};
  try {
    existing = JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`Cannot safely update the existing submission journal: ${error?.message || "invalid JSON"}`);
  }
  for (const field of ["idempotencyKey", "stage", "model", "requestHash"]) {
    if (existing[field] && record[field] && existing[field] !== record[field]) throw new Error(`Submission journal ${field} does not match the current request.`);
  }
  const nextState = record.state === "submission_pending" && existing.taskId ? existing.state : record.state;
  const merged = {
    schemaVersion: 1,
    ...existing,
    ...record,
    state: nextState,
    createdAt: existing.createdAt || record.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeTextAtomically(journalPath, `${JSON.stringify(merged, null, 2)}\n`, deps);
  return journalPath;
}

export async function findSubmissionJournal(options, taskId, expectedStage) {
  const directory = resolve(options.outputDir, ".hiapi-submissions");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    let record;
    try {
      record = JSON.parse(await readFile(resolve(directory, entry.name), "utf8"));
    } catch {
      continue;
    }
    if (String(record.taskId || "") === String(taskId) && record.stage === expectedStage) {
      return {
        status: "journal-matched",
        stage: record.stage,
        model: record.model || null,
        requestHash: record.requestHash || null,
        idempotencyKey: record.idempotencyKey || null,
      };
    }
  }
  return null;
}

export function uniqueOutputDirectory(baseDirectory, style, taskId) {
  const safeTaskId = String(taskId).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "task";
  return resolve(baseDirectory, `${timestamp()}-${style}-${safeTaskId}-${randomUUID().replace(/-/g, "").slice(0, 10)}`);
}

function qcTemplate(renderControls = null) {
  const checks = [
    "described_action_beat_order_timing_and_duration",
    "single_continuous_shot_without_invented_cuts",
    "camera_framing_blocking_screen_direction_and_spatial_layout",
    "character_count_role_species_color_markings_scale_and_identity",
    "pose_action_timing_object_interaction_and_contact",
    "requested_surface_finish_material_response_and_cross_shot_consistency",
    "requested_lighting_direction_exposure_contrast_and_shadow_behavior",
    "requested_depth_strength_geometry_parallax_occlusion_and_focus_readability",
    "requested_motion_fidelity_timing_weight_deformation_and_physics",
    "requested_realism_anatomy_material_lens_and_contact_behavior",
    "no_flat_2d_outlines_source_frames_split_screen_player_ui_text_or_watermark",
    "anatomy_faces_hands_feet_limb_count_and_physical_plausibility",
    "no_flicker_texture_boiling_character_merging_prop_loss_or_late_frame_drift",
    "audio_sync_and_no_unapproved_source_music_or_dialogue_copy",
  ];
  return {
    status: "pending_human_review",
    result: "generated_unreviewed",
    requestedControls: renderControls,
    checks: checks.map((id) => ({ id, status: "not_reviewed" })),
  };
}

function briefMarkdown(built) {
  const controlSource = (key) => Array.isArray(built.controlOverrides)
    ? (built.controlOverrides.includes(key) ? "explicit override" : `${built.style} default`)
    : "unknown from resumed task";
  return `# Animation To Real-World Video Brief

- Reconstruction: real-world live action from an approved photoreal start image
- Style: ${built.style}
- Model: ${built.payload.model}
- Storyboard duration: ${Number.isFinite(built.sourceFacts.duration) ? `${built.sourceFacts.duration.toFixed(3)} seconds` : "not supplied"}
- Storyboard frame time: ${Number.isFinite(built.sourceFrameSeconds) ? `${built.sourceFrameSeconds.toFixed(3)} seconds` : "storyboard image"}
- Approved real-world start image: ${built.realWorldStartFacts ? `${built.realWorldStartFacts.width}x${built.realWorldStartFacts.height}` : "unknown from resumed task"}
- Output duration: ${built.seconds} seconds
- Resolution: ${built.resolution}
- Input image ratio: ${built.ratio}
- Generated audio: ${built.audioEnabled === true ? "enabled" : built.audioEnabled === false ? "disabled" : "unknown"}
- Kling input images: ${built.inputImageCount}
- Asset rights confirmed: ${built.rightsConfirmation?.assetRightsConfirmed === true ? "yes" : "unknown from resumed task"}
- Real-world start image reviewed: ${built.rightsConfirmation?.realWorldStartImageApproved === true ? "yes" : "unknown from resumed task"}
- Appearance-first motion acknowledged: ${built.rightsConfirmation?.appearanceFirstAcknowledged === true ? "yes" : built.rightsConfirmation ? "not applicable" : "unknown from resumed task"}

## Motion Direction

- Action: ${built.actionDescription || "Unavailable from resumed task"}
- Camera: ${built.cameraDescription || "Stable motivated camera; unavailable from resumed task"}

## Resolved 3D Controls

- Surface: ${built.renderControls?.surface ?? "unknown"} (${controlSource("surface")})
- Lighting: ${built.renderControls?.lighting ?? "unknown"} (${controlSource("lighting")})
- Depth strength: ${built.renderControls?.depthStrength ?? "unknown"} (${controlSource("depthStrength")})
- Motion fidelity: ${built.renderControls?.motionFidelity ?? "unknown"} (${controlSource("motionFidelity")})
- Realism: ${built.renderControls?.realism ?? "unknown"}${Number.isInteger(built.renderControls?.realism) ? "/100" : ""} (${controlSource("realism")})

## Subject Mapping

${built.characterMaps.length ? built.characterMaps.map((item) => `- ${item}`).join("\n") : "- Unavailable from resumed task"}

## Final Prompt

${built.prompt}

## Review Status

generated_unreviewed - inspect the complete clip against qc.json before publication or reuse.
`;
}

async function writePackageFiles(directory, built, manifest) {
  await Promise.all([
    writeFile(resolve(directory, "brief.md"), briefMarkdown(built), "utf8"),
    writeFile(resolve(directory, "prompt.json"), `${JSON.stringify(redactPayload(built.payload), null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "qc.json"), `${JSON.stringify(qcTemplate(built.renderControls), null, 2)}\n`, "utf8"),
  ]);
}

async function savePackage(options, built, task, estimatedCostUsd, approval, submission, taskEchoVerification, deps = {}) {
  const directory = uniqueOutputDirectory(options.outputDir, built.style, task.taskId);
  await mkdir(directory, { recursive: true });
  const video = await downloadTaskVideo(task, directory, deps);
  const manifest = {
    skill: "hiapi-2d-to-3d-video",
    style: built.style,
    renderControls: built.renderControls,
    controlOverrides: built.controlOverrides,
    model: built.payload.model,
    taskId: task.taskId,
    taskStatus: task.status,
    status: "generated_unreviewed",
    estimatedCostUsd,
    approvalVersion: approval.version,
    approvedQuoteUsd: approval.approvedQuoteUsd,
    approvalIssuedAt: approval.issuedAtIso,
    approvalExpiresAt: approval.expiresAtIso,
    idempotencyKey: submission.idempotencyKey,
    submissionReplayed: submission.replayed,
    submissionReplayEvidence: submission.replayEvidence,
    submissionHttpStatus: submission.httpStatus,
    taskEchoVerification,
    costEstimateScope: "public_pricing_before_account_group_ratio",
    requestHash: approval.requestHash,
    storyboardMedia: built.sourceFacts,
    storyboardFrameMedia: built.sourceFrameFacts,
    realWorldStartImageMedia: built.realWorldStartFacts,
    inputImageMedia: built.inputImageFacts,
    outputVideo: { file: "final.mp4", bytes: video.bytes, sha256: video.sha256 },
    rightsConfirmation: built.rightsConfirmation,
    storage: "temp",
    createdAt: new Date().toISOString(),
  };
  await writePackageFiles(directory, built, manifest);
  return { directory, videoPath: video.videoPath, manifest };
}

async function saveRecoveredPackage(options, task, recoveryBinding, deps = {}) {
  const built = {
    style: "recovered-task",
    payload: { model: task.model || task.model_name || MODEL, input: {} },
    sourceFacts: { duration: Number(task.input?.duration || 0) },
    sourceFrameFacts: null,
    sourceFrameSeconds: null,
    realWorldStartFacts: null,
    inputImageFacts: [],
    seconds: task.input?.duration || "unknown",
    resolution: task.input?.resolution || "unknown",
    ratio: "determined by remote input image",
    audioEnabled: task.input?.sound ?? "unknown",
    inputImageCount: Array.isArray(task.input?.image_urls) ? task.input.image_urls.length : "unknown",
    actionDescription: "",
    cameraDescription: "",
    characterMaps: [],
    renderControls: null,
    controlOverrides: null,
    prompt: task.input?.prompt || "Original prompt unavailable; inspect the remote task before use.",
    rightsConfirmation: null,
  };
  const directory = uniqueOutputDirectory(options.outputDir, built.style, task.taskId);
  await mkdir(directory, { recursive: true });
  const video = await downloadTaskVideo(task, directory, deps);
  const manifest = {
    skill: "hiapi-2d-to-3d-video",
    style: built.style,
    renderControls: null,
    controlOverrides: null,
    model: built.payload.model,
    taskId: task.taskId,
    taskStatus: task.status,
    status: "generated_unreviewed",
    recovered: true,
    recoveryBinding,
    estimatedCostUsd: null,
    requestHash: null,
    taskEchoVerification: { modelMatched: true, inputEcho: "not-returned", comparedFields: [] },
    outputVideo: { file: "final.mp4", bytes: video.bytes, sha256: video.sha256 },
    storage: task.storage || "temp",
    createdAt: new Date().toISOString(),
  };
  await writePackageFiles(directory, built, manifest);
  return { directory, videoPath: video.videoPath, manifest };
}

async function getPricing(deps) {
  const pricing = await fetchJson(`${BASE_URL}/api/pricing`, { headers: { "Cache-Control": "no-cache" } }, deps);
  if (!pricing.response.ok) throw new Error(`Live pricing check failed: HTTP ${pricing.response.status}.`);
  return pricing.body;
}

export async function main(args = process.argv.slice(2), deps = {}) {
  const print = deps.print || console.log;
  const options = parseArgs(args);
  const mode = validateExecutionMode(options);
  if (mode === "help") {
    print(usage());
    return;
  }
  if (mode === "check") {
    print(JSON.stringify(await runChecks(await resolveConfig(options), deps), null, 2));
    return;
  }
  if (mode === "resume") {
    const config = await resolveConfig(options);
    requireApiKey(config);
    const recoveryBinding = await findSubmissionJournal(options, options.taskId, "2d3d") || {
      status: "unverified-model-only",
      stage: "2d3d",
      model: MODEL,
      requestHash: null,
      idempotencyKey: null,
    };
    const task = await pollTask(config, options.taskId, options.pollIntervalSeconds, options.pollTimeoutSeconds, deps);
    if (task.status === "timeout") {
      print(JSON.stringify({ taskId: options.taskId, status: "timeout", message: "Task may still be running; retry with the same --task-id." }, null, 2));
      return;
    }
    assertRecoveredTaskModel(task, MODEL);
    const saved = await saveRecoveredPackage(options, task, recoveryBinding, deps);
    print(JSON.stringify({ taskId: options.taskId, status: "generated_unreviewed", outputDirectory: saved.directory, videoPath: saved.videoPath, resumed: true }, null, 2));
    return;
  }
  const built = await buildRequest(options, deps);
  const hash = workflowRequestHash(built);
  if (mode !== "preview") requireByteBoundMedia(built);
  if (mode !== "spend" && (options.approvalToken || options.approvedRequestHash)) {
    throw new Error("Approval credentials are valid only with --spend. Run an unchanged --dry-run to obtain a fresh token.");
  }
  if (mode === "preview") {
    print(JSON.stringify({
      mode,
      model: built.payload.model,
      style: built.style,
      renderControls: built.renderControls,
      controlOverrides: built.controlOverrides,
      requestHash: hash,
      sourceFacts: built.sourceFacts,
      sourceFrameFacts: built.sourceFrameFacts,
      realWorldStartFacts: built.realWorldStartFacts,
      inputImageFacts: built.inputImageFacts,
      actionDescription: built.actionDescription,
      cameraDescription: built.cameraDescription,
      promptCharacters: built.promptCharacters,
      duration: built.seconds,
      resolution: built.resolution,
      sound: built.audioEnabled,
      warnings: built.warnings,
      networkAccess: false,
      estimatedCostUsd: null,
      payload: redactPayload(built.payload),
    }, null, 2));
    return;
  }
  if (mode === "spend" && options.approvedRequestHash) {
    throw new Error("--approved-request-hash is a legacy approval that does not bind price or one idempotent attempt. Run --dry-run again and use --approval-token.");
  }
  if (mode === "spend" && !options.approvalToken) throw new Error("--spend requires --approval-token from the matching --dry-run.");
  const nowMs = typeof deps.now === "function" ? deps.now() : Date.now();
  const config = await resolveConfig(options);
  requireApiKey(config);
  const currentCredentialFingerprint = credentialFingerprint(config.apiKey);
  let approval = null;
  if (mode === "spend") approval = parseApprovalToken(options.approvalToken, "2d3d", hash, currentCredentialFingerprint, nowMs);
  const pricing = await getPricing(deps);
  const estimatedCostUsd = estimateCostUsd(pricing, built.payload);
  enforceBudget(estimatedCostUsd, options.maxCostUsd);
  if (approval && usdToMicros(estimatedCostUsd) > approval.quoteMicrousd) {
    throw new Error(`Live estimate $${estimatedCostUsd.toFixed(6)} exceeds the approved quote $${approval.approvedQuoteUsd.toFixed(6)}. Run --dry-run again.`);
  }
  const estimate = {
    mode,
    model: built.payload.model,
    style: built.style,
    renderControls: built.renderControls,
    controlOverrides: built.controlOverrides,
    requestHash: hash,
    sourceFacts: built.sourceFacts,
    sourceFrameFacts: built.sourceFrameFacts,
    realWorldStartFacts: built.realWorldStartFacts,
    inputImageFacts: built.inputImageFacts,
    actionDescription: built.actionDescription,
    cameraDescription: built.cameraDescription,
    promptCharacters: built.promptCharacters,
    duration: built.seconds,
    resolution: built.resolution,
    sound: built.audioEnabled,
    warnings: built.warnings,
    estimatedCostUsd,
    maxCostUsd: options.maxCostUsd,
    costEstimateScope: "public_pricing_before_account_group_ratio",
    warning: "The server may apply an account group ratio; this estimate is not a server-enforced final-charge cap.",
    payload: redactPayload(built.payload),
  };
  if (mode === "dry-run") {
    approval = createApprovalToken("2d3d", hash, estimatedCostUsd, currentCredentialFingerprint, nowMs);
    print(JSON.stringify({
      ...estimate,
      approvalVersion: approval.version,
      approvedQuoteUsd: approval.approvedQuoteUsd,
      approvalToken: approval.token,
      approvalIssuedAt: approval.issuedAtIso,
      approvalExpiresAt: approval.expiresAtIso,
      idempotencyKey: idempotencyKeyForApproval(undefined, approval),
    }, null, 2));
    return;
  }
  const idempotencyKey = idempotencyKeyForApproval(options.idempotencyKey, approval);
  const journalBase = {
    stage: "2d3d",
    state: "submission_pending",
    model: built.payload.model,
    requestHash: hash,
    idempotencyKey,
    approvedQuoteUsd: approval.approvedQuoteUsd,
    approvalIssuedAt: approval.issuedAtIso,
    approvalExpiresAt: approval.expiresAtIso,
    storyboardSha256: built.sourceFacts.sha256,
    storyboardFrameSha256: built.sourceFrameFacts.sha256,
    realWorldStartImageSha256: built.realWorldStartFacts.sha256,
    inputImageSha256: built.inputImageFacts.map((image) => image.sha256),
    createdAt: new Date().toISOString(),
  };
  const journalPath = await writeSubmissionJournal(options, journalBase);
  print(JSON.stringify({ event: "submission-ready", idempotencyKey, journalPath, estimatedCostUsd, approvedQuoteUsd: approval.approvedQuoteUsd, requestHash: hash, renderControls: built.renderControls }));
  let submission;
  try {
    submission = await submitTask(config, built.payload, idempotencyKey, deps, { approvalExpiresAt: approval.expiresAt, now: deps.now });
  } catch (error) {
    const state = error.submissionOutcome === "rejected"
      ? "submission_rejected"
      : error.submissionOutcome === "not-submitted"
        ? "submission_not_started"
        : "submission_unresolved";
    await writeSubmissionJournal(options, { ...journalBase, state, errorCode: error.code || "SUBMISSION_FAILED", httpStatus: error.httpStatus || null });
    throw error;
  }
  const { taskId } = submission;
  print(JSON.stringify({ event: "task-created-or-replayed", taskId, replayed: submission.replayed, estimatedCostUsd }));
  const submissionFacts = { taskId, replayed: submission.replayed, replayEvidence: submission.replayEvidence, httpStatus: submission.httpStatus };
  await writeSubmissionJournal(options, { ...journalBase, state: "task_id_received", ...submissionFacts });
  const task = await pollTask(config, taskId, options.pollIntervalSeconds, options.pollTimeoutSeconds, deps);
  if (task.status === "timeout") {
    await writeSubmissionJournal(options, { ...journalBase, state: "task_pending", ...submissionFacts });
    print(JSON.stringify({ taskId, status: "timeout", estimatedCostUsd, message: "Task may still be running; resume with --task-id." }, null, 2));
    return;
  }
  const taskEchoVerification = assertTaskMatchesRequest(task, built.payload);
  const saved = await savePackage(options, built, task, estimatedCostUsd, approval, { ...submission, idempotencyKey }, taskEchoVerification, deps);
  await writeSubmissionJournal(options, { ...journalBase, state: "package_saved", ...submissionFacts });
  print(JSON.stringify({ taskId, taskStatus: task.status, status: "generated_unreviewed", model: built.payload.model, renderControls: built.renderControls, estimatedCostUsd, outputDirectory: saved.directory, videoPath: saved.videoPath }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
