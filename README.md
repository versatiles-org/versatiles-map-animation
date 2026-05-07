# versatiles-map-animation

Prototype tool for composing camera animations on a VersaTiles map and previewing them in the browser. Long-term goal: feed the same data model into a headless renderer for TV-grade map animations.

**Status: prototype.** Hosted but not publicly linked. No video export yet — the JSON schema is the durable contract for a future renderer.

## Features

- Drop keyframes on a timeline that capture the current camera (lng, lat, zoom, pitch, bearing, roll).
- Play back the animation with ease-in-out interpolation between keyframes; shortest-path bearing/roll wrap.
- Scrub the timeline; click a keyframe to jump to its view; drag markers to retime.
- Insert keyframes at the current playhead (drag, then "+ Add KF").
- Share by URL — the entire animation is encoded into the URL hash, so any tester with the link sees the same animation.
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
	"style": "colorful",
	"keyframes": [
		{
			"t": 0.0, // seconds
			"lng": 13.405,
			"lat": 52.52,
			"zoom": 10,
			"pitch": 0, // 0..85
			"bearing": 0, // -180..180
			"roll": 0 // -180..180
		}
	]
}
```

The URL encoding additionally omits fields that match the previous keyframe (or, on the first keyframe, the default `0`) to keep links shorter.

## License

MIT — see `LICENSE`.
