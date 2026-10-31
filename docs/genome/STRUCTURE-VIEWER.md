# Vision page 3D structure viewer: browser test, 2026-10-31

The protein structure on `/vision` is drawn by Mol* with WebGL. A headless capture had shown an empty panel,
so the page was tested in several browser setups. Each run measured how long the canvas took to show the
model (by counting non-background pixels), and recorded console errors, failed network requests and the
WebGL renderer.

| Browser setup | WebGL | Renderer | Model drawn after | Console | Failed requests |
| --- | --- | --- | --- | --- | --- |
| Chromium, headless, `--use-gl=swiftshader` | WebGL 2 | SwiftShader (software) | 14.5 s (includes first dev-server compile) | 2 driver performance warnings | none |
| Chromium, headless, default flags | WebGL 2 | SwiftShader (software) | 8.1 s | Chrome warns that automatic fallback to software WebGL is deprecated; driver warnings | none |
| Chromium, headed, on a virtual display (Xvfb) | WebGL 2 | SwiftShader (software) | 8.2 s | as above | none |
| Chromium, headless, WebGL disabled (`--disable-webgl --disable-3d-apis`) | none | — | never | before the fix: uncaught "Could not create a WebGL rendering context"; after: none | none |

## Findings

- **The viewer works wherever WebGL exists.** The earlier empty panel came from a screenshot taken 5 s after
  load, before software rendering had finished. It was not a failure.
- **Software WebGL is slow.** Without a GPU, the model takes about 8 s to appear, and the panel looked empty
  while it built.
- **Without WebGL, the panel was poor:** one line of text, plus an uncaught error in the console.
- **Chrome is retiring automatic software WebGL.** On machines without a usable GPU, future versions may
  refuse WebGL, which is the WebGL-disabled case above.

## Changes (`src/components/vision/MolViewer.tsx`)

- WebGL is checked before Mol* starts, so a missing WebGL no longer throws.
- "Building the 3D model…" shows (as a status) until the first drawing.
- Without WebGL, or if the viewer fails to start, the panel shows a still picture of the same AlphaFold model.
  It was rendered by Mol* from the same file, in light and dark (`public/vision/stills/`). It is labelled as a
  still, with the reason in plain words.

## Not tested

No browser with a hardware GPU was available in the build environment; every run used Chromium's software
renderer. A one-minute check on the demo machine before a pitch:

1. Open `/vision` in the browser that will be used.
2. Confirm the structure appears and turns.
3. Open `chrome://gpu` and check that WebGL is "Hardware accelerated".
