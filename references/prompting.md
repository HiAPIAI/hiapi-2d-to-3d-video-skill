# Kling Appearance-First Prompting

Use this file only for the Kling path. For source-video synchronization and Seedance role separation, read [temporal-fidelity.md](temporal-fidelity.md).

Kling is never source-locked: it does not receive the storyboard video. When the storyboard is a video, require the user to explicitly accept newly generated motion and pass `--appearance-first-acknowledged`. Do not describe the result as synchronized even when its broad event order looks similar.

## Input Roles

| Input | Role | Never use it for |
| --- | --- | --- |
| Storyboard | Count, role, pose, screen direction, broad composition, props, story beat | Kling style conditioning or a direct video input |
| Approved photoreal start image | Kling's opening real-world visual state | A second chance to retain cartoon identity |
| Subject map | Animation role to real living or physical counterpart | A vague request for a "3D cartoon" |
| Real-world scene | Location, materials, scale, light, gravity, contacts | A named animation style or a generic "make it real" |
| Action and camera | New generated motion and framing | Exact source timing, camera path, or motion transfer |

## Required Vocabulary

Write one `--subject-map` per major subject. The target side must contain `real`, `living`, or `physical` and must not contain animation terms.

```text
animated orange cat => real living orange domestic shorthair cat with short fur, whiskers, realistic feline paws, and the same foreground role
animated glass tower => real physical glass-and-steel office tower with weathered concrete base and the same distant background role
```

Use a location-specific world direction:

```text
A real suburban garden after rain: damp soil, grass blades, weathered wood, diffuse cloud light, correct cat scale, natural fur response, paw imprints, occlusion, and grounded contact shadows.
```

Do not write `photoreal 3D cartoon`, `Pixar-like`, `anime realism`, `rendered`, `toy`, `clay`, `plush`, or `stylized` anywhere in the real-world scene or map target.

## Motion And Camera

Use observable, chronological motion that fits 3-15 seconds:

```text
The cat steps around the drain, puts its front paws on the dry curb, pauses, then turns its head toward the open gate.
```

Use one physical camera instruction:

```text
Low cat-height medium-wide side view; one continuous take; keep paws, curb, and gate visible; no cut or zoom.
```

Reduce action density before increasing duration. Name the contact that must remain physical.

## Kling Consistency Module

Kling animates the approved photoreal still; it does not redesign it. Keep the prompt literal and lock:

- subject appearance, species, markings, anatomy, fur/skin micro-detail, clothing, and prop design;
- environment geometry, weathering, material roughness, atmosphere, light direction, exposure, and grade;
- natural breathing, restrained facial or eye movement, weight, inertia, collision, and grounded contacts;
- the approved lens perspective and framing, with one subtle professional move only when the action benefits from it.

Allow a slow dolly or restrained handheld documentary feel only when it does not conflict with the storyboard camera. Avoid artificial motion, animation timing, design changes, melting details, texture boiling, extra beats, invented cuts, and gratuitous camera movement.

## Preflight Test

The compiled Kling prompt must say all of the following:

- The start image is approved photoreal and the only image sent to Kling.
- The storyboard stays upstream and is not sent to Kling.
- The final medium is live-action real world from frame one.
- Line art, flat fills, cel shading, cartoon anatomy, toy materials, and visible transformation are prohibited.
- Every major subject has a named real-world counterpart and the scene has physical materials, light, scale, and contacts.
- Character appearance, biological detail, environment, material response, lighting, exposure, and color remain consistent with the approved still.

If the approved start image itself still reads as animation, do not refine the video prompt. Return to [real-world-preparation.md](real-world-preparation.md), repair the still, and get a new video quote only after it passes review.
