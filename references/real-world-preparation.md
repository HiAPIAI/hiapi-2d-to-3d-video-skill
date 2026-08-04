# Cinematic Reality Reconstruction

Use this stage to translate an animation storyboard into one live-action cinematic still before using HiAPI. This is not a simple 3D conversion. Build a believable world that appears photographed on a physical set with living subjects, natural imperfections, and professional cinema optics. The still becomes Seedance's complete target-world reference or Kling's opening visual state.

## Visual Analysis And Bibles

Extract only facts that must survive the medium change:

- **Character Bible:** count, role, species or physical type, identity markings, pose, expression, gaze, relative scale, and important props.
- **Environment Bible:** location, architecture, layout, time or weather, practical light sources, atmosphere, scale cues, and subject contacts.
- **Material Bible:** fur or skin, fabric, wood, stone, metal, glass, moisture, roughness, wear, dirt, dust, scratches, and other visible micro-textures.
- **Camera Bible:** framing, camera height, lens perspective, depth of field, exposure, and color response.

Do not preserve impossible anatomy, outline language, flat color blocks, or illustrated material behavior. Preserve identity through physical equivalents.

## Build The Still

Use `imagegen` with the storyboard visible as a reference image. Choose `sketch-to-render` when converting the full frame or `identity-preserve` when a previously approved real-world subject must retain its visual identity.

State the source image role exactly: `Image 1 is a semantic storyboard for count, pose, composition, screen direction, props, palette relationships, and action context. It is not a style reference.`

Use this compact Image 2.0-compatible prompt structure with the available `imagegen` workflow. Do not invent a separate image API or model parameter:

```text
Use case: sketch-to-render
Asset type: photoreal start image for image-to-video
Input image: Image 1 is a semantic storyboard, not a style reference.
Primary request: Reimagine the depicted event as a Hollywood-quality live-action cinematic still, photographed rather than rendered.
Subjects: [repeat each approved subject map]
Scene/backdrop: [real-world scene description]
Composition: Preserve Image 1's subject count, screen direction, broad layout, pose, and important props.
Character realism: [biological anatomy, fur/skin/hair/eyes and natural imperfections from the Character module]
Materials/textures: [PBR-observable roughness, micro-texture, wear, dirt, dust, moisture and scratches]
Environment: [architecture, depth, atmosphere, physical scale, occlusion and grounded contacts]
Camera: ARRI Alexa 35 look; 35mm anamorphic cinema lens; f/2.0; natural depth of field; realistic exposure; restrained Kodak-style film color.
Lighting/mood: [motivated key source, global illumination, bounced light, realistic shadows, optional subtle volumetric light]
Style/medium: Real camera photography and high-end invisible creature VFX; every surface must still read as physically photographed.
Constraints: Start directly in the final live-action medium. Preserve identity cues, pose, facial expression, role, markings, relative scale, composition, and required props.
Avoid: 3D cartoon, Pixar animation, game model, glossy or plastic CGI, illustration, line art, cel shading, flat fills, toy materials, perfect synthetic surfaces, text, watermark, UI, split screen.
```

Do not request a visible conversion, morph, before/after split, or "3D cartoon." Name the physical counterpart: `real living domestic shorthair cat`, not `realistic cartoon cat`.

## Detail Modules

Select only details visible at the shot scale. Do not paste every module into every prompt.

### Character Realism

For animals, specify individual fur strands, varied strand length and direction, natural color variation, slight dirt, fine whiskers, translucent thin skin, moist reflective eyes, subtle subsurface scattering, real proportions, and believable muscles beneath fur. For humans, specify pores, fine facial hair, skin tone variation, moisture, natural eye reflections, anatomically plausible hands, and restrained asymmetry. Never add a real person's identity unless authorized.

Example:

```text
A real small brown-gray field mouse with thousands of individual fur strands of varied length and direction, soft translucent ears, tiny whiskers, moist reflective eyes, slight dirt near the paws, natural color variation, and true animal proportions.
```

### Material And Environment Reconstruction

Name physical evidence instead of generic nouns. Use material-appropriate roughness, micro-texture, scratches, dust, oxidation, moisture, dents, worn edges, uneven handmade surfaces, and accumulated dirt. Preserve believable scale, contact shadows, occlusion, atmospheric depth, and particles only when motivated by the scene.

Instead of `old house`, write:

```text
A real old timber-house interior with aged directional wood grain, uneven boards, small scratches, worn paint, dust visible in window light, a scuffed stone floor, dirt in joints, soft bounce from the window, natural shadows, and imperfect handmade materials.
```

### Camera And Lighting

Default to an ARRI Alexa 35 look, 35mm anamorphic cinema lens, f/2.0, natural depth of field, realistic exposure, restrained motion blur, and a subtle Kodak-style film grade. Override these only when the storyboard composition clearly requires a different physical lens or depth of field. Use motivated key light, global illumination, bounced fill, realistic shadow softness, and subtle volumetric light only where haze or particles physically support it.

Camera labels are realism anchors, not permission to change framing. Do not blur away critical anatomy or contact points.

## Style Presets

Choose at most one and keep the final medium live action:

- **Real Animal Documentary:** BBC Earth observational wildlife photography, natural animal behavior, macro detail where framing permits, natural fur, existing light, and a real habitat.
- **Hollywood Creature Film:** live-action creature feature photographed on a physical set, realistic animal behavior and anatomy, high-end invisible VFX integration, cinematic production lighting, and no visible render aesthetic.
- **Dark Realism:** dark cinematic atmosphere, realistic textures, motivated moody light, controlled high contrast, and enough exposure to keep faces, anatomy, and contacts readable.

## Human Gate

Before passing `--real-world-start-image-approved`, inspect the whole still at 100% and confirm all of the following:

- Every mapped subject has real anatomy and material behavior.
- Fur, skin, eyes, hair, fabric, and hard surfaces contain shot-scale biological or material micro-detail without waxy smoothing.
- The location has physical scale, surface wear, environmental depth, motivated lighting, bounce, shadows, occlusion, and contact.
- Lens perspective, exposure, depth of field, and color read as professional camera photography rather than a render preset.
- No line art, flat fill, cel shading, cartoon proportion, toy/plastic surface, text, UI, watermark, or split layout remains.
- The storyboard's count, role, broad composition, screen direction, and key props remain readable.
- The image is not byte-identical to the storyboard frame and is at least 300 px on each side.

If any check fails, repair only the photoreal still. Do not preflight, price, or submit either video path yet.
