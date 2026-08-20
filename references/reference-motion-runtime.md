# Bundled Reference-Motion Runtime

The `scripts/reference-motion-transfer/` directory is a compatibility copy of the runtime from the archived [`hiapi-reference-motion-transfer-skill`](https://github.com/HiAPIAI/hiapi-reference-motion-transfer-skill) repository.

- Source commit: `5494ed9dd6a0dcd4d527adcaf959d49ae45b8232`
- Copied entry point: `scripts/hiapi-reference-motion-transfer.mjs`
- Copied support modules: `scripts/lib/media-files.mjs`, `motion-transfer.mjs`, and `seedance-2-video.mjs`

The copy is intentionally kept inside this skill so an independent installation never depends on a sibling checkout or an archived repository. It must remain contract-compatible with the Seedance 2.0 public task schema. Update it only with a reviewed source commit and run `npm test` plus `npm run check` afterward.
