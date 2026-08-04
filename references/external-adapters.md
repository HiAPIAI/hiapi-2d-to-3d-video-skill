# External Adapter Registry

Verified against upstream public material on 2026-08-02. These projects are references or optional external adapters; none is bundled or installed by this skill.

## Adapter Table

| Adapter | Eligible role | Real limitations | License / deployment gate |
| --- | --- | --- | --- |
| [AniGen](https://github.com/VAST-AI-Research/AniGen) | Single image to mesh + skeleton + skin weights; rig candidate; experimental monocular-video fitting | Linux only in upstream tests; NVIDIA GPU with at least 18 GB VRAM; large checkpoints and CUDA stack; output still needs topology/deformation QC | Source says MIT, but upstream identifies third-party restrictions including non-commercial/research instant-ngp-derived code. Audit the exact inference path and checkpoints before commercial use. |
| [DrawingSpinUp](https://github.com/LordLiang/DrawingSpinUp) | Isolated flat character drawing to stylized 3D proxy and animation | Requires a 512x512 drawing plus foreground mask; upstream workflow uses Mixamo or Rokoko for rig/retarget; designed around single character drawings, not scenes or arbitrary multi-character shots | No root `LICENSE` was present at the checked upstream path. Treat license as unverified and block redistribution/commercial integration until reviewed. |
| [img2threejs](https://github.com/img2threejs/img2threejs) | Agent-driven procedural Three.js reconstruction with editable hierarchy, pivots and animation hooks | Code reconstruction from visual evidence, not photogrammetry or a universal organic-character generator; fidelity depends on primitives and iterative visual QC | Apache-2.0 upstream. Pin a release/commit and preserve notices. |
| [Wonder3D](https://github.com/xxlong0/Wonder3D) | Single image to multiview normal/color evidence and static textured mesh | No rig; segmentation quality strongly affects mesh; orthographic reconstruction; upstream last-push and dependency health must be checked before adoption | MIT upstream. Check model/checkpoint and dependency licenses separately. |
| [Zero123](https://github.com/cvlab-columbia/zero123) | Novel-view synthesis fallback for missing views | Generates views, not a rig; older research stack; model card states research-intended use and known fidelity limitations | Code is MIT, but weights/data/model-card terms need separate review. Do not infer commercial clearance from code license. |
| [Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting) | Static environment reconstruction from genuine calibrated multi-view evidence | Not suitable for a lone stylized frame or deforming animated characters; requires camera/evidence preparation | Reference implementation license is non-commercial research/evaluation only without prior consent. Never default it into a commercial HiAPI path. |
| AnimateDiff + depth/edge controls | Fast 2.5D or style-conditioned video candidate | Not a mesh, rig, persistent 3D scene or deterministic source-motion solution; exact implementation and checkpoints vary | Select and review a concrete repository, model and checkpoint before use. No generic “AnimateDiff” license assumption. |
| Veo-class video renderer | External appearance-first or approved-preview finishing candidate | No Veo submitter is bundled here; model/version input contracts differ and must not be inferred from the brand name | Require a concrete provider, model ID, pricing, rights policy, preflight and approval implementation before declaring it available. |
| [Blender Grease Pencil](https://www.blender.org/features/story-artist/) | Deterministic 3D scene, rig, camera and NPR/2D-style rendering | Requires real asset construction and animation work; it does not automatically reconstruct source footage | Blender is GPL; project output licensing differs from distributing Blender/add-ons. Review every add-on separately. |
| [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app) | Apply/retarget animations to compatible imported 3D meshes and supported skeleton types | It starts from an existing 3D model; it is not image-to-3D and cannot recover source motion by itself | Upstream README claims permissive MIT code and CC0 art assets, while the checked repository metadata did not expose a standard root license file. Verify the pinned revision before redistribution. |

## Selection Rules

- Prefer AniGen only when its Linux/CUDA/VRAM and license gates pass and a reusable rigged asset is actually required.
- Prefer DrawingSpinUp only for an isolated, maskable flat character drawing whose topology fits its assumptions.
- Prefer img2threejs for editable procedural props, machines or stylized code-first previews, not a promise of organic production mesh quality.
- Use Wonder3D/Zero123 to add view evidence or create a static mesh candidate. Do not call either output rigged.
- Use Gaussian Splatting only for static environment evidence and only after its non-commercial license gate.
- Use Mesh2Motion after mesh generation, never as the image-to-3D stage.
- Keep all adapters behind pinned-version, artifact-hash, license, hardware and visual-QC gates.

## Integration Rule

Do not add an adapter to `--available-adapter` because a GitHub URL exists. Mark it available only after its executable, pinned revision/checkpoint, hardware, license and expected output contract have been verified in the current environment.
