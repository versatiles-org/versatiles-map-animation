<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';

	let { store }: { store: AnimationStore } = $props();

	let trackEl: HTMLDivElement;
	let panbarEl: HTMLDivElement;

	const MIN_SPAN = 0.1;
	const MAX_SPAN = 86400; // 24h, just to prevent absurd extremes
	const MIN_THUMB_PCT = 4;

	// View window state. `null` span means auto-fit to contentDuration; the
	// moment the user zooms or pans, it becomes a concrete number. start and
	// span are otherwise unbounded above — the user may pan/zoom past the last
	// keyframe to set up new shots there.
	let viewStart = $state(0);
	let viewSpan = $state<number | null>(null);

	const contentDuration = $derived(Math.max(store.totalDuration, 1));
	const rawSpan = $derived(viewSpan ?? contentDuration);
	const span = $derived(Math.max(MIN_SPAN, Math.min(MAX_SPAN, rawSpan)));
	const start = $derived(Math.max(0, viewStart));
	const end = $derived(start + span);
	// The panbar reflects everything that's currently in scope: animation
	// content, the playhead, and the right edge of the current view. As the
	// user pans/scrubs past the last keyframe, the panbar auto-extends.
	const panbarMax = $derived(Math.max(store.totalDuration, store.currentTime, end, 1));

	function pct(t: number): number {
		return ((t - start) / span) * 100;
	}

	function tFromClientX(clientX: number): number {
		const rect = trackEl.getBoundingClientRect();
		const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
		return start + (x / rect.width) * span;
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

		function onMove(ev: PointerEvent) {
			store.setKeyframeTime(index, tFromClientX(ev.clientX));
			const kf = store.keyframes[index];
			if (kf) store.currentTime = kf.t;
		}
		function onUp(ev: PointerEvent) {
			handle.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	function zoomAt(factor: number, anchorClientX: number) {
		const tAnchor = tFromClientX(anchorClientX);
		const newSpan = Math.max(MIN_SPAN, Math.min(MAX_SPAN, span * factor));
		if (newSpan === span) return;
		const ratio = newSpan / span;
		viewSpan = newSpan;
		viewStart = tAnchor - (tAnchor - start) * ratio;
	}

	function panBy(dT: number) {
		viewSpan = span;
		viewStart = start + dT;
	}

	function onWheel(e: WheelEvent) {
		if (e.deltaX === 0 && e.deltaY === 0) return;
		e.preventDefault();
		// Mac trackpad pinch arrives as a wheel event with ctrlKey synthesized.
		// Treat that the same as an explicit Ctrl/Cmd+wheel.
		if (e.ctrlKey || e.metaKey) {
			zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX);
			return;
		}
		// Plain wheel: vertical → zoom around cursor, horizontal → pan.
		if (e.deltaY !== 0) zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX);
		if (e.deltaX !== 0) {
			const rect = trackEl.getBoundingClientRect();
			panBy((e.deltaX / rect.width) * span);
		}
	}

	function startPanbarDrag(e: PointerEvent, mode: 'pan' | 'left' | 'right') {
		e.preventDefault();
		e.stopPropagation();
		panbarEl.setPointerCapture(e.pointerId);
		const startStart = start;
		const startEnd = end;
		const rect = panbarEl.getBoundingClientRect();
		// Capture the panbar's time scale at drag start so the cursor-to-time
		// mapping stays stable even when panbarMax grows during the drag (which
		// happens when the user drags past the current end).
		const initialMax = panbarMax;
		const startX = e.clientX;

		function onMove(ev: PointerEvent) {
			const dT = ((ev.clientX - startX) / rect.width) * initialMax;
			if (mode === 'pan') {
				viewSpan = startEnd - startStart;
				viewStart = startStart + dT;
			} else if (mode === 'left') {
				const newStart = Math.min(startEnd - MIN_SPAN, Math.max(0, startStart + dT));
				viewSpan = startEnd - newStart;
				viewStart = newStart;
			} else {
				const newEnd = Math.max(
					startStart + MIN_SPAN,
					Math.min(MAX_SPAN + startStart, startEnd + dT)
				);
				viewSpan = newEnd - startStart;
				viewStart = startStart;
			}
		}
		function onUp(ev: PointerEvent) {
			if (panbarEl.hasPointerCapture(ev.pointerId)) panbarEl.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	function onPanbarPointerDown(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('.thumb-handle-left')) return startPanbarDrag(e, 'left');
		if (target.closest('.thumb-handle-right')) return startPanbarDrag(e, 'right');
		if (target.closest('.thumb-body')) return startPanbarDrag(e, 'pan');
		// Click in gutter: center the thumb at the click position.
		e.preventDefault();
		const rect = panbarEl.getBoundingClientRect();
		const clickT = ((e.clientX - rect.left) / rect.width) * panbarMax;
		viewSpan = span;
		viewStart = clickT - span / 2;
	}

	function fitView() {
		viewStart = 0;
		viewSpan = null;
	}

	const NICE_STEPS = [
		0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1800, 3600
	] as const;
	const TARGET_TICK_COUNT = 8;

	const tickStep = $derived.by(() => {
		const target = span / TARGET_TICK_COUNT;
		return NICE_STEPS.find((s) => s >= target) ?? NICE_STEPS[NICE_STEPS.length - 1];
	});
	const ticks = $derived.by(() => {
		const out: number[] = [];
		const first = Math.ceil(start / tickStep) * tickStep;
		const last = end + 1e-6;
		for (let t = first; t <= last; t += tickStep) out.push(t);
		return out;
	});
	function fmtTick(t: number): string {
		return tickStep < 1 ? t.toFixed(1) + 's' : Math.round(t) + 's';
	}

	const thumbLeftPct = $derived((start / panbarMax) * 100);
	const thumbWidthPct = $derived(Math.max(MIN_THUMB_PCT, (span / panbarMax) * 100));
	const isFit = $derived(viewSpan === null);
	// Visible position of the "end of content" marker on the track (may be off-screen).
	const contentEndPct = $derived(((store.totalDuration - start) / span) * 100);
	const showContentEnd = $derived(
		store.totalDuration > 0 &&
			end > store.totalDuration &&
			contentEndPct >= 0 &&
			contentEndPct <= 100
	);

	function fmt(t: number): string {
		return t.toFixed(2);
	}
</script>

<div class="timeline">
	<div
		bind:this={trackEl}
		class="track"
		role="slider"
		tabindex="0"
		aria-label="Animation timeline"
		aria-valuemin={0}
		aria-valuemax={panbarMax}
		aria-valuenow={store.currentTime}
		onpointerdown={startScrub}
		onwheel={onWheel}
		onkeydown={() => {}}
	>
		{#each ticks as t (t)}
			<div class="tick" style="left: {pct(t)}%">
				<span class="tick-label">{fmtTick(t)}</span>
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

		{#if showContentEnd}
			<div
				class="content-end"
				style="left: {contentEndPct}%"
				aria-hidden="true"
				title="End of last keyframe ({fmt(store.totalDuration)}s)"
			></div>
		{/if}

		<div class="playhead" style="left: {pct(store.currentTime)}%" aria-hidden="true">
			<div class="playhead-line"></div>
			<div class="playhead-handle" title="Playhead at {fmt(store.currentTime)}s"></div>
		</div>
	</div>

	<div
		bind:this={panbarEl}
		class="panbar"
		role="scrollbar"
		tabindex="-1"
		aria-controls="timeline-track"
		aria-orientation="horizontal"
		aria-valuemin={0}
		aria-valuemax={panbarMax}
		aria-valuenow={start}
		onpointerdown={onPanbarPointerDown}
	>
		<div
			class="thumb"
			style="left: {thumbLeftPct}%; width: {thumbWidthPct}%"
			title="Drag to pan, drag edges to zoom"
		>
			<div class="thumb-handle thumb-handle-left" aria-hidden="true"></div>
			<div class="thumb-body" aria-hidden="true"></div>
			<div class="thumb-handle thumb-handle-right" aria-hidden="true"></div>
		</div>
	</div>

	<div class="time-readout">
		<button
			type="button"
			class="fit"
			onclick={fitView}
			disabled={isFit}
			title="Fit timeline to full duration"
		>
			Fit
		</button>
		<span class="spacer"></span>
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
		touch-action: none;
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
		white-space: nowrap;
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
	.content-end {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: repeating-linear-gradient(
			to bottom,
			rgba(255, 255, 255, 0.45) 0,
			rgba(255, 255, 255, 0.45) 4px,
			transparent 4px,
			transparent 8px
		);
		pointer-events: none;
	}

	.panbar {
		position: relative;
		height: 12px;
		margin-top: 4px;
		background: #111;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		cursor: pointer;
		touch-action: none;
	}
	.thumb {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: stretch;
		min-width: 16px;
	}
	.thumb-body {
		flex: 1 1 auto;
		background: rgba(74, 158, 255, 0.55);
		border-top: 1px solid rgba(255, 255, 255, 0.25);
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		cursor: grab;
	}
	.thumb-body:active {
		cursor: grabbing;
		background: rgba(74, 158, 255, 0.75);
	}
	.thumb-handle {
		flex: 0 0 6px;
		background: #4a9eff;
		cursor: ew-resize;
	}
	.thumb-handle:hover {
		background: #6fb1ff;
	}
	.thumb-handle-left {
		border-radius: 4px 0 0 4px;
	}
	.thumb-handle-right {
		border-radius: 0 4px 4px 0;
	}

	.time-readout {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.4rem;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #aaa;
	}
	.spacer {
		flex: 1 1 auto;
	}
	.fit {
		padding: 0.2rem 0.5rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 11px;
		font-family: inherit;
		cursor: pointer;
	}
	.fit:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
		border-color: #4a9eff;
	}
	.fit:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.dim {
		color: #555;
	}
	.hint {
		margin-left: 0.5rem;
		color: #666;
	}
</style>
