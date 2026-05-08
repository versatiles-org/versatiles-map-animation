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
		map.jumpTo({
			center: [cam.lng, cam.lat],
			zoom: cam.zoom,
			pitch: cam.pitch,
			bearing: cam.bearing,
			roll: cam.roll
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
			attributionControl: { compact: true }
		});
		map.on('move', () => {
			if (!map) return;
			store.liveCamera = readCamera();
		});
		map.once('load', () => {
			const attrib = container.querySelector('.maplibregl-ctrl-attrib');
			if (attrib?.classList.contains('maplibregl-compact')) {
				attrib.classList.remove('maplibregl-compact-show');
				attrib.removeAttribute('open');
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
</script>

<div bind:this={container} class="map-stage" data-testid="map-stage"></div>

<style>
	.map-stage {
		width: 100%;
		height: 100%;
		background: #111;
	}
	.map-stage :global(.maplibregl-canvas) {
		outline: none;
	}
</style>
