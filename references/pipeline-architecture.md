# Animation Forge Pipeline Contract

## Contents

1. Lane selection
2. Stage and artifact gates
3. Deterministic source reconstruction
4. Generative finishing
5. Status rules

## Lane Selection

| User goal | Primary lane | Optional finishing | Hard boundary |
| --- | --- | --- | --- |
| Rigged reusable 3D asset | Asset-first | None required | A video render is not an asset |
| Blender-ready scene | Asset-first character + scene branches | None required | Static scene reconstruction does not solve characters |
| Frame-exact video | Deterministic asset, tracking, render and composite | Generative finish only if it preserves the approved render | Block when any deterministic control is missing |
| Source-locked cinematic video | Deterministic lane preferred; Seedance balanced candidate allowed | Seedance after exact preflight | Candidate must pass source-lock QC |
| Appearance-first cinematic video | Approved world image + Kling or Seedance | Generative by design | New motion is not source synchronization |
| Fast 2.5D style conversion | Depth/edge-conditioned video diffusion | Optional upscale | Not a rigged or inspectable 3D scene |

## Stage And Artifact Gates

Every stage consumes versioned artifacts and produces reviewable evidence. Do not skip a failed gate.

| Stage | Required input | Required output | Gate |
| --- | --- | --- | --- |
| Intake | Authorized source | SHA-256, media facts, shot list, rights record | Clean readable source |
| Analyzer | Shot frames and timeline | Asset IDs, visibility table, character/environment/material/camera bibles | Stable identity and screen geography |
| Evidence | Asset observations | Masks, clean plates, selected views, uncertainty map | No UI; enough evidence for chosen adapter |
| Geometry | Evidence package | GLB/glTF/mesh candidate, units, axes, source and adapter hashes | Silhouette, unseen-side and topology review |
| Rig | Geometry candidate | Skeleton, skin weights, sockets, rest pose | Deformation, joint and detached-part review |
| Motion | Rig + source video | Retargeted animation, contacts, prop ownership and timing report | Source-lock event comparison |
| Scene/camera | Plates, environment evidence, camera anchors | Blender scene, scale, camera solve, lights | Framing, parallax, occlusion and scale review |
| Deterministic preview | Approved assets, motion and scene | Frame-addressable clay/beauty render | Duration, events, contacts, camera and final state pass |
| Generative finish | Approved preview or references | Candidate video + exact request manifest | No invented/reordered events or asset drift |
| Delivery | Approved render | Final media, manifest and QC report | Correct status; no unsupported claim |

## Asset Manifest

Record at minimum:

```json
{
  "assetId": "stable-project-id",
  "sourceSha256": ["..."],
  "adapter": { "name": "anigen", "version": "pinned commit/checkpoint" },
  "geometry": { "format": "glb", "units": "meters", "upAxis": "Z" },
  "rig": { "present": true, "skeletonVersion": "...", "skinWeightsReviewed": false },
  "materials": { "reviewed": false },
  "uncertainties": ["unseen back surface inferred"],
  "licenseReview": { "status": "required" }
}
```

Do not treat an inferred back, automatic rig or generated texture as approved until the relevant gate passes.

## Deterministic Source Reconstruction

For `frame-exact`, require all of these executable capabilities:

- temporally stable subject/background segmentation and tracked identities;
- pose, depth or geometry guidance tied to source frames;
- prop ownership, contact and occlusion handling;
- source camera solve or explicit frame-addressable camera animation;
- stable rigged assets and deterministic rendering;
- controlled compositing with no untracked generative replacement;
- frame-step QC against the locked source timeline.

AniGen, Wonder3D, Blender or Mesh2Motion can cover individual stages. None alone covers this contract. The bundled planner and HiAPI CLIs do not implement the whole deterministic lane.

## Generative Finishing

Use Seedance/Kling/Veo-class models only after distinguishing their input contract:

- A model receiving the source video can use it as generative temporal conditioning, not a deterministic pose/camera channel.
- A model receiving only images and text generates new motion.
- A model success response proves completion, not fidelity.
- A polished output cannot repair a failed deterministic preview without a new plan, preflight and approval.

## Status Rules

Move status forward only with evidence:

```text
pipeline_planned
  -> external_setup_required OR asset_candidate_unreviewed
  -> deterministic_preview_unreviewed
  -> generated_unreviewed (optional)
  -> source_lock_passed OR source_lock_rejected
```

`frame_exact_blocked` is terminal for a request until all deterministic capabilities are actually configured and tested.
