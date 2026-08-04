# Temporal Fidelity And Engine Routing

## Contracts, Not Marketing Labels

Distinguish three contracts:

| Contract | Meaning | Eligible path |
| --- | --- | --- |
| `source-locked` | The output is accepted only if the recorded source timeline, camera, blocking, subjects, contacts, and prop states all pass comparison | Asset-first deterministic lane preferred; Seedance balanced may create a candidate; [source-lock.md](source-lock.md) decides pass/reject |
| `appearance-first` | The approved photoreal opening appearance matters more than source timing | Kling image-to-video after explicit acknowledgement |
| `frame-exact` | Per-frame poses, trajectories, occlusion, contacts, camera transforms, and edit points must be deterministic | Require the complete Animation Forge asset, tracking, Blender render and compositing capability set; otherwise block |

Default every supplied video to `source-locked`. Do not ask the user to repeat this preference and do not silently downgrade it.

## Why Generative Models Cannot Guarantee Exactness

| Path | Model inputs | Useful guidance | Missing hard controls |
| --- | --- | --- | --- |
| Kling appearance-first | Approved photoreal keyframe + text | Opening appearance and broad requested action | Source video, per-frame pose/timing, masks, depth, tracked contacts |
| Seedance balanced | Source video + approved photoreal keyframe + text roles | Overall action, pose transitions, camera, pacing, and target-world appearance | Source/target identity binding, masks, segmentation IDs, pose/depth tracks, deterministic frame mapping |
| Deterministic video-to-video | Source frames + masks/tracks + pose/depth + controlled render/composite | Potential frame-by-frame correspondence | Not implemented by the current HiAPI skills |
| Animation Forge asset-first | Source evidence + persistent meshes/rigs + solved motion/camera + Blender scene | Inspectable geometry, stable identities and frame-addressable render | External adapters are not bundled; each stage must be configured and validated |

Kling cannot synchronize to a video it never receives. Text discards exact onset times, velocities, limb paths, occlusion, contacts, camera transforms, and edit points.

Seedance receives the source video, but its generic reference arrays are generative conditioning. The API has no structured field binding a source pixel region, skeleton, depth surface, camera transform, or prop state to a target entity. Repeating a seed does not make the result deterministic.

Changing illustrated anatomy into living anatomy also makes literal pose copying ill-defined. Preserve the story event, direction, timing, and contacts while adapting gait and balance physically, then reject any candidate that changes a locked fact.

## Routing

Use Seedance 2.0 balanced only as a generative candidate when:

- the source is one clean authorized 2-15 second shot;
- the complete source-lock timeline has been recorded;
- a separately approved full-scene photoreal keyframe defines the target world;
- the user understands the candidate may fail QC and that a failure does not authorize an automatic retry.

Use Kling only when the user explicitly chooses `appearance-first`, accepts newly generated motion, and passes `--appearance-first-acknowledged`. Never use Kling to satisfy source lock.

Never use Seedance replace for complete world reconstruction. Replace preserves Video 1's background, object layout, materials, lighting, and visual style.

Run `scripts/plan-animation-forge.mjs` first. Return `frame_exact_blocked` before pricing whenever the plan reports a missing deterministic stage.

## Seedance Input Contract

Use exactly one source video and one approved full-scene photoreal image:

```text
Video 1: exclusively controls shot boundaries, event order and timing, camera, framing, blocking, contacts, screen direction, and prop state.
Image 1: exclusively controls target subjects, environment, physical materials, lighting, lens, exposure, and color.
Output: begin in Image 1's live-action medium at frame one; add, remove, reorder, or retime no source event.
Acceptance: generated_unreviewed until every source-lock check passes.
```

Pass Image 1 with `--reference-image-file`. Never use `--replacement-image-file` for the full world.

## Free Preflight Gate

Require the dry-run to show:

- `transferMode` is `balanced`;
- model is `seedance-2.0`;
- exactly one redacted source video and one redacted world image with hashes;
- duration, resolution, ratio, audio, and storage match the reviewed request;
- prompt roles match the Seedance input contract;
- no task ID and no credits spent.

The dry-run does not call HiAPI pricing. Its token binds payload equality but is not a quote or user consent. Any change requires a new preflight and approval.

## Deterministic Escalation

A qualifying frame-exact pipeline needs subject/background segmentation, temporal masks, tracked subject IDs, pose or optical-flow guidance, depth or geometry control, stable rigged assets, camera tracking, occlusion/contact handling, frame-addressable Blender rendering and controlled compositing. AniGen, Wonder3D, Mesh2Motion or Blender cover only parts of this list. Do not claim implementation until the complete executable chain passes a real end-to-end test.
