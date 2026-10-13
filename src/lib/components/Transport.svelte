<script lang="ts">
	/**
	 * Row on top of the timeline: play the animation, read the time, add a
	 * keyframe at the playhead, and — in the same row, see `Inspector` — edit
	 * the keyframe or move that is selected on the timeline.
	 */

	import type { AnimationStore } from '../animation.svelte';
	import Icon from './Icon.svelte';
	import Inspector from './Inspector.svelte';

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
			<Icon name="restart" />
		</button>
		<button
			type="button"
			class="primary play"
			onclick={() => store.togglePlay()}
			disabled={!canPlay}
			title="Spacebar"
		>
			<Icon name={store.isPlaying ? 'pause' : 'play'} />
			{store.isPlaying ? 'Pause' : 'Play'}
		</button>
	</div>

	<span class="time" title="Playhead / length of the animation">
		<span>{store.currentTime.toFixed(2)}s</span>
		<span class="dim"> / </span>
		<span>{store.totalDuration.toFixed(2)}s</span>
	</span>

	<button
		type="button"
		onclick={onAddKeyframe}
		title="Add a keyframe with the current view at the playhead"
	>
		<Icon name="plus" /> Keyframe
	</button>

	<Inspector {store} />

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
		gap: 0.75rem;
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
		min-width: 8rem;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: #aaa;
	}
	.dim {
		color: #555;
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
