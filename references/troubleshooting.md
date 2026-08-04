# Troubleshooting

## Wrong Engine Or Mode

- Any supplied source video defaults to the `source-locked` acceptance contract in [source-lock.md](source-lock.md).
- Need source action, camera, or timing correspondence: use Seedance `balanced` with one source video plus the approved photoreal full-scene image, then reject the candidate unless every source-lock check passes.
- Cartoon background remains in Seedance: verify the request is not `replace`; pass the photoreal image as `--reference-image-file` and explicitly assign the complete target world to Image 1.
- Kling motion drifts from the source: expected contract limitation; Kling never receives the source video. Switch to Seedance balanced or reduce the fidelity claim.
- User requires frame-exact conversion: run `scripts/plan-animation-forge.mjs` and return `frame_exact_blocked` before pricing when any segmentation/tracking, pose/depth, camera, rig, Blender render or compositing stage is missing. The bundled HiAPI video paths do not supply those deterministic controls, and the referenced external adapters are not bundled.
- Kling video input lacks `--appearance-first-acknowledged`: do not add it on the user's behalf. Explain that Kling generates new motion and request explicit acceptance of the appearance-first downgrade.

## Preflight

- `Provide exactly one --storyboard-video-file or --storyboard-image-file`: supply one local animation storyboard, not both.
- `--real-world-start-image-file is required`: create a separate photoreal still first; do not point this option at the storyboard.
- `must be a separately reconstructed photoreal image`: the image hashes match. Generate or select a different real-world still.
- `--real-world-start-image-approved`: inspect the still against [real-world-preparation.md](real-world-preparation.md) before enabling this gate.
- `--real-world-scene is required`: name the physical location, materials, lighting, scale, and contact behavior.
- `At least one --subject-map is required`: map every major animated subject to a real/living/physical counterpart.
- Target map or scene contains an animation term: rewrite it as a physical counterpart. `real living tabby cat` is valid; `realistic cartoon cat` is not.
- Real-world controls error: use `photoreal`, `natural` surface, `strong` depth, `physical` motion, realism 90-100, and natural/cinematic/dramatic lighting.
- `ffmpeg` unavailable: install it, pass `--ffmpeg-path`, or export one clean storyboard image.
- Image invalid, too large, or below 300 px: export a valid JPG, PNG, or WebP and preserve the approved composition.
- Ending-image ratio mismatch: compare it to the real-world start image, not the storyboard.
- Prompt exceeds 2500 characters: shorten action, camera, map, scene, or extra constraint. Do not remove the real-world identity and anti-animation clauses.

## Visual Failure

If any frame looks animated, the first suspicion is the photoreal start image, not the Kling negative wording.

1. Stop. Do not submit another paid video automatically.
2. Inspect the approved start image at 100%. If it has line art, flat fills, cartoon anatomy, or toy materials, regenerate the start image from the storyboard with a stricter physical subject map.
3. If the start image is genuinely live action but the clip drifts, reduce action density or duration and repeat the exact real-world identity, material, and contact facts in the prompt.
4. Run a new preview and dry-run after changing any image, scene, mapping, action, camera, control, duration, resolution, or sound setting. Get explicit approval again before spending.

Do not use a raw cartoon input in Kling or treat a rejected task as permission for a free retry. Change to Seedance balanced only when the user's priority is source-video temporal guidance and run a new preflight and approval flow.

## Source-Lock Failure

- Record each mismatch against the timestamped source event and return `source_lock_rejected`.
- Do not average away a missing prop, changed entrance side, invented action, altered cut, or timing drift as "close enough."
- Do not switch to Kling to repair source timing; Kling has no source-video input.
- A retry requires a changed preflight, live quote, and explicit approval. Never retry automatically.

## API, Pricing, And Recovery

- HTTP 401/403: verify the local environment has the HiAPI key; never paste it into chat.
- HTTP 402: check balance and live pricing before requesting a new approval.
- Approval mismatch or expiry: reconcile the existing journal first, then run a new dry-run for the changed workflow.
- Price above approved quote: stop and request a new quote; never raise the local maximum to bypass approval.
- HTTP 409, 429, 5xx, polling timeout, or output-download failure: recover the same task with its task ID or exact approval token. Do not create a replacement task.
- API completion is not visual success. Record the rejected time range and primary defect in `qc.json`.
