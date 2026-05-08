# versatiles-map-animation

Prototype tool for composing camera animations on a VersaTiles map and previewing them in the browser. Long-term goal: feed the same data model into a headless renderer for TV-grade map animations.

**Status: prototype.** Hosted but not publicly linked. No video export yet — the JSON schema is the durable contract for a future renderer.

## Features

- Drop keyframes on a timeline that capture the current camera (lng, lat, zoom, pitch, bearing, roll).
- Play back the animation with ease-in-out interpolation between keyframes; shortest-path bearing/roll wrap.
- Scrub anywhere on the timeline; click a keyframe to jump to its view; drag markers to retime.
- Switchable map style (`colorful` / `satellite` / `satellite + overlay`) with optional 3D terrain.
- Timeline zoom & pan: vertical scroll / Ctrl-wheel / pinch zooms; horizontal scroll pans; drag the pan-bar thumb to scroll, drag its edges to zoom; the playhead can be moved past the last keyframe to add a new one there.
- Insert keyframes at the current playhead (compose a shot, then **+ Add** in the Keyframe group).
- Share by URL — the entire animation, style and terrain are encoded into the URL hash, so any tester with the link sees the same animation.
- Embed a chrome-free viewer in a third-party page via a generated `<iframe>` snippet (16:9, fluid width). The viewer is served from the `/view` route and carries the same URL-hash payload.
- Export / import as JSON for archival or hand-off.

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
npm run check    # format + svelte-check + eslint + vitest
```

## Schema

The keyframe sequence is encoded both into the URL hash and downloadable JSON. Schema version 1:

```jsonc
{
	"version": 1,
	"style": "colorful", // "colorful" | "satellite" | "satellite-overlay"
	"terrain": false, // optional; defaults to false
	"keyframes": [
		{
			"t": 0.0, // seconds
			"lng": 13.405,
			"lat": 52.52,
			"zoom": 10,
			"pitch": 0, // 0..90
			"bearing": 0, // -180..180
			"roll": 0 // -180..180
		}
	]
}
```

The URL encoding additionally omits `style` when it matches the default (`colorful`), `terrain` when it is `false`, and any keyframe field that matches the previous keyframe (or, on the first keyframe, the default `0`) to keep links shorter. Files written before `terrain` was added load fine — it defaults to `false`.

## License

MIT — see `LICENSE`.
