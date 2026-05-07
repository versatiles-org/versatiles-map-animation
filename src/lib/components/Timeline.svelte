<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';

	let { store }: { store: AnimationStore } = $props();

	let trackEl: HTMLDivElement;

	const visualDuration = $derived(Math.max(store.totalDuration, 1));

	function pct(t: number): number {
		return (t / visualDuration) * 100;
	}

	function tFromClientX(clientX: number): number {
		const rect = trackEl.getBoundingClientRect();
		const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
		return (x / rect.width) * visualDuration;
	}

	function startScrub(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('.marker')) return;
		e.preventDefault();
		trackEl.setPointerCapture(e.pointerId);
		store.pause();
		store.seekTo(tFromClientX(e.clientX));

		function onMove(ev: PointerEvent) {
			store.seekTo(tFromClientX(ev.clientX));
		}
		function onUp(ev: PointerEvent) {
			if (trackEl.hasPointerCapture(ev.pointerId)) trackEl.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	function startDragMarker(e: PointerEvent, index: number) {
		e.stopPropagation();
		e.preventDefault();
		const handle = e.target as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		store.selectAt(index);
		store.pause();
		let moved = false;

		function onMove(ev: PointerEvent) {
			moved = true;
			store.setKeyframeTime(index, tFromClientX(ev.clientX));
			const kf = store.keyframes[index];
			if (kf) store.currentTime = kf.t;
		}

		function onUp(ev: PointerEvent) {
			handle.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			void moved;
		}

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	function fmt(t: number): string {
		return t.toFixed(2);
	}

	const tickCount = $derived(Math.floor(visualDuration) + 1);
</script>

<div class="timeline">
	<div
		bind:this={trackEl}
		class="track"
		role="slider"
		tabindex="0"
		aria-label="Animation timeline"
		aria-valuemin={0}
		aria-valuemax={visualDuration}
		aria-valuenow={store.currentTime}
		onpointerdown={startScrub}
		onkeydown={() => {}}
	>
		{#each Array(tickCount) as _, i (i)}
			<div class="tick" style="left: {pct(i)}%">
				<span class="tick-label">{i}s</span>
			</div>
		{/each}

		{#each store.keyframes as kf, i (i)}
			<button
				type="button"
				class="marker"
				class:selected={store.selectedIndex === i}
				style="left: {pct(kf.t)}%"
				onpointerdown={(e) => startDragMarker(e, i)}
				title="Keyframe {i + 1} at {fmt(kf.t)}s"
				aria-label="Keyframe {i + 1}"
			>
				<span class="diamond"></span>
			</button>
		{/each}

		<div class="playhead" style="left: {pct(store.currentTime)}%" aria-hidden="true">
			<div class="playhead-line"></div>
			<div class="playhead-handle" title="Playhead at {fmt(store.currentTime)}s"></div>
		</div>
	</div>

	<div class="time-readout">
		<span>{fmt(store.currentTime)}s</span>
		<span class="dim"> / </span>
		<span>{fmt(store.totalDuration)}s</span>
		{#if store.keyframes.length === 0}
			<span class="hint">— add a keyframe to begin</span>
		{/if}
	</div>
</div>

<style>
	.timeline {
		user-select: none;
		width: 100%;
	}
	.track {
		position: relative;
		height: 64px;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 4px;
		cursor: crosshair;
		overflow: hidden;
	}
	.track:focus {
		outline: 1px solid #4a9eff;
		outline-offset: -1px;
	}
	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgba(255, 255, 255, 0.08);
		pointer-events: none;
	}
	.tick-label {
		position: absolute;
		top: 4px;
		left: 4px;
		font-size: 10px;
		color: #888;
		font-family: ui-monospace, monospace;
	}
	.marker {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 20px;
		height: 20px;
		background: transparent;
		border: none;
		cursor: ew-resize;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.diamond {
		display: block;
		width: 14px;
		height: 14px;
		background: #4a9eff;
		transform: rotate(45deg);
		border: 1px solid #fff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
	}
	.marker.selected .diamond {
		background: #ffd24a;
	}
	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 12px;
		margin-left: -6px;
		pointer-events: none;
	}
	.playhead-line {
		position: absolute;
		left: 5px;
		top: 0;
		bottom: 0;
		width: 2px;
		background: #ff4a4a;
		pointer-events: none;
	}
	.playhead-handle {
		position: absolute;
		top: -4px;
		left: 50%;
		transform: translateX(-50%);
		width: 14px;
		height: 14px;
		background: #ff4a4a;
		border: 1px solid #fff;
		border-radius: 50%;
		pointer-events: none;
	}
	.track:active {
		cursor: ew-resize;
	}
	.time-readout {
		margin-top: 0.5rem;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #aaa;
		text-align: right;
	}
	.dim {
		color: #555;
	}
	.hint {
		margin-left: 0.5rem;
		color: #666;
	}
</style>
