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
- Scrub anywhere on the timeline; click a keyframe to jump to its view; drag markers along the track to retime — and past their neighbours to **reorder** the sequence. Timestamps snap to 1/100 s.
- Timeline zoom & pan: vertical scroll / Ctrl-wheel / pinch zooms; horizontal scroll pans; drag the pan-bar thumb to scroll, drag its edges to zoom; the playhead can be moved past the last keyframe to add a new one there.
- Insert keyframes at the current playhead (compose a shot, then **+ Add** in the Keyframe group).

### Map style

- Style: `colorful` or `satellite`.
- Toggle place-name / road-shield labels (or, for satellite, the colorful overlay on top).
- Optional 3D terrain (with hillshade).
- Optional atmospheric sky (visible when the camera is pitched).
- Composition aspect ratio: `16:9` (default), `21:9`, `4:3`, `3:2`, `1:1`, `4:5`, `9:16`. Editor preview, embed iframe, and MP4 render all letterbox to the chosen aspect, so the composition stays WYSIWYG across surfaces.

### Annotations

- Drop pin / arrow / circle / star / outline / icon markers anywhere on the map.
- Per-annotation editable label, font (187 SDF fonts bundled by the VersaTiles tile server), label position (9-way grid: top-left … bottom-right), label distance, label colour, label size.
- Per-annotation icon, icon colour, icon size, rotation.
- Per-annotation halo colour & width for both label text and the icon outline (auto-flipping default for legibility on any basemap).
- Visibility window with optional fade-in / fade-out tails — set on the timeline by dragging the four-handle bar that appears for the selected annotation.
- Drag annotations directly on the map; reorder them in the sidebar's **Markers** list by drag-and-drop.
- **Per-animation default style** — set a template in the sidebar's _Default annotation style_ panel; every marker that doesn't override a field follows the template. Change the template later and every still-thin marker updates automatically. The same template is used as the starting state for newly-pinned markers.

### Sharing & rendering

- **Share by URL** — the entire animation (style, terrain, sky, annotations, per-animation default style, scale, aspect ratio) is encoded into the URL hash with a bit-packed binary codec; any tester with the link sees the same animation.
- **Embed** in a third-party page via a generated `<iframe>` snippet (16:9, fluid width). The viewer is served from `/view` and carries the same URL-hash payload. See [`embed-demo.html`](http://versatiles.org/versatiles-map-animation/embed-demo.html) for the iframe in real-page context with a copy-paste snippet.
- **Local persistence** — the latest animation is mirrored to `localStorage`, so a reload without a hash restores it.
- **Export / import as JSON** for archival or hand-off.
- **Render to MP4** via the published Docker image (button in the editor copies the command):

  ```sh
  docker run --rm --pull always -v "$PWD:/out" \
    ghcr.io/versatiles-org/versatiles-map-animation:latest \
    --hash '<URL-hash payload>' --width 1920 --fps 30 --output animation.mp4
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
	"aspectRatio": "16:9", // "16:9" | "21:9" | "4:3" | "3:2" | "1:1" | "4:5" | "9:16"
	"keyframes": [
		{
			"t": 0.0, // seconds, snapped to 1/100 s in the editor
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
		// Only `lng`, `lat`, and `label` are required. Every style field is
		// optional; the renderer fills missing ones from `defaultAnnotation`
		// below, then from the hardcoded baseline (`symbol-marker`, red, etc.).
		{
			"lng": 13.405,
			"lat": 52.52,
			"label": "Berlin",
			"icon": "symbol-marker", // optional; legacy "color" key also accepted for iconColor
			"iconColor": "#cc0000", // optional
			"iconSize": 1, // optional
			"iconHaloColor": "#ffffff", // optional
			"iconHaloWidth": 0, // optional
			"labelColor": "#111111", // optional
			"labelSize": 1, // optional
			"labelFont": "noto_sans_bold", // optional; see ANNOTATION_LABEL_FONTS in src/lib/types.ts
			"labelPosition": "bottom", // optional: top-left … bottom-right
			"labelDistance": 1.5, // optional: em from the geo point
			"labelHaloColor": "#ffffff", // optional: explicit override (else auto-flip for legibility)
			"labelHaloWidth": 1.5, // optional
			"rotation": 0, // optional, degrees clockwise (mainly for arrow icons)
			"visibleFrom": 0, // optional: hide before this time
			"visibleUntil": 5, // optional: hide at/after this time
			"fadeIn": 0.5, // optional: seconds; ramp 0→1 before visibleFrom
			"fadeOut": 0.5 // optional: seconds; ramp 1→0 after visibleUntil
		}
	],
	// Per-animation style template. Any annotation that omits a field below
	// inherits it from here. Position/content/time fields (lng/lat/label/
	// rotation/visibleFrom/visibleUntil/fadeIn/fadeOut) are never inherited
	// — those are per-annotation by definition.
	"defaultAnnotation": {
		"icon": "symbol-arrow1",
		"iconColor": "#ffffff",
		"iconHaloColor": "#000000",
		"iconHaloWidth": 1,
		"labelColor": "#ffffff",
		"labelHaloColor": "#000000",
		"labelHaloWidth": 1,
		"labelFont": "noto_sans_bold",
		"labelPosition": "top",
		"labelDistance": 1.8
	}
}
```

`version` is the JSON-format compat marker; new optional fields are added without bumping it. Files written before a feature was added still load — every additional field is optional and falls back to a sensible default.

The URL hash uses a separate compact binary format (single tag, `V1`). New optional features extend an in-struct options mask without bumping the format tag, so simple animations stay short and adding a feature doesn't invalidate previously-shared links. The format tag bumps to `V2` only on a genuinely-breaking change — see the rule documented at the top of `src/lib/url_state/animation_codec.ts`.

## License

MIT — see `LICENSE`.
