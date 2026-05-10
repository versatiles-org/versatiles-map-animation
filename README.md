# versatiles-map-animation

[![CI](https://github.com/versatiles-org/versatiles-map-animation/actions/workflows/ci.yml/badge.svg)](https://github.com/versatiles-org/versatiles-map-animation/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/versatiles-org/versatiles-map-animation/branch/main/graph/badge.svg)](https://codecov.io/gh/versatiles-org/versatiles-map-animation)
[![License: MIT](https://img.shields.io/github/license/versatiles-org/versatiles-map-animation)](./LICENSE)

Prototype tool for composing camera animations on a VersaTiles map and previewing them in the browser. Long-term goal: feed the same data model into a headless renderer for TV-grade map animations.

**Status: prototype.** Hosted but not publicly linked. The JSON schema is the durable contract; the editor and renderer talk it.

## Features

### Camera animation

- Drop keyframes on a timeline that capture the current camera (lng, lat, zoom, pitch, bearing, roll).
- Play back with ease-in-out interpolation between keyframes; shortest-path bearing/roll wrap.
- Per-segment trajectory style: **arc** (default, smooth great-circle path) or **linear**.
- Scrub anywhere on the timeline; click a keyframe to jump to its view; drag markers to retime.
- Timeline zoom & pan: vertical scroll / Ctrl-wheel / pinch zooms; horizontal scroll pans; drag the pan-bar thumb to scroll, drag its edges to zoom; the playhead can be moved past the last keyframe to add a new one there.
- Insert keyframes at the current playhead (compose a shot, then **+ Add** in the Keyframe group).

### Map style

- Style: `colorful` or `satellite`.
- Toggle place-name / road-shield labels (or, for satellite, the colorful overlay on top).
- Optional 3D terrain (with hillshade).
- Optional atmospheric sky (visible when the camera is pitched).

### Annotations

- Drop pin / arrow / circle / star / outline / icon markers anywhere on the map.
- Per-annotation editable label, label position (9-way grid: top-left … bottom-right), label distance, label colour, font size.
- Per-annotation icon colour, icon size, rotation.
- Per-annotation halo colour & width for both label text and the icon outline (auto-flipping default for legibility on any basemap).
- Visibility window with optional fade-in / fade-out tails — set on the timeline by dragging the four-handle bar that appears for the selected annotation.
- Drag annotations directly on the map.

### Sharing & rendering

- **Share by URL** — the entire animation (style, terrain, sky, annotations, scale) is encoded into the URL hash with a bit-packed binary codec; any tester with the link sees the same animation.
- **Embed** in a third-party page via a generated `<iframe>` snippet (16:9, fluid width). The viewer is served from `/view` and carries the same URL-hash payload. See [`embed-demo.html`](http://versatiles.org/versatiles-map-animation/embed-demo.html) for the iframe in real-page context with a copy-paste snippet.
- **Local persistence** — the latest animation is mirrored to `localStorage`, so a reload without a hash restores it.
- **Export / import as JSON** for archival or hand-off.
- **Render to MP4** via the published Docker image (button in the editor copies the command):

  ```sh
  docker run --rm --pull always -v "$PWD:/out" \
    ghcr.io/versatiles-org/versatiles-map-animation:latest \
    --hash '<URL-hash payload>' --width 1920 --fps 30 --output /out/animation.mp4
  ```

## Run locally

```sh
npm install
npm run dev      # http://localhost:5173
```

## Build a static site

```sh
npm run build
```

Output in `build/`. Deploy to any static host (GitHub Pages, Cloudflare Pages, etc.). URL-hash state means no server-side support is needed.

## Quality checks

```sh
npm run check          # format + svelte-check + eslint + vitest
npm run test:coverage  # vitest with v8 coverage
```

## Schema

The same shape ships in the downloadable JSON and (in a more compact bit-packed form) the URL hash. JSON schema version 1:

```jsonc
{
	"version": 1,
	"style": "colorful", // "colorful" | "satellite"
	"labels": true, // place names (colorful) or overlay (satellite)
	"terrain": false,
	"sky": false,
	"annotationScale": 1, // global multiplier on per-annotation iconSize/labelSize
	"keyframes": [
		{
			"t": 0.0, // seconds
			"lng": 13.405,
			"lat": 52.52,
			"zoom": 10,
			"pitch": 0, // 0..90
			"bearing": 0, // -180..180
			"roll": 0, // -180..180
			"path": "arc" // optional: "arc" | "linear" — trajectory to this keyframe
		}
	],
	"annotations": [
		{
			"lng": 13.405,
			"lat": 52.52,
			"icon": "symbol-marker",
			"color": "#cc0000",
			"label": "Berlin",
			"labelColor": "#111111", // optional
			"labelPosition": "bottom", // optional: top-left … bottom-right
			"labelDistance": 1.5, // optional: em from the geo point
			"iconSize": 1, // optional
			"labelSize": 1, // optional
			"rotation": 0, // optional, degrees clockwise (mainly for arrow icons)
			"visibleFrom": 0, // optional: hide before this time
			"visibleUntil": 5, // optional: hide at/after this time
			"fadeIn": 0.5, // optional: seconds; ramp 0→1 before visibleFrom
			"fadeOut": 0.5, // optional: seconds; ramp 1→0 after visibleUntil
			"labelHaloColor": "#ffffff", // optional: explicit override (else auto-flip for legibility)
			"labelHaloWidth": 1.5,
			"iconHaloColor": "#ffffff",
			"iconHaloWidth": 0
		}
	]
}
```

`version` is the JSON-format compat marker; new optional fields are added without bumping it. Files written before a feature was added still load — every additional field is optional and falls back to a sensible default.

The URL hash uses a separate layered binary format with five tags (`V1`..`V5`); the encoder picks the smallest version that round-trips the current animation losslessly, so simple animations stay short and existing share links remain stable as new features land.

## License

MIT — see `LICENSE`.
