# HiAPI Animation Forge

An asset-first Agent Skill for turning an authorized 2D animation or storyboard into a staged 3D and live-action production plan. It separates source analysis, geometry and rigging, motion and camera solving, Blender previews, and optional generative rendering.

This repository is deliberately conservative: a video-model success is never treated as a frame-exact 3D reconstruction. The skill records what is planned, what is externally configured, and what still requires source-lock review.

## What It Solves

- Plans a source-locked or appearance-first 2D-to-3D conversion.
- Routes geometry, rigging, tracking, camera solving, Blender, and render adapters by declared capability.
- Enforces rights, source hashes, fidelity contracts, paid-task approval, and source-lock QC states.
- Includes a local Seedance reference-motion runtime for source-locked candidates. The runtime is bundled, so installation does not depend on a sibling or archived repository.

## Install

```bash
npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill -y
```

Target one runtime when needed:

```bash
npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill --codex
npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill --claude
npx -y github:HiAPIAI/hiapi-2d-to-3d-video-skill --target=/path/to/skills
```

The installer copies the skill and its vendored `scripts/reference-motion-transfer/` runtime together. Existing local installations are protected unless `--force` is passed.

## Plan Before Spending

The planner is local and free:

```bash
node scripts/plan-animation-forge.mjs \
  --source-file /path/to/authorized-shot.mp4 \
  --goal cinematic-video \
  --fidelity source-locked \
  --source-style animation-frame \
  --subject-topology animal \
  --scene-mode dynamic \
  --available-adapter seedance \
  --rights-confirmed
```

The result is a plan, not evidence that a 3D asset or video exists. Resolve every external adapter gate before pricing or generation.

For a Seedance source-locked candidate, use the bundled runtime after an approved target-world image is available:

```bash
node scripts/reference-motion-transfer/hiapi-reference-motion-transfer.mjs \
  --mode balanced \
  --reference-video-file /path/to/authorized-shot.mp4 \
  --reference-image-file /path/to/approved-target-world.png \
  --prompt "Video 1 controls event order, timing, camera, framing, blocking, contacts, screen direction, and prop state. Image 1 controls target subjects, environment, materials, and light. Add, remove, reorder, or retime no event." \
  --seconds 8 \
  --ratio 16:9 \
  --resolution 720p \
  --no-audio \
  --dry-run
```

Remove `--dry-run` only after reviewing the redacted payload, current cost, source rights, and explicit generation approval. A balanced Seedance result remains `generated_unreviewed` until source-lock QC passes.

## Fidelity Contracts

| Contract | Meaning |
| --- | --- |
| `frame-exact` | Requires deterministic segmentation, tracking, solving, rigging, rendering, and compositing. Missing capability blocks execution. |
| `source-locked` | Preserves the source timeline and is the default for supplied videos. Generative output remains a candidate until review. |
| `appearance-first` | Allows new motion from an approved target-world image after the user acknowledges that source synchronization is not promised. |

Read [`SKILL.md`](SKILL.md) and the references before execution. The skill does not silently downgrade a fidelity contract, claim a generated asset from a plan, or publish an output.

## Development

```bash
npm test
npm run check
```

The repository is MIT licensed. The bundled reference-motion runtime is maintained as a compatibility copy of the archived [`hiapi-reference-motion-transfer-skill`](https://github.com/HiAPIAI/hiapi-reference-motion-transfer-skill) runtime at commit `5494ed9dd6a0dcd4d527adcaf959d49ae45b8232`. Update that copy deliberately and rerun the full test suite when the Seedance contract changes.
