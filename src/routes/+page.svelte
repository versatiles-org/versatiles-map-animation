<script lang="ts">
	import Icon from '#lib/components/Icon.svelte';
	import { AnimationStore } from '#lib/animation.svelte.ts';
	import { History } from '#lib/history.svelte.ts';
	import { aspectRatioValue, snapTime, type Animation } from '#lib/types.ts';
	import {
		clearUrlHash,
		readAnimationFromStorage,
		readAnimationFromUrl,
		writeAnimationToStorage,
		writeAnimationToUrl
	} from '#lib/url_state/index.ts';
	import MapStage from '#lib/components/MapStage.svelte';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import Timeline from '#lib/components/Timeline.svelte';
	import TopBar from '#lib/components/TopBar.svelte';

	const store = new AnimationStore();
	let urlError = $state<string | null>(null);
	// Edit-mode (always on in the editor; off in /view + render) keeps hidden
	// annotations faintly visible at 20% opacity so the user can spot and
	// click markers that are outside their visibility window.
	const EDIT_MODE = true;

	// Composition aspect ratio drives the editor's `.map-area` CSS — see
	// `SceneSettings` for the picker. The numeric form is for `min(...)`
	// width math; the slash-separated form for the CSS `aspect-ratio` property.
	const aspectNum = $derived(aspectRatioValue(store.aspectRatio));
	const aspectCss = $derived(store.aspectRatio.replace(':', ' / '));

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

	// Undo and redo. A change becomes a step once the animation has been left
	// alone for a moment, so dragging a keyframe or a slider is one step and
	// not one per pixel.
	const history = new History<Animation>();
	history.record(store.toAnimation());
	const HISTORY_PAUSE_MS = 400;
	let unrecorded: Animation | null = null;
	let historyTimer: ReturnType<typeof setTimeout> | undefined;
	function recordStep() {
		if (historyTimer) clearTimeout(historyTimer);
		if (unrecorded) history.record(unrecorded);
		unrecorded = null;
	}
	function undo() {
		// What was changed just now is a step too, and the one to take back.
		recordStep();
		const anim = history.undo();
		if (anim) store.restoreAnimation(anim);
	}
	function redo() {
		recordStep();
		const anim = history.redo();
		if (anim) store.restoreAnimation(anim);
	}

	let urlTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		// Serialising here (not inside the timer) is what makes the effect track
		// every field that is part of the saved animation, so a newly added
		// field can't be forgotten.
		const anim = store.toAnimation();
		if (urlTimer) clearTimeout(urlTimer);
		urlTimer = setTimeout(() => {
			writeAnimationToUrl(anim);
			writeAnimationToStorage(anim);
		}, 250);
		unrecorded = anim;
		if (historyTimer) clearTimeout(historyTimer);
		historyTimer = setTimeout(recordStep, HISTORY_PAUSE_MS);
		return () => {
			if (urlTimer) clearTimeout(urlTimer);
		};
	});

	/** Is the key meant for a field the user is typing in? */
	function isTyping(e: KeyboardEvent): boolean {
		const target = e.target as HTMLElement | null;
		return (
			target?.matches(
				'input:not([type="range"], [type="checkbox"], [type="radio"], [type="color"]), textarea, select, [contenteditable="true"]'
			) ?? false
		);
	}
	/** Seconds the playhead moves per press of an arrow key, and with Shift held. */
	const STEP = 0.1;
	const STEP_LARGE = 1;
	function handleKeydown(e: KeyboardEvent) {
		if (isTyping(e)) return;
		const key = e.key.toLowerCase();
		if (e.metaKey || e.ctrlKey || e.altKey) {
			if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === 'z' || key === 'y')) {
				e.preventDefault();
				if (key === 'y' || e.shiftKey) redo();
				else undo();
			}
			return;
		}
		switch (e.key) {
			case 'Delete':
			case 'Backspace':
				// The keyframe first: it is what the row above the timeline shows.
				if (store.selectedIndex !== null) store.deleteAt(store.selectedIndex);
				else if (store.selectedAnnotationIndex !== null) {
					store.deleteAnnotation(store.selectedAnnotationIndex);
				} else return;
				break;
			case 'Escape':
				if (store.selectedIndex !== null || store.selectedMoveStart !== null) {
					store.clearSelection();
					store.clearMoveSelection();
				} else if (store.selectedAnnotationIndex !== null) store.clearAnnotationSelection();
				else return;
				break;
			case 'ArrowLeft':
			case 'ArrowRight': {
				// A slider or a menu has its own use for the arrows, and on the map they pan.
				const target = e.target as HTMLElement | null;
				if (target?.closest('input, select, .maplibregl-map')) return;
				const step = (e.shiftKey ? STEP_LARGE : STEP) * (e.key === 'ArrowLeft' ? -1 : 1);
				store.pause();
				store.seekTo(snapTime(store.currentTime + step));
				break;
			}
			default:
				return;
		}
		e.preventDefault();
	}
</script>

<svelte:head>
	<title>Map Animator Prototype – VersaTiles</title>
	<meta
		name="description"
		content="Compose camera animations on a VersaTiles map using keyframes."
	/>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main class="page">
	{#if urlError}
		<div class="banner" role="alert">
			<span>Couldn’t load shared link: {urlError}</span>
			<button type="button" onclick={() => (urlError = null)} aria-label="Dismiss"
				><Icon name="close" /></button
			>
		</div>
	{/if}

	<TopBar {store} canUndo={history.canUndo} canRedo={history.canRedo} onUndo={undo} onRedo={redo} />

	<div class="body">
		<Sidebar {store} />

		<div class="main">
			<div class="stage-wrap">
				<div class="map-area" style="--map-aspect: {aspectNum}; --map-aspect-css: {aspectCss};">
					<MapStage {store} editMode={EDIT_MODE} />
					{#if store.keyframes.length === 0}
						<div class="empty-overlay">
							Compose a shot, then click <strong>+ Keyframe</strong> above the timeline. Or start
							from one in the <strong>Examples</strong> menu.
						</div>
					{/if}
				</div>
			</div>
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

		button {
			background: transparent;
			border: none;
			color: #ffaaaa;
			cursor: pointer;
			font-size: 14px;
			padding: 0.1rem 0.4rem;

			&:hover {
				color: #fff;
			}
		}
	}

	/* Middle of the viewport: sidebar on the left, main column (the
	   map) on the right. Timeline sits below this row, full width. */
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
		/* Largest box of the chosen composition aspect that fits the stage. */
		width: min(100cqw, calc(100cqh * var(--map-aspect, 1.7778)));
		aspect-ratio: var(--map-aspect-css, 16 / 9);
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
