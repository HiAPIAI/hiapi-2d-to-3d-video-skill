---
name: hiapi-2d-to-3d-video
description: "Plan and execute authorized 2D-animation-to-3D production as HiAPI Animation Forge: analyze a source image or video, choose an asset-first character/scene reconstruction route, gate multiview geometry, rigging, motion/camera solving and Blender previews, then optionally use Seedance or Kling only as final generative rendering. Use for rigged 3D assets, Blender-ready scenes, 2D animation reconstruction, source-locked cinematic conversion, or appearance-first 3D-style video. Never treat a video model as a frame-exact motion or geometry solver."
---

# HiAPI Animation Forge

Treat 2D-to-3D as a staged production pipeline, not one model call:

```text
authorized 2D source
  -> shot and asset analysis
  -> character and scene evidence
  -> multiview / geometry candidates
  -> rig, skin, materials and hierarchy
  -> source motion and camera solve
  -> deterministic Blender preview
  -> optional Seedance or Kling render
  -> source-lock QC
```

Keep the skill name for compatibility. Use **HiAPI Animation Forge** as its user-facing product name.

## Start Here

1. Confirm rights to all source media, likenesses, logos, target references, models, checkpoints and audio.
2. Read [references/pipeline-architecture.md](references/pipeline-architecture.md) and select the fidelity contract before choosing a backend.
3. For a source video, read [references/source-lock.md](references/source-lock.md) and build its timestamped acceptance table.
4. Read [references/external-adapters.md](references/external-adapters.md) before naming AniGen, DrawingSpinUp, img2threejs, Wonder3D, Zero123, Gaussian Splatting, AnimateDiff or Mesh2Motion as an executable backend.
5. Run the offline planner. Pass only adapters that were actually found and whose license/hardware gate was reviewed:

```powershell
node scripts/plan-animation-forge.mjs `
  --source-file "D:\media\authorized-shot.mp4" `
  --goal cinematic-video `
  --fidelity source-locked `
  --source-style animation-frame `
  --subject-topology animal `
  --scene-mode dynamic `
  --available-adapter seedance `
  --rights-confirmed
```

The planner is local and free. It creates no 3D asset, video task or claim of completion.

## Fidelity Contracts

Default every supplied source video to `source-locked`.

- `frame-exact`: require segmentation/tracking, pose or depth solving, camera solving, controlled rigging/rendering and compositing. If any required capability is absent, return `frame_exact_blocked` before pricing.
- `source-locked`: default for source video. Prefer the deterministic asset-first lane. Seedance balanced may produce a candidate, but it remains `generated_unreviewed` until every source-lock check passes.
- `appearance-first`: allow new motion from an approved target-world image. Kling is eligible only after explicit acknowledgement that the source video is not synchronized.

Use Seedance 2.0 `balanced` only as a generative candidate. Never use Seedance `replace` for whole-world reconstruction. Never use Kling for a source-locked request.

Never silently downgrade one contract to another.

## Asset-First Lane

Use this lane for a rigged asset, Blender scene, or strict source reconstruction:

1. Split the source into shots and persistent asset identities. Extract clean character/object evidence, foreground masks, turnarounds when available, environment plates and camera anchors.
2. Select a geometry adapter by evidence and topology. AniGen is the primary research candidate for animate-ready single-image assets; DrawingSpinUp is narrow to isolated character drawings; Wonder3D/Zero123 provide view completion or static meshes; img2threejs is code-first procedural reconstruction.
3. Reject unseen-side hallucinations, topology breaks, detached parts and identity drift before rigging.
4. Require an explicit artifact contract: stable asset ID, units, axes, mesh format, materials, skeleton, skin weights, sockets, source hashes and adapter version. See [references/pipeline-architecture.md](references/pipeline-architecture.md).
5. Build or validate the rig. AniGen may supply a rig candidate; Mesh2Motion may animate compatible imported meshes; DrawingSpinUp relies on external rig/retarget steps. None removes the need for deformation and contact tests.
6. Solve source motion, contacts and camera against the locked timeline. A text summary or generic reference video is not a motion solve.
7. Render a deterministic Blender clay preview. Do not spend on a final video model until the preview passes timing, blocking, contact, prop-state and camera QC.

## Scene Lane

- Use Blender geometry, projection, cards, tracked cameras or manual reconstruction for dynamic scenes.
- Use Gaussian Splatting only for a substantially static environment with genuine multi-view evidence. The reference implementation is non-commercial and does not solve deforming animated characters.
- Do not infer a complete 3D scene from a single stylized frame and label it reconstructed truth. Record inferred geometry as unverified.

## Generative Render Lane

AI video models are optional render/refinement stages, never the source of deterministic motion. Veo-class rendering remains an external appearance-first option until a concrete executable adapter, request contract and approval boundary are added; this skill does not currently submit Veo tasks.

### Seedance Source-Locked Candidate

Use the bundled `scripts/reference-motion-transfer/hiapi-reference-motion-transfer.mjs` runtime in `balanced` mode with exactly one source video and one approved complete target-world image. Pass the image with `--reference-image-file`, never `--replacement-image-file`. The runtime is included in this repository so an independent installation does not depend on the archived `hiapi-reference-motion-transfer-skill` checkout; see [references/reference-motion-runtime.md](references/reference-motion-runtime.md).

```powershell
node scripts\reference-motion-transfer\hiapi-reference-motion-transfer.mjs `
  --mode balanced `
  --reference-video-file "D:\media\authorized-shot.mp4" `
  --reference-image-file "D:\media\approved-target-world.png" `
  --prompt "Video 1 controls the locked event order, timing, camera, framing, blocking, contacts, screen direction and prop state. Image 1 controls target subjects, environment, materials and light. Add, remove, reorder or retime no event. Return a candidate for source-lock QC, not a frame-exact claim." `
  --seconds 8 `
  --ratio 16:9 `
  --resolution 720p `
  --no-audio `
  --dry-run
```

The dry-run is offline and has no live quote. Retrieve current pricing separately and obtain approval for the exact unchanged request.

### Kling Appearance-First Exception

Use the bundled Kling CLI only after the user explicitly abandons source synchronization. Read [references/prompting.md](references/prompting.md) and [references/api.md](references/api.md), then require `--appearance-first-acknowledged`.

```powershell
node scripts/hiapi-2d-to-3d-video.mjs `
  --storyboard-video-file "D:\media\authorized-shot.mp4" `
  --real-world-start-image-file "D:\media\approved-target-world.png" `
  --action-description "A short chronological action description." `
  --camera-description "One physical camera instruction." `
  --subject-map "animated subject => physical counterpart" `
  --real-world-scene "Concrete materials, scale, light and contacts." `
  --style photoreal --surface natural --lighting cinematic `
  --depth-strength strong --motion-fidelity physical --realism 95 `
  --asset-rights-confirmed --real-world-start-image-approved `
  --appearance-first-acknowledged --preview
```

## Spend And Result States

- Preflight every paid request, bind exact media hashes and parameters, retrieve live pricing, and obtain explicit user approval.
- Submit once. Recover by task ID or idempotency journal; never create an automatic replacement task.
- `pipeline_planned`: only a local plan exists.
- `external_setup_required`: a selected asset, rig, tracking or Blender adapter is unavailable or unverified.
- `frame_exact_blocked`: deterministic controls are incomplete; no paid task exists.
- `asset_candidate_unreviewed`: geometry or rig exists but artifact QC is incomplete.
- `generated_unreviewed`: a video model completed but source comparison is incomplete.
- `source_lock_rejected`: at least one locked fact differs.
- `source_lock_passed`: every locked fact passed normal-speed and frame-step review.

Never report “3D asset generated,” “rigged,” “fully synchronized,” or “frame-perfect” from a plan, API success, contact sheet or convincing sample alone. Read [references/output.md](references/output.md) before acceptance and [references/troubleshooting.md](references/troubleshooting.md) before any paid retry.
