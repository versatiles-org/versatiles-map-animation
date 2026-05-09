<script lang="ts">
	import type { FeatureCollection } from 'geojson';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { isAnnotationVisible, type AnimationStore } from '../animation.svelte';
	import { ANNOTATION_SPRITE_ID, buildMapStyle } from '../map_style';
	import {
		ANNOTATION_ICON_ANCHORS,
		DEFAULT_INITIAL_VIEW,
		type Annotation,
		type CameraState
	} from '../types';

	let { store }: { store: AnimationStore } = $props();

	let container: HTMLDivElement;
	let map: maplibregl.Map | undefined;
	let rafId = 0;

	const ANNOTATION_SOURCE = 'annotations';
	const ANNOTATION_LAYER = 'annotations-layer';

	// Reactive flag set to true once the annotation source + layer exist on the
	// current style. Flips to false during a style switch and back to true after
	// the new style finishes loading and we've re-installed our layer. The
	// data + visibility effects depend on it so they re-run after style swaps.
	let annotationsReady = $state(false);

	function buildAnnotationFeatures(anns: Annotation[]): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: anns.map((a, i) => ({
				type: 'Feature',
				id: i,
				geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
				properties: {
					icon: a.icon,
					color: a.color,
					label: a.label,
					rotation: a.rotation ?? 0,
					anchor: ANNOTATION_ICON_ANCHORS[a.icon]
				}
			}))
		};
	}

	function setupAnnotationLayer(): void {
		if (!map) return;
		if (!map.getSource(ANNOTATION_SOURCE)) {
			map.addSource(ANNOTATION_SOURCE, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			});
		}
		if (!map.getLayer(ANNOTATION_LAYER)) {
			map.addLayer({
				id: ANNOTATION_LAYER,
				type: 'symbol',
				source: ANNOTATION_SOURCE,
				layout: {
					'icon-image': ['concat', `${ANNOTATION_SPRITE_ID}:`, ['get', 'icon']],
					'icon-anchor': ['get', 'anchor'],
					'icon-rotate': ['get', 'rotation'],
					'icon-size': 1,
					'icon-allow-overlap': true,
					'icon-ignore-placement': true,
					'text-field': ['get', 'label'],
					'text-font': ['noto_sans_bold'],
					'text-size': 13,
					'text-anchor': ['case', ['==', ['get', 'anchor'], 'bottom'], 'bottom', 'top'],
					// Push the label clear of the icon. ems are scaled by `text-size`
					// (13px), so 2.7em ≈ 35px clears a 32px marker; 1.5em ≈ 20px
					// clears the bottom half of a centered 32px icon.
					'text-offset': [
						'case',
						['==', ['get', 'anchor'], 'bottom'],
						['literal', [0, -2.7]],
						['literal', [0, 1.5]]
					],
					'text-allow-overlap': false,
					'text-optional': true
				},
				paint: {
					'icon-color': ['get', 'color'],
					'icon-opacity': ['case', ['==', ['feature-state', 'visible'], false], 0, 1],
					'text-color': '#111',
					'text-halo-color': '#fff',
					'text-halo-width': 1.5,
					'text-opacity': ['case', ['==', ['feature-state', 'visible'], false], 0, 1]
				}
			});
		}
		annotationsReady = true;
	}

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
			setupAnnotationLayer();
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
			// setStyle({ diff: false }) wipes our custom source/layer along with
			// the rest. Re-install once the new style has finished loading.
			annotationsReady = false;
			map.setStyle(newStyle, { diff: false });
			map.once('style.load', () => {
				if (cancelled) return;
				setupAnnotationLayer();
			});
		});
		return () => {
			cancelled = true;
		};
	});

	// Push the annotation array to the GeoJSON source whenever it changes
	// (or after a style swap re-installed the source). Re-using `setData()`
	// instead of recreating the source preserves any feature state we set.
	// Read `annotationsReady` before the `map` check so JS short-circuit
	// can't skip its tracking on the first run (when map is still undefined).
	$effect(() => {
		const anns = store.annotations;
		const ready = annotationsReady;
		if (!ready || !map) return;
		const source = map.getSource(ANNOTATION_SOURCE) as maplibregl.GeoJSONSource | undefined;
		if (!source) return;
		source.setData(buildAnnotationFeatures(anns));
	});

	// Per-frame visibility. Tracks `currentTime` and `annotations` so it re-runs
	// during playback and after edits. Sets `visible` feature-state on every
	// annotation; the layer's opacity expressions read it.
	$effect(() => {
		const anns = store.annotations;
		const t = store.currentTime;
		const ready = annotationsReady;
		if (!ready || !map) return;
		for (let i = 0; i < anns.length; i++) {
			map.setFeatureState(
				{ source: ANNOTATION_SOURCE, id: i },
				{ visible: isAnnotationVisible(anns[i], t) }
			);
		}
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
		/* Make `.map-stage` a query container so the watermark can size itself
		   relative to the actual map width via `cqw` units. */
		container-type: inline-size;
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
		/* Sized as a fraction of the map width via `cqw` so the watermark scales
		   with the canvas (4K renders get a chunkier label, narrow embeds a
		   smaller one). The `clamp()` keeps it readable at the extremes. */
		bottom: 0.4cqw;
		right: 0.6cqw;
		z-index: 1;
		font:
			600 clamp(10px, 1.1cqw, 28px) / 1 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		text-decoration: none;
		paint-order: stroke fill; /* stroke under the fill */
		user-select: none;
		letter-spacing: 0.02em;
		/* Stroke width grows with the font (em-relative). */
		-webkit-text-stroke-width: 0.18em;
		/* Default: colourful style — dark glyphs on a light halo. */
		color: #000;
		-webkit-text-stroke-color: #fff;
	}
	.watermark.on-satellite {
		color: #fff;
		-webkit-text-stroke-color: #000;
	}
</style>
