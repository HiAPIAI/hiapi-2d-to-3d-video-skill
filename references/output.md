# Kling Appearance-First Output Package And QC

This package format applies to the bundled Kling CLI. Seedance balanced output and review use the vendored reference-motion runtime documented in [reference-motion-runtime.md](reference-motion-runtime.md).

For any workflow that began from a source video, apply [source-lock.md](source-lock.md) before final acceptance. Kling output cannot receive `source_lock_passed` because Kling never receives the source video; its strongest valid status is an appearance-first result reviewed against the written brief.

## Files

One successful task produces one timestamped package:

| File | Meaning |
| --- | --- |
| `final.mp4` | Downloaded Kling output |
| `brief.md` | Storyboard facts, approved real-world start image, written action/camera, controls, and final prompt |
| `prompt.json` | Redacted request payload; `image_urls` values are omitted |
| `manifest.json` | Task, model, workflow request hash, input/output SHA-256 facts, quote, idempotency/replay evidence, task-detail limits, storage, and review status |
| `qc.json` | Requested controls and human review checklist initialized as not reviewed |

Before POST, the CLI also writes `.hiapi-submissions/<idempotency-key>.json` under the output root. This recovery journal is not a result package. Each update is synced to a same-directory temporary file and atomically replaces the previous JSON, preserving the last valid journal if replacement fails. It records only non-sensitive request, quote, media-hash, state, replay, and task-ID evidence. It must never contain the API key, full approval token, local path, media bytes, data URI, or signed output URL.

`final.mp4` is downloaded incrementally with a five-minute timeout and a 200 MiB hard limit before its MP4 structure and SHA-256 are recorded.

The manifest distinguishes:

- the local storyboard's byte count, duration, and SHA-256;
- the local storyboard-frame extraction timestamp and SHA-256 when input was a video;
- the separately approved photoreal start image's byte count, dimensions, and SHA-256;
- the fact that only the photoreal start image, never the storyboard, was submitted to Kling.

For image input, the manifest records the local start image facts. If an optional end image is used, record it as the second Kling input image, not as a separately approved character reference.

## Review Status

API completion produces `generated_unreviewed`. Do not say the conversion passed until a human watches the entire clip at normal speed and frame-steps suspicious sections.

Use `source_lock_rejected` for any Seedance candidate that changes a locked source fact. Use `source_lock_passed` only after every source-lock check passes. API success and broad event similarity are insufficient.

The comparison source is the written brief plus the approved photoreal start image. The local storyboard is useful narrative context, but exact video-to-video correspondence is not a pass criterion because Kling never received it.

## Review Order

1. Verify the clip opens with the intended real-world subjects, composition, relative scale, and physical scene geography from the approved start image.
2. Check that the written action events occur in the requested order and fit naturally within the requested duration.
3. Check initial pose, anticipation, contacts, reactions, object interaction, recovery, and ending pose.
4. Compare framing and camera behavior with `--camera-description`; reject invented cuts, angle jumps, or zooms that contradict it.
5. Count major subjects and verify the mapped real-world type/species or object, markings, scale, role, natural anatomy, and physical material response.
6. Compare surface finish and material response with the requested `surface`.
7. Compare light direction, exposure, contrast, shadow behavior, and visibility with the requested `lighting`.
8. Compare modeled volume, parallax, occlusion, contact shadows, and spatial separation with the requested `depthStrength`. Blur alone is not 3D depth.
9. Compare the written action's timing priority and physical adaptation with `motionFidelity`.
10. Compare anatomy, material, lens, lighting, weight, and contact plausibility with the requested `realism`.
11. Reject any animation return: visible line art, flat fills, cel shading, cartoon proportions, toy/plastic materials, paper texture, source-frame borders, player UI, cursor, captions, watermark, split screen, or unintended text.
12. Inspect anatomy, faces, hands, feet, limb count, ground contact, collisions, flicker, texture boiling, subject merging, prop loss, and late-frame drift.
13. If an end image was supplied, verify that the final composition is approached coherently without a visible flat-image snap or style change.
14. When `sound` is true, verify synchronization and confirm the output does not reproduce unapproved source music, dialogue, or voices.

Record the affected time range and one primary defect. A failed review does not authorize another paid task.

## Handoff

This skill outputs individual shots only. Trim, order, transition, mix, caption, and stitch approved clips manually in a separate editing workflow. Do not add automatic stitching or claim continuity across independently generated tasks.
