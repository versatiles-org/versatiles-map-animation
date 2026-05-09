<script lang="ts">
	import { AnimationStore } from '$lib/animation.svelte';
	import {
		clearUrlHash,
		readAnimationFromStorage,
		readAnimationFromUrl,
		writeAnimationToStorage,
		writeAnimationToUrl
	} from '$lib/url_state';
	import MapStage from '$lib/components/MapStage.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';

	const store = new AnimationStore();
	let urlError = $state<string | null>(null);
	// Edit-mode (always on in the editor; off in /view + render) keeps hidden
	// annotations faintly visible at 20% opacity so the user can spot and
	// click markers that are outside their visibility window.
	const EDIT_MODE = true;

	// Load before children mount so MapStage sees the correct style/terrain on
	// first build. Precedence: URL hash (shared link) > localStorage (last
	// session) > empty. URL wins so opening a share link in an existing tab
	// always shows what was shared, not what the user happened to be editing.
	try {
		const fromUrl = readAnimationFromUrl();
		if (fromUrl) {
			store.loadFromAnimation(fromUrl);
		} else {
			const fromStorage = readAnimationFromStorage();
			if (fromStorage) store.loadFromAnimation(fromStorage);
		}
	} catch (err) {
		urlError = err instanceof Error ? err.message : 'Could not load shared link.';
		clearUrlHash();
	}

	let urlTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		void store.keyframes;
		void store.annotations;
		void store.annotationScale;
		void store.style;
		void store.labels;
		void store.terrain;
		if (urlTimer) clearTimeout(urlTimer);
		urlTimer = setTimeout(() => {
			const anim = store.toAnimation();
			writeAnimationToUrl(anim);
			writeAnimationToStorage(anim);
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
	{#if urlError}
		<div class="banner" role="alert">
			<span>Couldn’t load shared link: {urlError}</span>
			<button type="button" onclick={() => (urlError = null)} aria-label="Dismiss">✕</button>
		</div>
	{/if}

	<div class="body">
		<Sidebar {store} />

		<div class="main">
			<div class="stage-wrap">
				<div class="map-area">
					<MapStage {store} editMode={EDIT_MODE} />
					{#if store.keyframes.length === 0}
						<div class="empty-overlay">
							Compose a shot, then click <strong>+ Add</strong> in the Keyframe group. Or open the
							<strong>⋯</strong>
							menu and pick <strong>Load example</strong>.
						</div>
					{/if}
				</div>
			</div>
			<Toolbar {store} />
		</div>
	</div>

	<Timeline {store} />
</main>

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

	.page {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		height: 100dvh;
		padding: 1rem;
		box-sizing: border-box;
		color-scheme: dark;
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

	/* Top half of the viewport: sidebar on the left, main column (map +
	   toolbar) on the right. Timeline sits below this row, full width. */
	.body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		gap: 0.75rem;
	}
	.main {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.stage-wrap {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		container-type: size;
	}
	.map-area {
		position: relative;
		box-sizing: border-box;
		width: min(100cqw, calc(100cqh * 16 / 9));
		aspect-ratio: 16 / 9;
		border: 1px solid #222;
		border-radius: 4px;
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
