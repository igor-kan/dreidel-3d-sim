# How To Create Your Own Spinnable Dreidel Model (For Realistic Physics)

This guide is specific to this project (`three.js` visual + `cannon-es` rigid-body physics).

## Target outcome

Your custom dreidel should:

- look correct in 3D,
- tumble and settle naturally,
- map reliably to game values (`Nun`, `Gimel`, `Hei`, `Shin`) when stopped.

## 1) Model geometry guidelines

Use real-world-ish proportions (in Blender meters):

- body height: `0.85 - 1.05`
- body bottom radius: `0.45 - 0.60`
- body top radius: `0.30 - 0.42`
- tip height: `0.35 - 0.48`
- stem height: `0.28 - 0.42`

Physics quality rules:

- Keep the tip centered on the vertical axis.
- Avoid self-intersections and non-manifold geometry.
- Keep mesh reasonably low-poly (avoid extreme triangle counts).
- Prefer uniform wall thickness if hollow.

## 2) Orientation and origin requirements

Before export:

- `+Y` is up.
- Dreidel should be upright at rest orientation.
- Apply transforms (location/rotation/scale) in Blender.
- Set object origin to geometry center.

This repo auto-fits visual height, but correct axis/origin still matters for clean rotation.

## 3) Letter faces and game mapping

The code uses `faceOrder: ["Nun", "Gimel", "Hei", "Shin"]` around Y.

To keep result detection consistent:

- Place letters around the four side faces in that order.
- If your exported mesh is rotated around Y, set `rotationY` in `dreidelModels.ts`.
- If letter mapping appears shifted, tune `faceAngleOffset`.

## 4) Export format for this game

Recommended export from Blender:

- Format: **glTF Binary (`.glb`)**
- Include normals
- Include materials
- No animations needed

If you only have STL/OBJ, convert to GLB before use.

## 5) Add model to this project

1. Put model in `public/models/`.
2. Add a model entry in `src/sim/dreidelModels.ts` with `visual.kind = "gltf"`.
3. Set `assetUrl`, `scale`, `yOffset`, `rotationY`.
4. Tune physical parameters (`bodyTopRadius`, `bodyBottomRadius`, `mass`, etc.) to match your shape.

Example:

```ts
{
  key: "my-custom",
  label: "My Custom GLB",
  bodyTopRadius: 0.36,
  bodyBottomRadius: 0.50,
  bodyHeight: 0.92,
  tipHeight: 0.42,
  tipRadius: 0.24,
  stemHeight: 0.34,
  stemRadius: 0.11,
  mass: 0.09,
  colorA: 0x9e6b42,
  colorB: 0x5d3a23,
  stemColor: 0xd6b28e,
  faceOrder: ["Nun", "Gimel", "Hei", "Shin"],
  faceAngleOffset: 0,
  visual: {
    kind: "gltf",
    assetUrl: "/models/my-custom.glb",
    scale: 1,
    yOffset: 0,
    rotationY: 0
  }
}
```

## 6) Realism tuning checklist

Spin test 20-50 times and validate:

- No exploding collisions
- Natural wobble before settling
- Tip contact behaves plausibly
- Result detection triggers only when really settled

Then tune:

- `mass`
- `linearDamping` and `angularDamping` (in `createDreidelBody`)
- contact `friction` and `restitution` (in physics world contact material)

## 7) Known practical ranges in this project

Good starting ranges:

- mass: `0.07 - 0.12`
- linear damping: `0.15 - 0.25`
- angular damping: `0.10 - 0.20`
- friction: `0.30 - 0.50`
- restitution: `0.05 - 0.15`

## 8) Conversion utility included

Use this repo utility to convert STL to GLB:

```bash
blender -b --python tools/stl_to_glb.py -- \
  --input path/to/model.stl \
  --output public/models/model.glb \
  --smooth
```

