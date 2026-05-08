<script lang="ts">
	import { onMount } from 'svelte';
	import { AnimationStore } from '$lib/animation.svelte';
	import { readAnimationFromUrl } from '$lib/url_state';
	import MapStage from '$lib/components/MapStage.svelte';

	const store = new AnimationStore();
	let loadError = $state<string | null>(null);

	// Load before MapStage mounts so the map is built with the correct style/terrain.
	try {
		const anim = readAnimationFromUrl();
		if (anim) store.loadFromAnimation(anim);
	} catch (err) {
		loadError = err instanceof Error ? err.message : 'Could not load animation.';
	}

	function onPlay() {
		if (store.currentTime >= store.totalDuration) store.currentTime = 0;
		store.play();
	}

	const canPlay = $derived(store.keyframes.length >= 2);

	// Render mode (`?render=1`): the page is being driven by an offline
	// rendering pipeline (see render/render.mjs). Hide the play overlay and
	// expose a tiny hook so the renderer can drive the playhead frame-by-frame.
	const renderMode =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('render') === '1';

	onMount(() => {
		if (!renderMode) return;
		(window as unknown as { __renderer: unknown }).__renderer = {
			seekTo(t: number) {
				store.seekTo(t);
			},
			get duration() {
				return store.totalDuration;
			}
		};
	});
</script>

<svelte:head>
	<title>Map Animation — VersaTiles</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="viewer">
	<MapStage {store} />
	{#if loadError}
		<div class="message error" role="alert">Failed to load: {loadError}</div>
	{:else if !canPlay}
		<div class="message">No animation to play.</div>
	{:else if !store.isPlaying && !renderMode}
		<button type="button" class="play-overlay" onclick={onPlay} aria-label="Play animation">
			<svg viewBox="0 0 24 24" width="48" height="48" aria-hidden="true">
				<path d="M8 5v14l11-7z" fill="currentColor" />
			</svg>
		</button>
	{/if}
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		height: 100%;
		background: #0d1117;
		color: #e6edf3;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		overflow: hidden;
	}

	.viewer {
		position: relative;
		width: 100%;
		height: 100dvh;
	}

	.play-overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 96px;
		height: 96px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.55);
		border: 2px solid rgba(255, 255, 255, 0.85);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		backdrop-filter: blur(6px);
		transition:
			background 120ms ease,
			transform 120ms ease;
		padding: 0;
	}
	.play-overlay:hover {
		background: rgba(0, 0, 0, 0.75);
		transform: translate(-50%, -50%) scale(1.05);
	}
	.play-overlay svg {
		display: block;
		margin-left: 6px;
	}

	.message {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		padding: 0.6rem 1rem;
		background: rgba(0, 0, 0, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
		text-align: center;
	}
	.message.error {
		border-color: rgba(255, 80, 80, 0.5);
		color: #ffaaaa;
	}
</style>
