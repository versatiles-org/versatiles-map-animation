<script lang="ts">
	import { onMount } from 'svelte';
	import { AnimationStore } from '$lib/animation.svelte';
	import { clearUrlHash, readAnimationFromUrl, writeAnimationToUrl } from '$lib/url_state';
	import MapStage from '$lib/components/MapStage.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CameraReadout from '$lib/components/CameraReadout.svelte';

	const store = new AnimationStore();
	let urlError = $state<string | null>(null);

	onMount(() => {
		try {
			const fromUrl = readAnimationFromUrl();
			if (fromUrl) store.loadFromAnimation(fromUrl);
		} catch (err) {
			urlError = err instanceof Error ? err.message : 'Could not load shared link.';
			clearUrlHash();
		}
	});

	let urlTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		void store.keyframes;
		void store.style;
		if (urlTimer) clearTimeout(urlTimer);
		urlTimer = setTimeout(() => {
			writeAnimationToUrl(store.toAnimation());
		}, 250);
		return () => {
			if (urlTimer) clearTimeout(urlTimer);
		};
	});
</script>

<svelte:head>
	<title>Map Animation Prototype – VersaTiles</title>
	<meta
		name="description"
		content="Compose camera animations on a VersaTiles map using keyframes."
	/>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="page">
	<header class="header">
		<h1>Map Animation</h1>
		<p class="lede">Prototype — drop keyframes on a map, hit play.</p>
	</header>

	{#if urlError}
		<div class="banner" role="alert">
			<span>Couldn’t load shared link: {urlError}</span>
			<button type="button" onclick={() => (urlError = null)} aria-label="Dismiss">✕</button>
		</div>
	{/if}

	<div class="map-area">
		<MapStage {store} />
		<div class="readout-overlay">
			<CameraReadout {store} />
		</div>
		{#if store.keyframes.length === 0}
			<div class="empty-overlay">
				Compose a shot, then click <strong>+ Add KF</strong>. Or try
				<strong>★ Load example</strong>.
			</div>
		{/if}
	</div>

	<Toolbar {store} />
	<Timeline {store} />
</main>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: #0d1117;
		color: #e6edf3;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
	}

	.page {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 80rem;
		margin: 0 auto;
		padding: 1rem;
		box-sizing: border-box;
		color-scheme: dark;
	}

	.header {
		flex: 0 0 auto;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	.lede {
		margin: 0.2rem 0 0;
		color: #888;
		font-size: 0.9rem;
	}

	.banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		background: rgba(255, 80, 80, 0.15);
		border: 1px solid rgba(255, 80, 80, 0.4);
		border-radius: 4px;
		color: #ffaaaa;
		font-size: 13px;
	}
	.banner button {
		background: transparent;
		border: none;
		color: #ffaaaa;
		cursor: pointer;
		font-size: 14px;
		padding: 0.1rem 0.4rem;
	}
	.banner button:hover {
		color: #fff;
	}

	.map-area {
		position: relative;
		height: 64vh;
		min-height: 360px;
		border: 1px solid #222;
		border-radius: 4px;
		overflow: hidden;
	}
	.readout-overlay {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 1;
		max-width: calc(100% - 1rem);
	}
	.empty-overlay {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.6rem 1rem;
		background: rgba(0, 0, 0, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
		pointer-events: none;
		backdrop-filter: blur(6px);
		max-width: 90%;
		text-align: center;
	}
</style>
