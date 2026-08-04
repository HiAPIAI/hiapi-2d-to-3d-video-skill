# Source-Locked Acceptance Contract

Use this contract for every source-video reconstruction. It controls acceptance, not model capability.

## Intake Gate

- Confirm authorization for the source and target references.
- Use one continuous 2-15 second shot with readable subjects, props, contacts, and camera motion.
- Reject or request a clean export when the input contains player UI, cursor overlays, unrelated cuts, missing frames, or ambiguous action.
- Record source SHA-256, duration, dimensions, frame rate, audio state, and useful interval before any generation.
- Normalize only when required for API compatibility. Preserve all pixels with padding, preserve timestamps and frame order, and do not crop or retime.

## Locked Timeline

Write a timestamped table before creating a video task:

| Time | Subjects and screen position | Action/pose transition | Prop ownership/state | Contact/occlusion | Camera/framing |
| --- | --- | --- | --- | --- | --- |
| 00:00.000 | exact visible count and placement | opening pose | every visible prop | ground/object contacts | shot and lens behavior |
| each event boundary | updated state | one observable event | possession/appearance changes | contact start/end | any camera change |
| final frame | final count and placement | ending pose | final prop state | final contacts | final framing |

Do not replace this table with a prose summary. Extract enough anchor frames to verify every event boundary, contact change, prop transition, camera change, and final state.

## Engine Eligibility

- Animation Forge deterministic asset lane: eligible for frame-exact work only after executable segmentation/tracking, pose/depth, camera, rig, Blender render and compositing stages all pass their artifact gates. A pipeline plan alone is not eligibility.
- Seedance balanced: eligible only to create a generative candidate. It does not earn a pass without QC.
- Seedance replace: ineligible for complete world reconstruction because it preserves the source background/style.
- Kling image-to-video: ineligible for source lock because it never receives the source video.
- Deterministic asset/render pipeline: eligible for frame-exact claims only when it exposes masks/segmentation, tracked identities, pose or optical-flow guidance, depth/geometry, camera tracking, stable rigged assets, occlusion/contact handling, frame-addressable rendering and controlled compositing.

Do not silently fall back to a less faithful engine. Obtain explicit user approval before changing the fidelity contract.

## Acceptance Checks

All checks are required:

1. Duration and source interval match; no unapproved trim, freeze, loop, or retime.
2. Shot count, cut order, and cut timestamps match.
3. No missing, invented, reordered, or duplicated event exists.
4. Each locked event begins and ends at the recorded source timestamp within the review tolerance agreed before generation.
5. Camera type, direction, framing changes, and screen direction match.
6. Subject count, role, relative scale, entrance/exit side, and blocking match throughout.
7. Prop identity, ownership, visibility, state, and contact timeline match throughout.
8. Ground, body, object, and occlusion contacts remain physically plausible without changing the story beat.
9. The output stays live-action and photoreal with no animation return, UI, cursor, text, watermark, duplicate anatomy, or material drift.
10. The final subject/prop state and composition match the source ending.

Use normal-speed playback for rhythm and frame-step comparison around every anchor. Record each mismatch with an exact output time range and corresponding source event.

## Status Rules

- Before full review: `generated_unreviewed`.
- Any failed locked check: `source_lock_rejected`.
- Every locked check passed: `source_lock_passed`.
- User requires deterministic frame mapping but no qualifying backend is available: `frame_exact_blocked`; do not price or submit.

API success, a repeated seed, a convincing contact sheet, or broad event similarity never upgrades the status by itself.
