# Kling Appearance-First API And Spend Boundary

This contract applies only to the bundled Kling CLI. Seedance balanced uses the vendored reference-motion runtime contract described in [temporal-fidelity.md](temporal-fidelity.md) and [reference-motion-runtime.md](reference-motion-runtime.md).

## Fixed Endpoints

Use only `https://api.hiapi.ai`:

- `GET /api/pricing` for uncached public live pricing.
- `GET /v1/tasks?page=1&size=1` for an authenticated zero-cost check.
- `POST /v1/tasks` to create one paid task.
- `GET /v1/tasks/{taskId}` to poll or resume.

Send the API key only as `Authorization: Bearer ...`. Do not support a caller-controlled base URL.

## Kling Request

Use exactly this request shape:

```json
{
  "model": "kling-3.0-omni/image-to-video",
  "storage": "temp",
  "input": {
    "image_urls": ["data:image/png;base64,..."],
    "prompt": "...",
    "resolution": "720p",
    "duration": 5,
    "sound": false
  }
}
```

Contract rules:

- Fix `model` to `kling-3.0-omni/image-to-video`.
- Put the separately reviewed local photoreal start image in `input.image_urls[0]` as a data URI. Never put an animation storyboard or an extracted storyboard frame in this array.
- When the local storyboard is a video, require `--appearance-first-acknowledged`. This confirms the user accepts that Kling receives no source video and generates new motion; it is not permission to describe the result as synchronized.
- If `--end-image-file` is present, require the same aspect ratio as the photoreal start image and put it in `input.image_urls[1]` as an optional photoreal final-composition anchor.
- Accept only structurally valid local JPG, PNG, or WebP images, at most 20 MiB each, with both width and height at least 300 px.
- Set `prompt` to the compiled action, camera, real-world subject mapping, physical world direction, and sound direction; reject it locally if it exceeds 2500 Unicode characters.
- Set `resolution` to `720p`, `1080p`, or `4K`.
- Set integer `duration` from 3 through 15 seconds.
- Set `sound` to a JSON boolean.
- Do not send `aspect_ratio`; Kling derives framing from the start image.
- Do not send the source video, source audio, video URL, web-search field, or a separate generated-audio field.

For storyboard video input, inspect the shot locally, record its SHA-256 and duration, and extract one frame with `ffmpeg` for local audit. The storyboard frame never enters `image_urls`. A separate photoreal start image, prepared and reviewed upstream, is the only initial visual model input. The required `--action-description` and optional `--camera-description` carry the intended temporal behavior.

Use temporary storage and download successful output promptly. Persistent storage requires separate cost review and is outside this skill.

## Offline Preview

`--preview` may read local files and invoke local `ffmpeg`, but it must not access HiAPI or create a task. Print only redacted media placeholders plus non-sensitive facts such as byte counts, dimensions, duration, extraction time, and SHA-256 values.

Reject a request before networking when:

- neither or both storyboard modes are supplied;
- the separately reviewed real-world start image is absent, invalid, byte-identical to the storyboard frame, or lacks `--real-world-start-image-approved`;
- no real-world scene or real-world subject map is supplied;
- `--action-description` is empty;
- a local image is malformed or too large;
- a start or end image has either side below 300 px;
- a video cannot be inspected or its extraction time is out of range;
- the compiled Kling prompt exceeds 2500 characters;
- duration or resolution is unsupported;
- sound direction is supplied while sound is disabled;
- authorization is not confirmed;
- a storyboard video is supplied without explicit appearance-first acknowledgement;
- the serialized task body exceeds the local size guard.

## Pricing And Approval

1. `--dry-run` reads live public pricing, creates no task, and returns a 12-hour `2d3d` approval token.
2. The token binds a workflow hash covering the exact payload plus source kind/hash/duration, extraction time, ordered input-image hashes, and appearance-first acknowledgement. It also binds the public-price ceiling, issue time, stage, non-secret HiAPI credential fingerprint, and checksum.
3. `--spend` requires the matching token and explicit user approval in conversation.
4. Rebuild the request from local media before spend and use the same HiAPI credential as the dry-run. Any changed account key, storyboard byte, reviewed photoreal start-image byte, prompt, action, camera direction, mapping, style control, duration, resolution, or sound setting invalidates approval.
5. Reject a live estimate above the approved ceiling before POST; allow a lower estimate.

The checksum catches copying and drift errors. It is not a server signature or proof that a human approved. Never self-mint or use a token as a substitute for explicit user authorization.

Read `base_usd_value` and the most specific matching live policy. Apply only supported factors, normally duration, and fail closed on malformed or unknown pricing. `--max-cost-usd` and the token ceiling are client-side estimate guards, not server-enforced final-charge caps. Account ratios or server-side price changes may affect the final charge. Require explicit premium-resolution approval for `4K`.

When `sound` is true, require a matching live pricing policy whose rule explicitly includes `sound`. Do not price an audio-enabled request from a generic or silent resolution tier. If no sound-specific policy exists for the chosen resolution, fail before approval or submission.

The 3D controls are prompt guidance. They change the request hash but are not deterministic engine parameters.

## Idempotency And Recovery

- Derive one deterministic `Idempotency-Key` from the complete approval token.
- Serialize the request body once per submission run. Every retry must use the exact same body bytes and key.
- Before POST, write `.hiapi-submissions/<idempotency-key>.json` with request/media hashes, quote metadata, state, and timestamps. Write and sync a same-directory temporary file, then atomically replace the journal so an interrupted update cannot truncate the last valid record. Never write the API key, full token, media bytes, data URIs, or signed output URLs.
- Retry ambiguous transport failures, HTTP 409, 429, and 5xx only with the frozen body and key. Keep retries bounded and finish well before the backend's 15-minute stale-takeover boundary.
- A normal HTTP 409 means `IDEMPOTENCY_KEY_PROCESSING` and has no task ID. Honor `Retry-After` and repeat the same POST.
- A replay returns HTTP 200 with the original task ID and `Idempotent-Replay: true`.
- Do not retry 400, 401, 402, or 403.
- Print and journal the task ID immediately after creation or replay.
- If same-key recovery ends without a task ID, keep the journal and reconcile that submission. Do not create a new approval token or idempotency key automatically.
- After a task ID exists, use `--task-id`; never resubmit from an old brief.

Treat provider failure, output download failure, timeout, and visual rejection as non-authorizing events. None of them permits an automatic replacement task or model change.

Download a successful task's video with a five-minute timeout across both response acquisition and body reading. Read the response incrementally and stop before buffering more than 200 MiB. A timeout, declared oversize response, or streaming size-limit failure must leave the task recoverable by `--task-id`; it must not trigger another submission.

## Task Detail Limits

HiAPI task detail returns task ID, model, status, storage, and output/error metadata, but may omit the original `input`. Record this as `inputEcho: not-returned`; do not claim server-side media verification. The client audit trail consists of the exact request hash, local source/start-image hashes, idempotency journal, replay evidence, task ID, and downloaded output SHA-256.
