<script lang="ts">
	/**
	 * Row on top of the timeline: play the animation, read the time, and put
	 * new things onto the timeline at the playhead.
	 */

	import type { AnimationStore } from '../animation.svelte';

	let {
		store,
		isFit,
		onFit
	}: {
		store: AnimationStore;
		/** The timeline already shows the full duration. */
		isFit: boolean;
		onFit: () => void;
	} = $props();

	function onAddKeyframe() {
		store.addKeyframeFromCamera(store.liveCamera);
	}
	function onAddMarker() {
		const cam = store.liveCamera;
		// Thin annotation: only position + (empty) label. Icon, colour, and
		// every other style field stay undefined so the renderer pulls them
		// from `defaultAnnotation` — change a default later and the marker
		// follows. The hardcoded baselines live in `ANNOTATION_FIELD_DEFAULTS`.
		store.addAnnotation({ lng: cam.lng, lat: cam.lat, label: '' });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.code !== 'Space') return;
		const target = e.target as HTMLElement;
		if (target.matches('input, textarea, [contenteditable="true"]')) return;
		e.preventDefault();
		store.togglePlay();
	}

	$effect(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	const hasKeyframes = $derived(store.keyframes.length > 0);
	const canPlay = $derived(store.keyframes.length >= 2);
</script>

<div class="transport">
	<div class="group" role="group" aria-label="Playback">
		<button
			type="button"
			onclick={() => store.restart()}
			disabled={!hasKeyframes}
			aria-label="Restart"
			title="Back to the start"
		>
			⏮
		</button>
		<button
			type="button"
			class="primary play"
			onclick={() => store.togglePlay()}
			disabled={!canPlay}
			title="Spacebar"
		>
			{store.isPlaying ? '⏸ Pause' : '▶ Play'}
		</button>
	</div>

	<span class="time" title="Playhead / length of the animation">
		<span>{store.currentTime.toFixed(2)}s</span>
		<span class="dim"> / </span>
		<span>{store.totalDuration.toFixed(2)}s</span>
	</span>

	<div class="group" role="group" aria-label="Add">
		<button
			type="button"
			onclick={onAddKeyframe}
			title="Add a keyframe with the current view at the playhead"
		>
			+ Keyframe
		</button>
		<button type="button" onclick={onAddMarker} title="Pin a marker at the current map center">
			+ Marker
		</button>
	</div>

	{#if !hasKeyframes}
		<span class="hint">add a keyframe to begin</span>
	{/if}

	<span class="spacer"></span>

	<button
		type="button"
		class="fit"
		onclick={onFit}
		disabled={isFit}
		title="Fit timeline to full duration"
	>
		Fit
	</button>
</div>

<style>
	.transport {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}
	.group {
		display: flex;
		gap: 0.25rem;
	}
	.spacer {
		flex: 1 1 auto;
	}
	.time {
		/* Wide enough for "123.45s / 123.45s", so the buttons after it stay put. */
		min-width: 9.5rem;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: #aaa;
	}
	.dim {
		color: #555;
	}
	.hint {
		font-size: 12px;
		color: #666;
	}
	button {
		padding: 0.4rem 0.7rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;

		&:hover:not(:disabled) {
			background: rgba(255, 255, 255, 0.12);
			border-color: #4a9eff;
		}
		&:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}
		&.primary {
			background: #4a9eff;
			border-color: #4a9eff;
			color: #fff;
			font-weight: 600;

			&:hover:not(:disabled) {
				background: #5fa9ff;
			}
		}
		/* "Play" and "Pause" swap in place; keep the width. */
		&.play {
			min-width: 5.2rem;
		}
		&.fit {
			padding: 0.2rem 0.5rem;
			font-size: 11px;
		}
	}
</style>
