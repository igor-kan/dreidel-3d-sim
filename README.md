# Dreidel 3D Physics Sim

A browser-based 3D dreidel simulation with real rigid-body physics, animated spin/fall behavior, multiple dreidel model variants, and programmatic value detection once the top settles.

## Features

- Three model presets: `Classic Wood`, `Slim Brass`, `Chunky Ceramic`
- External GLB model support via `/public/models` presets
- Real-time 3D rendering with `three.js`
- Rigid-body physics with `cannon-es` (gravity, friction, restitution, damping, sleep)
- Programmatic side detection (`Nun`, `Gimel`, `Hei`, `Shin`) from the final physics orientation
- Browser API hook: `window.getLastDreidelResult()`
- Event hook: `window.addEventListener("dreidel:settled", (e) => { ... })`

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Programmatic read example

```js
const latest = window.getLastDreidelResult();
if (latest) {
  console.log(latest.value); // "Nun" | "Gimel" | "Hei" | "Shin"
}

window.addEventListener("dreidel:settled", (event) => {
  console.log("Settled result:", event.detail.value);
});
```

## Notes on realism

- Physics time stepping runs at a fixed `120Hz` with sub-steps for stability.
- Material contact values are tuned to mimic a wooden/ceramic top on a tabletop.
- Rest detection requires sustained low linear + angular speed before declaring a final result.

## Using real 3D dreidel assets

1. Put your GLB files in `public/models/` (see `public/models/README.md`).
2. Use one of the `GLB ...` options in the model picker.
3. The app auto-falls back to procedural geometry if the asset cannot be loaded.

## Repository bootstrap

```bash
git init
git add .
git commit -m "feat: add dreidel 3d physics simulator"
```
