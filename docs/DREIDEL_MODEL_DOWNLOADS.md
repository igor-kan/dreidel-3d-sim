# Dreidel 3D Model Downloads (Free Sources + Recommended Format)

This project can load external dreidel models from `public/models/*.glb`.

## Best format to download

Use this priority order:

1. `GLB` (best for this game): single file, easiest to deploy, includes mesh + materials.
2. `glTF + .bin + textures` (good): convert/pack to `GLB` before shipping.
3. `OBJ` / `STL` / `STEP` (acceptable source formats): convert to `GLB` for runtime.

For this repo, **runtime format should be `GLB`**.

## Verified free sources used here

## 1) Wikimedia Commons (open license, no login)

- Source page: https://commons.wikimedia.org/wiki/File:Dreidel.stl
- Direct STL (latest): https://upload.wikimedia.org/wikipedia/commons/e/e1/Dreidel.stl
- License: **CC BY-SA 4.0** (attribution + share-alike)

Additional historical revisions (also downloadable STL):

- https://upload.wikimedia.org/wikipedia/commons/archive/e/e1/20200711123228%21Dreidel.stl
- https://upload.wikimedia.org/wikipedia/commons/archive/e/e1/20200711104323%21Dreidel.stl
- https://upload.wikimedia.org/wikipedia/commons/archive/e/e1/20200711101420%21Dreidel.stl
- https://upload.wikimedia.org/wikipedia/commons/archive/e/e1/20200710221339%21Dreidel.stl

## 2) Adafruit Learn (direct CAD zip links)

- Guide: https://learn.adafruit.com/planetary-gear-dreidels/3d-printing
- CAD files zip: https://cdn-learn.adafruit.com/assets/assets/000/141/610/original/planetaryDreidelsCADfiles.zip?1765464659=
- Source files zip (`.step`, `.f3z`): https://cdn-learn.adafruit.com/assets/assets/000/141/611/original/planetaryDreidelsSourceFiles.zip?1765464671=

The CAD zip includes `dreidel_v1.stl` which was converted to GLB for this project.

## Sources tried but gated by login

- Free3D dreidel pages (download action redirects to login)
- Cults3D free dreidel page (free listing exists, download flow requires login)

## Files now available in this repo

Raw downloads:

- `public/models/sources/dreidel-wikimedia*.stl`
- `public/models/sources/adafruit-planetary-dreidels-cad.zip`
- `public/models/sources/adafruit-planetary-dreidels-source.zip`
- `public/models/sources/adafruit-planetary-cad/dreidel_v1.stl`

Converted runtime GLB files:

- `public/models/dreidel-oak.glb`
- `public/models/dreidel-ceramic.glb`
- `public/models/dreidel-wiki-smooth.glb`
- `public/models/dreidel-wiki-vintage.glb`

## Quick conversion command (STL -> GLB)

This repo includes `tools/stl_to_glb.py`:

```bash
blender -b --python tools/stl_to_glb.py -- \
  --input public/models/sources/dreidel-wikimedia.stl \
  --output public/models/dreidel-oak.glb \
  --smooth
```

## Attribution reminder

When you use external models, keep the original source URL and license with your project.
For Wikimedia CC BY-SA assets, attribution and share-alike obligations apply.
