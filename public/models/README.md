# Custom Dreidel GLB Models

The simulator supports loading external dreidel assets through model presets.

## Expected files

Place these files in this folder:

- `dreidel-oak.glb`
- `dreidel-ceramic.glb`

If a file is missing or fails to load, the app automatically falls back to procedural dreidel geometry while preserving physics and result detection.

## Alignment notes

- Keep the model upright with +Y as up.
- Keep the model centered around origin before export when possible.
- If your model orientation is off, adjust `rotationY` in `src/sim/dreidelModels.ts`.
