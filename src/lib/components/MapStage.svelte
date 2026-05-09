<script lang="ts">
	import type { FeatureCollection } from 'geojson';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { getAnnotationOpacity, type AnimationStore } from '../animation.svelte';
	import { ANNOTATION_SPRITE_ID, buildMapStyle } from '../map_style';
	import {
		ANNOTATION_ICON_OFFSETS,
		DEFAULT_ANNOTATION_LABEL_COLOR,
		DEFAULT_INITIAL_VIEW,
		DEFAULT_LABEL_DISTANCE,
		DEFAULT_LABEL_POSITION,
		type Annotation,
		type CameraState,
		type LabelPosition
	} from '../types';

	// Pick a halo colour with the opposite brightness so the label stays
	// legible regardless of the user's chosen text color. Uses the standard
	// luminance weights (Rec. 709 coefficients).
	function haloFor(hex: string): string {
		const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
		if (!m) return '#fff';
		const n = parseInt(m[1], 16);
		const r = (n >> 16) & 0xff;
		const g = (n >> 8) & 0xff;
		const b = n & 0xff;
		const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return lum > 0.5 ? '#000' : '#fff';
	}

	let { store, editMode = false }: { store: AnimationStore; editMode?: boolean } = $props();

	// Detect render mode once — used to suppress edit-mode opacity floor in
	// rendered video output, where the map should mirror real playback.
	const renderMode =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('render') === '1';
	const ANNOTATION_OPACITY_FLOOR = 0.1;

	let container: HTMLDivElement;
	let map: maplibregl.Map | undefined;
	let rafId = 0;

	const ANNOTATION_SOURCE = 'annotations';
	const ANNOTATION_LAYER = 'annotations-layer';

	// Translate user-facing labelPosition ("where the label sits relative to
	// the icon") into MapLibre's text-anchor (which corner of the text touches
	// the offset point) + a unit direction vector. The actual text-offset is
	// `unit × labelDistance` (in ems), computed per-feature so each annotation
	// can pick its own distance. text-offset is in ems, so it auto-scales with
	// text-size and stays a constant em-distance at any annotationScale.
	const LABEL_TEXT_ANCHOR: Record<LabelPosition, string> = {
		center: 'center',
		top: 'bottom',
		bottom: 'top',
		left: 'right',
		right: 'left',
		'top-left': 'bottom-right',
		'top-right': 'bottom-left',
		'bottom-left': 'top-right',
		'bottom-right': 'top-left'
	};
	const LABEL_OFFSET_UNIT: Record<LabelPosition, [number, number]> = {
		center: [0, 0],
		top: [0, -1],
		bottom: [0, 1],
		left: [-1, 0],
		right: [1, 0],
		'top-left': [-1, -1],
		'top-right': [1, -1],
		'bottom-left': [-1, 1],
		'bottom-right': [1, 1]
	};

	// Reference width for container-based scaling. At this width, scale = 1
	// and annotations render at their natural sprite size. Embeds smaller than
	// this get smaller annotations; 4K renders get larger ones. Clamped so
	// extreme viewports don't produce unreadable or absurd sizes.
	const REFERENCE_WIDTH = 1280;
	const BASE_TEXT_PX = 13;

	// Reactive flag set to true once the annotation source + layer exist on the
	// current style. Flips to false during a style switch and back to true after
	// the new style finishes loading and we've re-installed our layer. The
	// data + visibility effects depend on it so they re-run after style swaps.
	let annotationsReady = $state(false);
	let containerScale = $state(1);

	// ID of the annotation currently being dragged (undefined when not dragging).
	// Lives outside Svelte state because it's only read by handlers, not rendered.
	let dragId: number | undefined;

	function updateContainerScale(): void {
		if (!map) return;
		const w = map.getContainer().clientWidth;
		if (w > 0) containerScale = Math.max(0.5, Math.min(3, w / REFERENCE_WIDTH));
	}

	function onDragMove(e: maplibregl.MapMouseEvent): void {
		if (dragId === undefined) return;
		const { lng, lat } = e.lngLat;
		store.updateAnnotation(dragId, { lng, lat });
	}

	function onDragEnd(): void {
		if (!map) return;
		map.off('mousemove', onDragMove);
		map.getCanvas().style.cursor = '';
		dragId = undefined;
	}

	function buildAnnotationFeatures(anns: Annotation[]): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: anns.map((a, i) => {
				const pos = a.labelPosition ?? DEFAULT_LABEL_POSITION;
				const dist = a.labelDistance ?? DEFAULT_LABEL_DISTANCE;
				const unit = LABEL_OFFSET_UNIT[pos];
				return {
					type: 'Feature',
					id: i,
					geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
					properties: {
						icon: a.icon,
						color: a.color,
						label: a.label,
						rotation: a.rotation ?? 0,
						offset: ANNOTATION_ICON_OFFSETS[a.icon],
						iconSize: a.iconSize ?? 1,
						labelSize: a.labelSize ?? 1,
						textAnchor: LABEL_TEXT_ANCHOR[pos],
						textOffset: [unit[0] * dist, unit[1] * dist] as [number, number],
						labelColor: a.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR,
						labelHalo: haloFor(a.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)
					}
				};
			})
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
					// Anchor at the geo point; the per-feature `offset` shifts the
					// icon so that its tuned pivot pixel sits exactly on the anchor.
					// `icon-rotate` then pivots around that pixel, which is what we
					// want for marker tips, arrow tips, etc.
					'icon-anchor': 'center',
					'icon-offset': ['get', 'offset'],
					'icon-rotate': ['get', 'rotation'],
					'icon-size': 1,
					'icon-allow-overlap': true,
					'icon-ignore-placement': true,
					'text-field': ['get', 'label'],
					'text-font': ['noto_sans_bold'],
					'text-size': 13,
					// Per-feature label placement (computed in `buildAnnotationFeatures`
					// from the annotation's `labelPosition`). text-offset is in ems so
					// it auto-scales with text-size, keeping the label a constant
					// em-distance from the icon at any annotationScale.
					'text-anchor': ['get', 'textAnchor'],
					'text-offset': ['get', 'textOffset'],
					'text-allow-overlap': false,
					'text-optional': true
				},
				paint: {
					'icon-color': ['get', 'color'],
					// Opacity flows from feature-state, set per frame from
					// `getAnnotationOpacity`. Default 1 if state is missing (e.g.
					// in the brief moment after the layer is re-installed but
					// before the per-frame effect runs).
					'icon-opacity': ['coalesce', ['feature-state', 'opacity'], 1],
					// Per-feature label colour. Halo is auto-flipped to the
					// contrasting brightness in `buildAnnotationFeatures`, so
					// any user-picked text colour stays legible.
					'text-color': ['get', 'labelColor'],
					'text-halo-color': ['get', 'labelHalo'],
					'text-halo-width': 1.5,
					'text-opacity': ['coalesce', ['feature-state', 'opacity'], 1]
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
		const initialLabels = untrack(() => store.labels);
		const initialTerrain = untrack(() => store.terrain);
		const initialCam = untrack(() => store.sampledCamera) ?? DEFAULT_INITIAL_VIEW;
		const style = await buildMapStyle(initialId, initialLabels, initialTerrain);
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
		map.on('resize', updateContainerScale);
		updateContainerScale();
		// Click on an annotation marker → select it. Click on empty map → clear
		// any annotation selection. The marker click handler stops propagation,
		// so the empty-map fallback only fires when no marker was hit.
		map.on('click', ANNOTATION_LAYER, (e) => {
			const id = e.features?.[0]?.id;
			if (typeof id === 'number') store.selectAnnotation(id);
		});
		map.on('click', (e) => {
			if (!map) return;
			const hits = map.queryRenderedFeatures(e.point, { layers: [ANNOTATION_LAYER] });
			if (hits.length === 0) store.clearAnnotationSelection();
		});
		// Cursor feedback for hover-able markers.
		map.on('mouseenter', ANNOTATION_LAYER, () => {
			if (map && dragId === undefined) map.getCanvas().style.cursor = 'pointer';
		});
		map.on('mouseleave', ANNOTATION_LAYER, () => {
			if (map && dragId === undefined) map.getCanvas().style.cursor = '';
		});
		// Drag to reposition: mousedown on a marker captures it, subsequent
		// mousemoves rewrite its lng/lat in the store (which flows back into
		// the source via the data effect), mouseup releases. We disable the
		// map's drag-pan for the duration so the camera doesn't slide along
		// with the pointer.
		map.on('mousedown', ANNOTATION_LAYER, (e) => {
			if (!map) return;
			const id = e.features?.[0]?.id;
			if (typeof id !== 'number') return;
			e.preventDefault(); // suppress default map drag-pan
			dragId = id;
			store.selectAnnotation(id);
			map.getCanvas().style.cursor = 'grabbing';
			map.on('mousemove', onDragMove);
			map.once('mouseup', onDragEnd);
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
		const labels = store.labels;
		const terrain = store.terrain;
		if (!map || !initialStyleApplied) return;
		let cancelled = false;
		buildMapStyle(id, labels, terrain).then((newStyle) => {
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

	// Per-frame opacity. Tracks `currentTime` and `annotations` so it re-runs
	// during playback and after edits. Sets `opacity` feature-state (0..1) on
	// every annotation; the layer's icon/text-opacity expressions read it via
	// `coalesce`. Pushing a continuous value lets fade-in / fade-out tails
	// render as smooth ramps rather than hard cuts.
	//
	// Edit mode: when the user is composing (not rendering, not playing, not
	// scrubbing), floor the opacity at `ANNOTATION_OPACITY_FLOOR` so hidden
	// annotations stay clickable and findable. The moment the user plays the
	// animation or drags the playhead, the floor lifts so they see the real
	// fade behaviour — same as the rendered MP4 would show.
	$effect(() => {
		const anns = store.annotations;
		const t = store.currentTime;
		const ready = annotationsReady;
		const previewing = store.isPlaying || store.isScrubbing;
		const floor = editMode && !renderMode && !previewing ? ANNOTATION_OPACITY_FLOOR : 0;
		if (!ready || !map) return;
		for (let i = 0; i < anns.length; i++) {
			const o = getAnnotationOpacity(anns[i], t);
			map.setFeatureState({ source: ANNOTATION_SOURCE, id: i }, { opacity: Math.max(floor, o) });
		}
	});

	// Combined scale = container-width factor × user-set annotationScale ×
	// per-annotation iconSize / labelSize. The per-annotation factor is read
	// from the feature property, so the layer expression encodes both halves
	// and we only re-set it when the global half changes.
	//
	// text-offset is in ems so it auto-scales with text-size; icon-offset is
	// multiplied by icon-size internally by MapLibre, so the tuned pivot
	// pixels stay correct at any scale.
	$effect(() => {
		const ready = annotationsReady;
		const cs = containerScale;
		const us = store.annotationScale;
		if (!ready || !map) return;
		const globalScale = cs * us;
		map.setLayoutProperty(ANNOTATION_LAYER, 'icon-size', ['*', ['get', 'iconSize'], globalScale]);
		map.setLayoutProperty(ANNOTATION_LAYER, 'text-size', [
			'*',
			['get', 'labelSize'],
			BASE_TEXT_PX * globalScale
		]);
	});

	// Watermark colours flip with the base map: dark text + light outline reads
	// best on the colourful style, light text + dark outline on satellite imagery.
	const onSatellite = $derived(store.style === 'satellite');
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
		/* Clip the maplibre canvas + watermark to the rounded box. The clip
		   used to live on the parent `.map-area` but that also clipped the
		   AnnotationPanel — which is a sibling of `.map-stage` and needs to
		   extend below the map on short viewports. */
		overflow: hidden;
		border-radius: inherit;
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
