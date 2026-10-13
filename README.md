# versatiles-map-animator

[![CI](https://github.com/versatiles-org/versatiles-map-animator/actions/workflows/ci.yml/badge.svg)](https://github.com/versatiles-org/versatiles-map-animator/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/versatiles-org/versatiles-map-animator/branch/main/graph/badge.svg)](https://codecov.io/gh/versatiles-org/versatiles-map-animator)
[![License: MIT](https://img.shields.io/github/license/versatiles-org/versatiles-map-animator)](./LICENSE)

Tool for composing camera animations on a VersaTiles map, previewing them in the browser and rendering them to video with a headless renderer, for TV-grade map animations.

Hosted but not publicly linked. The JSON schema is the durable contract; the editor and renderer talk it.

## Features

### Camera animation

- Drop keyframes on a timeline that capture the current camera (lng, lat, zoom, pitch, bearing, roll).
- Play back with eased interpolation between keyframes; shortest-path bearing/roll wrap.
- Every stop sets how gently the camera **eases in** (arrives) and **eases out** (leaves), each with its own slider when the stop is selected: 0 % is abrupt, at full speed; 100 % is very gradual. A quick take-off with a long, soft landing is two sliders away. A stronger easing makes the middle of the move faster — the speed curve on the timeline shows it. Click the percentage to go back to the default.
- Keyframes are **stops** or **waypoints**. The camera comes to rest on a stop and flies through a waypoint, so the keyframes from one stop to the next form one move. A move through waypoints is one flowing curve that only eases in and out at its two stops — for following a river, orbiting a place or drifting without pause. The curve is built from what the viewer sees: where it zooms in on the way, the ground is covered while the camera is still high, so it arrives over its target before it gets close and never races across the map; zoom, tilt and bearing do not swing past their keyframes. A waypoint as first or last keyframe starts or ends the animation in motion.
- A stop can **hold**: the camera rests there for a set time before moving on. Drag the right edge of the selected stop on the timeline or type the seconds; everything after it moves along.
- Travel style of a move that goes straight from stop to stop: **Fly over** (default, rises and descends on long distances) or **Stay low** (straight, without rising; the ground passes at an even speed on screen even while the zoom changes).
- The timeline shows every move as a band between its stops, coloured by how the camera travels, with waypoints as dots on it. Click a keyframe to edit the keyframe, click a band to edit the move. Each band draws the **speed of the picture** over its time as a curve, on one scale for all moves, so the easing of a stop and the pace through a waypoint can be read at a glance. A strip along a band turns orange, then red, where the picture moves too fast to follow (from 1.5 and 3 frame widths per second, counting everything that moves the picture: panning, zooming, turning and tilting, as seen through the camera's perspective).
- Scrub anywhere on the timeline; click a keyframe to select it and jump to its view; drag the selected keyframe along the track to retime it — and past its neighbours to **reorder** the sequence. Only the selected keyframe can be dragged, so a click never moves one by accident. The selected keyframe's time can also be typed into the **Time** field of the row above the timeline. Times lie on a grid of 1/100 s, the smallest step of an animation; anything finer in a loaded file or link is rounded to it.
- Timeline zoom & pan: vertical scroll / Ctrl-wheel / pinch zooms; horizontal scroll pans; drag the pan-bar thumb to scroll, drag its edges to zoom; the playhead can be moved past the last keyframe to add a new one there.
- **Undo and redo** every change to the animation with the two buttons in the top bar, or ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y). Dragging a keyframe or a slider counts as one step; loading a file or an example can be undone as well.
- **Keyboard:** Space plays and pauses, ← and → move the playhead by 0.1 s (with Shift by 1 s), Delete removes the selected keyframe (or, with none selected, the selected marker), Esc clears the selection.
- Insert keyframes at the current playhead (compose a shot, then **+ Keyframe** above the timeline).

### Map style

- Style: OSM vector map or `satellite`.
- Projection: Mercator (default) or globe. On the globe the camera travels along great circles and the globe keeps its size while it turns; it blends into Mercator as you zoom in. The camera centre stays within ±85.05° latitude, so the poles are in view but never dead centre.
- Theme: 24 colour themes for the OSM map — `colorful` (default), `natural`, `muted`, `gray`, `toner`, each with a `-dark` variant, plus lookalikes of other well-known maps. On satellite the theme colours the overlay.
- Toggle all labels and icons (or, for satellite, the OSM overlay on top).
- Switch individual layer groups on and off: land cover, water, roads, transit, buildings, sites, airports, boundaries, names, POIs, road markings.
- Optional 3D buildings with their real heights (OSM map, from zoom 14).
- Optional 3D terrain (with hillshade).
- Optional sun position (compass direction and height above the horizon) that lights the 3D buildings and the terrain's hillshade.
- Optional atmospheric sky (visible when the camera is pitched).
- Screen anchor: the point of the frame the camera is built around, anywhere from edge to edge instead of the middle. Keyframe positions sit there and zooms, rotations and tilts pivot around it — e.g. off to one side to leave room for a title.
- Composition aspect ratio: `16:9` (default), `21:9`, `4:3`, `3:2`, `1:1`, `4:5`, `9:16`. Editor preview, embed iframe, and MP4 render all letterbox to the chosen aspect, so the composition stays WYSIWYG across surfaces.

### Annotations

- Drop pin / arrow / circle / star / outline / icon markers anywhere on the map.
- Per-annotation editable label, font (187 SDF fonts bundled by the VersaTiles tile server), label position (9-way grid: top-left … bottom-right), label distance, label colour, label size.
- Per-annotation icon, icon colour, icon size, rotation.
- Per-annotation halo colour & width for both label text and the icon outline (auto-flipping default for legibility on any basemap).
- Visibility window with optional fade-in / fade-out tails — set on the timeline by dragging the four-handle bar that appears for the selected annotation.
- Drag annotations directly on the map; reorder them in the sidebar's **Markers** list by drag-and-drop.
- **Per-animation default style** — set a template under _Default style_ in the sidebar's **Markers** panel; every marker that doesn't override a field follows the template. Change the template later and every still-thin marker updates automatically. The same template is used as the starting state for newly-pinned markers.

### Sharing & rendering

- **Share by URL** — the entire animation (style, theme, terrain, sky, annotations, per-animation default style, scale, aspect ratio) is encoded into the URL hash with a bit-packed binary codec; any tester with the link sees the same animation.
- **Embed** in a third-party page via a generated `<iframe>` snippet (16:9, fluid width). The viewer is served from `/view` and carries the same URL-hash payload. See [`embed-demo.html`](http://versatiles.org/versatiles-map-animator/embed-demo.html) for the iframe in real-page context with a copy-paste snippet.
- **Local persistence** — the latest animation is mirrored to `localStorage`, so a reload without a hash restores it.
- **Export / import as JSON** for archival or hand-off.
- **Examples** — the editor's _Examples_ menu loads ready-made animations. They are the `.json` files in [`src/lib/examples/`](src/lib/examples/): to add one, export an animation as JSON, put the file there and give it a `"title"` and a `"description"` at the top.
- **Render to video** via the published Docker image. The editor's **Export video…** dialog lets you pick format, quality, resolution, frame rate and motion blur and copies the command. MP4 by default; `--format prores` for editing, `--format ffv1` or `--format animation` for lossless output, and `--quality high|standard|small` for the MP4 — see [`render/README.md`](render/README.md#formats):

  ```sh
  docker run --rm -it --pull always -v "$PWD:/out" \
    ghcr.io/versatiles-org/versatiles-map-animator:latest \
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
	"style": "colorful", // "colorful" (the OSM map) | "satellite"
	"theme": "colorful", // optional: colour theme, see MAP_THEMES in src/lib/types.ts
	"labels": true, // all names and symbols (OSM map) or overlay (satellite)
	"hiddenLayers": ["buildings", "pois"], // optional: layer groups switched off, see MAP_LAYER_GROUPS in src/lib/types.ts
	"buildings3d": false, // optional: buildings as 3D blocks (OSM map only)
	"projection": "mercator", // optional: "mercator" | "globe"
	"sun": { "direction": 210, "altitude": 60 }, // optional: where the light comes from, in whole degrees (clockwise from north, above the horizon)
	"terrain": false,
	"sky": false,
	"annotationScale": 1, // global multiplier on per-annotation iconSize/labelSize
	"aspectRatio": "16:9", // "16:9" | "21:9" | "4:3" | "3:2" | "1:1" | "4:5" | "9:16"
	"anchor": { "x": 0.5, "y": 0.5 }, // optional: point of the frame the camera is built around, as fractions from the top-left corner
	"keyframes": [
		{
			"t": 0.0, // seconds, on a grid of 1/100 s (finer values are rounded on load)
			"lng": 13.405,
			"lat": 52.52,
			"zoom": 10,
			"pitch": 0, // 0..90
			"bearing": 0, // -180..180
			"roll": 0, // -180..180
			"path": "arc", // optional: travel style of the move starting here — "arc" (Fly over) | "linear" (Stay low)
			"waypoint": false, // optional: true = the camera flies through instead of stopping
			"hold": 0, // optional: seconds the camera rests on this stop; it arrives at `t` and leaves at `t + hold`
			"easeIn": 0.65, // optional, stops only: how gently the camera arrives, 0 (abrupt) … 1 (very gradual)
			"easeOut": 0.65 // optional, stops only: the same for leaving. Unset: the default of the move
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

The URL hash uses a separate compact binary format that starts with a format tag. The editor writes `V2`; links in the older `V1` format still open. New optional features extend an in-struct options mask without bumping the format tag, so simple animations stay short and adding a feature doesn't invalidate previously-shared links. The format tag bumps only on a genuinely-breaking change — see the rule documented at the top of `src/lib/url_state/animation_codec.ts`.

## License

MIT — see `LICENSE`.
