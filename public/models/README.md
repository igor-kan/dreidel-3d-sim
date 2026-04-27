# Custom Dreidel GLB Models

This simulator loads external dreidel visuals from this folder via model presets in
`src/sim/dreidelModels.ts`.

## Included GLB assets

- `dreidel-oak.glb` (converted from Wikimedia STL)
- `dreidel-ceramic.glb` (converted from Adafruit CAD STL)
- `dreidel-wiki-smooth.glb` (Wikimedia historical revision)
- `dreidel-wiki-vintage.glb` (Wikimedia historical revision)

## Source assets and zips

Original downloads are stored in:

- `public/models/sources/`

## Adding your own model

1. Add your `.glb` file in `public/models/`.
2. Add/update a preset in `src/sim/dreidelModels.ts`.
3. Tune `scale`, `yOffset`, and `rotationY` if needed.

If a GLB fails to load, the app automatically falls back to procedural dreidel geometry.

## More documentation

- `docs/DREIDEL_MODEL_DOWNLOADS.md`
- `docs/BUILD_SPINNABLE_DREIDEL_MODEL.md`
