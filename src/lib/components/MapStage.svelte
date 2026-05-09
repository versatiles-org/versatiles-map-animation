<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { AnimationStore } from '../animation.svelte';
	import { buildMapStyle } from '../map_style';
	import { DEFAULT_INITIAL_VIEW, type CameraState } from '../types';

	let { store }: { store: AnimationStore } = $props();

	let container: HTMLDivElement;
	let map: maplibregl.Map | undefined;
	let rafId = 0;

	function readCamera(): CameraState {
		if (!map) return { ...DEFAULT_INITIAL_VIEW };
		const c = map.getCenter();
		return {
			lng: c.lng,
			lat: c.lat,
			zoom: map.getZoom(),
			pitch: map.getPitch(),
			bearing: map.getBearing(),
			roll: map.getRoll()
		};
	}

	function applyCamera(cam: CameraState): void {
		if (!map) return;
		// easeTo + freezeElevation skips MapLibre's per-step elevation tracking,
		// which would otherwise snap transform.elevation to the focal point's
		// terrain elevation each frame. Locking it to a fixed reference (set
		// once after map creation) eliminates two artifacts at once: the camera
		// "hop" when panning over hills, and the visible jump at integer-zoom
		// crossings (caused by terrain LOD swaps changing the elevation lookup).
		map.easeTo({
			center: [cam.lng, cam.lat],
			zoom: cam.zoom,
			pitch: cam.pitch,
			bearing: cam.bearing,
			roll: cam.roll,
			duration: 0,
			animate: false,
			freezeElevation: true
		});
	}

	let initialStyleApplied = false;

	onMount(async () => {
		const initialId = untrack(() => store.style);
		const initialTerrain = untrack(() => store.terrain);
		const initialCam = untrack(() => store.sampledCamera) ?? DEFAULT_INITIAL_VIEW;
		const style = await buildMapStyle(initialId, initialTerrain);
		map = new maplibregl.Map({
			container,
			style,
			center: [initialCam.lng, initialCam.lat],
			zoom: initialCam.zoom,
			pitch: initialCam.pitch,
			bearing: initialCam.bearing,
			roll: initialCam.roll,
			maxPitch: 90,
			// Disable MapLibre's built-in attribution control; we render a
			// minimal "VersaTiles" watermark in the corner instead (see template).
			attributionControl: false,
			centerClampedToGround: false,
			// Animations sweep across many zoom levels and revisit the same
			// regions repeatedly. The default cache (5 zoom levels worth of
			// viewports) thrashes during playback; 12 keeps a much wider band
			// of tiles around in memory at the cost of some extra RAM. Disable
			// expired-tile refetches too — the satellite/DEM data we use is
			// stable, so respecting the browser's HTTP cache is fine.
			maxTileCacheZoomLevels: 20,
			refreshExpiredTiles: false
		});
		map.on('move', () => {
			if (!map) return;
			store.liveCamera = readCamera();
		});
		map.once('load', () => {
			// Fix the camera's altitude reference at sea level; combined with
			// `freezeElevation: true` on subsequent easeTo calls, this prevents
			// MapLibre from updating transform.elevation each frame.
			map?.setCenterElevation(0);
			// Expose the map instance for the offline renderer (see render/).
			if (new URLSearchParams(window.location.search).get('render') === '1') {
				(window as unknown as { __map: unknown }).__map = map;
			}
		});
		initialStyleApplied = true;
	});

	onDestroy(() => {
		if (rafId) cancelAnimationFrame(rafId);
		map?.remove();
	});

	// Drive the playhead during playback. The cameraDriver effect (below) reacts
	// to currentTime changes and applies the sampled camera each frame.
	$effect(() => {
		if (!store.isPlaying || store.keyframes.length < 2) return;
		let last = performance.now();
		const tick = (now: number) => {
			if (!store.isPlaying) return;
			const dt = (now - last) / 1000;
			last = now;
			const next = store.currentTime + dt;
			if (next >= store.totalDuration) {
				store.seekTo(store.totalDuration);
				store.pause();
			} else {
				store.seekTo(next);
			}
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => {
			if (rafId) cancelAnimationFrame(rafId);
			rafId = 0;
		};
	});

	// Apply the sampled camera to the map whenever it changes (playback or scrub).
	// When the user navigates freely, this effect doesn't fire because neither
	// keyframes nor currentTime changed.
	$effect(() => {
		const cam = store.sampledCamera;
		if (!cam || !map) return;
		applyCamera(cam);
	});

	$effect(() => {
		const id = store.style;
		const terrain = store.terrain;
		if (!map || !initialStyleApplied) return;
		let cancelled = false;
		buildMapStyle(id, terrain).then((newStyle) => {
			if (cancelled || !map) return;
			map.setStyle(newStyle, { diff: false });
		});
		return () => {
			cancelled = true;
		};
	});

	// Watermark colours flip with the base map: dark text + light outline reads
	// best on the colourful style, light text + dark outline on satellite imagery.
	const onSatellite = $derived(store.style === 'satellite' || store.style === 'satellite-overlay');
</script>

<div class="map-stage" data-testid="map-stage">
	<div bind:this={container} class="map-canvas"></div>
	<a
		class="watermark"
		class:on-satellite={onSatellite}
		href="https://versatiles.org/sources"
		target="_blank"
		rel="noopener noreferrer">VersaTiles</a
	>
</div>

<style>
	.map-stage {
		position: relative;
		width: 100%;
		height: 100%;
		background: #111;
	}
	.map-canvas {
		width: 100%;
		height: 100%;
	}
	.map-stage :global(.maplibregl-canvas) {
		outline: none;
	}
	.watermark {
		position: absolute;
		bottom: 4px;
		right: 6px;
		z-index: 1;
		font:
			600 11px/1 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		text-decoration: none;
		paint-order: stroke fill; /* stroke under the fill */
		user-select: none;
		letter-spacing: 0.02em;
		/* Default: colourful style — dark glyphs on a light halo. */
		color: #000;
		-webkit-text-stroke: 2px #fff;
	}
	.watermark.on-satellite {
		color: #fff;
		-webkit-text-stroke: 2px #000;
	}
</style>
