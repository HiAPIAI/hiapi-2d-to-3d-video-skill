#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, env, exit, stdin } from "node:process";

const SKILL_NAME = "hiapi-2d-to-3d-video";
const DISPLAY_NAME = "HiAPI Animation Forge";
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPY_ENTRIES = [
  ".env.example",
  "LICENSE",
  "SKILL.md",
  "agents",
  "package.json",
  "references",
  "scripts",
];

function usage() {
  return `${DISPLAY_NAME} installer

Usage:
  npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill -y
  node scripts/install.mjs --codex
  node scripts/install.mjs --claude
  node scripts/install.mjs --target=/path/to/skills

Options:
  -y, --yes             Install to every detected agent when non-interactive
  --codex               Install to the Codex skills directory
  --claude              Install to the Claude Code skills directory
  --target=PATH          Install to a custom skills directory
  --skills-dir=PATH      Alias for --target
  --force                Replace an existing installation
  -h, --help             Show this help
`;
}

function flagValue(args, name) {
  const prefix = `--${name}=`;
  const hit = args.find((argument) => argument.startsWith(prefix));
  if (!hit) return null;
  const value = hit.slice(prefix.length);
  return value.replace(/^~(?=$|[\\/])/, homedir());
}

function detectedTargets() {
  const targets = [];
  const codexHome = env.CODEX_HOME || join(homedir(), ".codex");
  if (existsSync(codexHome)) targets.push({ label: "Codex", dir: join(codexHome, "skills") });

  const claudeHome = join(homedir(), ".claude");
  if (existsSync(claudeHome)) targets.push({ label: "Claude Code", dir: join(claudeHome, "skills") });
  return targets;
}

function resolveTargets(args) {
  const explicitTarget = flagValue(args, "target") ?? flagValue(args, "skills-dir");
  if (explicitTarget) return [{ label: "custom", dir: resolve(explicitTarget) }];
  if (env.AGENT_SKILLS_DIR) return [{ label: "$AGENT_SKILLS_DIR", dir: resolve(env.AGENT_SKILLS_DIR) }];

  const codexHome = env.CODEX_HOME || join(homedir(), ".codex");
  if (args.includes("--codex")) return [{ label: "Codex", dir: join(codexHome, "skills") }];
  if (args.includes("--claude")) return [{ label: "Claude Code", dir: join(homedir(), ".claude", "skills") }];

  const targets = detectedTargets();
  if (targets.length === 0) {
    throw new Error("No agent skills directory detected. Pass --codex, --claude, or --target=PATH.");
  }
  if (targets.length > 1 && stdin.isTTY && !args.includes("-y") && !args.includes("--yes")) {
    throw new Error("Multiple agents detected. Pass -y to install to all, or select --codex/--claude.");
  }
  return targets;
}

function installTo(target, force) {
  const destination = join(target.dir, SKILL_NAME);
  if (existsSync(destination)) {
    if (!force) throw new Error(`${destination} already exists. Re-run with --force to replace it.`);
    rmSync(destination, { recursive: true, force: true });
  }

  mkdirSync(destination, { recursive: true });
  for (const entry of COPY_ENTRIES) {
    const source = join(SOURCE_ROOT, entry);
    if (existsSync(source)) cpSync(source, join(destination, entry), { recursive: true });
  }
  console.log(`[${DISPLAY_NAME}] Installed for ${target.label}: ${destination}`);
}

export function main(args = argv.slice(2)) {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(usage());
    return;
  }

  const force = args.includes("--force");
  for (const target of resolveTargets(args)) installTo(target, force);
  if (!env.HIAPI_API_KEY?.trim()) {
    console.log(`[${DISPLAY_NAME}] HIAPI_API_KEY is not set. Create one at https://www.hiapi.ai/en/dashboard/api-keys and store it in your agent or OS secret environment.`);
  }
  console.log(`[${DISPLAY_NAME}] Restart the agent if it caches installed skills.`);
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[${DISPLAY_NAME}] ${error?.message ?? error}`);
    exit(1);
  }
}
