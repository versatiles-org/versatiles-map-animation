<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';

	let { store }: { store: AnimationStore } = $props();

	// Selected-annotation lane data. Only rendered when an annotation is
	// selected; visualizes its visibility window with triangular fade tails on
	// each side. Rectangles outside the current view are clipped by the track's
	// overflow: hidden — pct() may return negative or >100 values.
	const selAnn = $derived(store.selectedAnnotation);

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
		store.isScrubbing = true;
		store.seekTo(tFromClientX(e.clientX));

		function onMove(ev: PointerEvent) {
			store.seekTo(tFromClientX(ev.clientX));
		}
		function onUp(ev: PointerEvent) {
			if (trackEl.hasPointerCapture(ev.pointerId)) trackEl.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			store.isScrubbing = false;
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	// ---------------------------------------------------------------------------
	// Selected-annotation drag handles. Each of the four time-significant points
	// in the visibility window can be dragged directly on the lane. Constraints
	// keep the four times ordered (fade-in tip ≤ visibleFrom ≤ visibleUntil ≤
	// fade-out tip) with a small minimum gap so nothing collapses past zero.
	// Dragging the bar middle translates `visibleFrom`/`visibleUntil` together
	// while leaving fade durations attached.
	// ---------------------------------------------------------------------------

	const ANN_MIN_GAP = 0.01; // seconds; keeps the inner handles distinguishable
	const round2 = (v: number) => Math.round(v * 100) / 100;

	type FadeHandle = 'fadeIn' | 'visibleFrom' | 'visibleUntil' | 'fadeOut';

	function startAnnHandleDrag(e: PointerEvent, kind: FadeHandle): void {
		e.stopPropagation();
		e.preventDefault();
		const idx = store.selectedAnnotationIndex;
		if (idx === null) return;
		const handle = e.target as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		store.pause();
		store.isScrubbing = true; // lifts the edit-mode floor — real opacity preview

		function onMove(ev: PointerEvent) {
			const ann = store.selectedAnnotation;
			if (!ann || idx === null) return;
			const t = Math.max(0, tFromClientX(ev.clientX));
			const vFrom = ann.visibleFrom;
			const vUntil = ann.visibleUntil;
			const fIn = Math.max(0, ann.fadeIn ?? 0);
			const fOut = Math.max(0, ann.fadeOut ?? 0);

			if (kind === 'fadeIn' && vFrom !== undefined) {
				// Outer-left tip = visibleFrom - fadeIn → fadeIn = vFrom - tip.
				// Clamp tip ≤ vFrom (no negative fade) and tip ≥ 0 (no negative time).
				const tip = Math.min(vFrom, Math.max(0, t));
				store.updateAnnotation(idx, { fadeIn: round2(vFrom - tip) });
			} else if (kind === 'visibleFrom' && vFrom !== undefined) {
				// Inner-left translates visibleFrom; fadeIn stays the same so the
				// outer tip moves with it. Clamp so the tip doesn't go negative
				// and visibleFrom stays below visibleUntil.
				const max = vUntil !== undefined ? vUntil - ANN_MIN_GAP : Number.POSITIVE_INFINITY;
				const min = fIn; // visibleFrom - fadeIn ≥ 0 ⇒ visibleFrom ≥ fadeIn
				store.updateAnnotation(idx, {
					visibleFrom: round2(Math.max(min, Math.min(max, t)))
				});
			} else if (kind === 'visibleUntil' && vUntil !== undefined) {
				const min = vFrom !== undefined ? vFrom + ANN_MIN_GAP : 0;
				store.updateAnnotation(idx, {
					visibleUntil: round2(Math.max(min, t))
				});
			} else if (kind === 'fadeOut' && vUntil !== undefined) {
				// Outer-right tip = visibleUntil + fadeOut → fadeOut = tip - vUntil.
				const tip = Math.max(vUntil, t);
				store.updateAnnotation(idx, { fadeOut: round2(tip - vUntil) });
			}
			// `fOut` participates only in the outer-right branch's bookkeeping;
			// other branches don't read it. Reference it to keep TS quiet.
			void fOut;
		}
		function onUp(ev: PointerEvent) {
			handle.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			store.isScrubbing = false;
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	function startAnnBarDrag(e: PointerEvent): void {
		e.stopPropagation();
		e.preventDefault();
		const idx = store.selectedAnnotationIndex;
		const ann = store.selectedAnnotation;
		if (!ann || idx === null) return;
		// Translation only makes sense when both bounds are defined; with one
		// side open-ended, "shifting the window" is ambiguous (the open side
		// stretches forever). Bail silently — the user can still drag handles.
		if (ann.visibleFrom === undefined || ann.visibleUntil === undefined) return;
		const startVFrom = ann.visibleFrom;
		const startVUntil = ann.visibleUntil;
		const fIn = Math.max(0, ann.fadeIn ?? 0);
		const startT = tFromClientX(e.clientX);
		const handle = e.target as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		store.pause();
		store.isScrubbing = true;

		function onMove(ev: PointerEvent) {
			if (idx === null) return;
			let dt = tFromClientX(ev.clientX) - startT;
			// Don't push the fade-in tip past 0 (and therefore never below 0).
			const minDt = fIn - startVFrom;
			if (dt < minDt) dt = minDt;
			store.updateAnnotation(idx, {
				visibleFrom: round2(startVFrom + dt),
				visibleUntil: round2(startVUntil + dt)
			});
		}
		function onUp(ev: PointerEvent) {
			handle.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			store.isScrubbing = false;
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
		// Dragging a keyframe re-seeks the playhead each frame, so it's a scrub
		// in disguise — flag it so the editor's edit-mode chrome bows out and
		// the user sees the real animation pose at the dragged time.
		store.isScrubbing = true;

		function onMove(ev: PointerEvent) {
			store.setKeyframeTime(index, tFromClientX(ev.clientX));
			const kf = store.keyframes[index];
			if (kf) store.currentTime = kf.t;
		}
		function onUp(ev: PointerEvent) {
			handle.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			store.isScrubbing = false;
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

		{#if selAnn}
			{@const vFrom = selAnn.visibleFrom}
			{@const vUntil = selAnn.visibleUntil}
			{@const fIn = Math.max(0, selAnn.fadeIn ?? 0)}
			{@const fOut = Math.max(0, selAnn.fadeOut ?? 0)}
			{@const trackEndT = Math.max(end, store.totalDuration)}
			{@const barL = vFrom ?? start - 1}
			{@const barR = vUntil ?? trackEndT + 1}
			{@const barDraggable = vFrom !== undefined && vUntil !== undefined}
			<div class="ann-lane">
				{#if vFrom !== undefined && fIn > 0}
					<div
						class="ann-fade-in"
						style="left: {pct(vFrom - fIn)}%; width: {pct(vFrom) -
							pct(vFrom - fIn)}%; background: {selAnn.color};"
						title="Fade in {fIn.toFixed(2)}s"
						aria-hidden="true"
					></div>
				{/if}
				<div
					class="ann-bar"
					class:draggable={barDraggable}
					style="left: {pct(barL)}%; width: {pct(barR) - pct(barL)}%; background: {selAnn.color};"
					title={barDraggable
						? `Drag to shift the visibility window (${fmt(vFrom)}s → ${fmt(vUntil)}s)`
						: vFrom !== undefined || vUntil !== undefined
							? `Visible ${vFrom !== undefined ? fmt(vFrom) + 's' : 'start'} → ${vUntil !== undefined ? fmt(vUntil) + 's' : 'end'}`
							: 'Always visible'}
					role={barDraggable ? 'slider' : 'presentation'}
					aria-label={barDraggable ? 'Shift annotation visibility window' : undefined}
					tabindex={barDraggable ? 0 : undefined}
					onpointerdown={barDraggable ? startAnnBarDrag : null}
					onkeydown={() => {}}
				></div>
				{#if vUntil !== undefined && fOut > 0}
					<div
						class="ann-fade-out"
						style="left: {pct(vUntil)}%; width: {pct(vUntil + fOut) -
							pct(vUntil)}%; background: {selAnn.color};"
						title="Fade out {fOut.toFixed(2)}s"
						aria-hidden="true"
					></div>
				{/if}

				{#if vFrom !== undefined}
					<button
						type="button"
						class="ann-handle outer"
						style="left: {pct(vFrom - fIn)}%"
						onpointerdown={(e) => startAnnHandleDrag(e, 'fadeIn')}
						title="Fade in: {fIn.toFixed(2)}s — drag to adjust"
						aria-label="Adjust fade-in start"
					></button>
					<button
						type="button"
						class="ann-handle inner"
						style="left: {pct(vFrom)}%"
						onpointerdown={(e) => startAnnHandleDrag(e, 'visibleFrom')}
						title="Visible from {fmt(vFrom)}s — drag to adjust"
						aria-label="Adjust visible-from time"
					></button>
				{/if}
				{#if vUntil !== undefined}
					<button
						type="button"
						class="ann-handle inner"
						style="left: {pct(vUntil)}%"
						onpointerdown={(e) => startAnnHandleDrag(e, 'visibleUntil')}
						title="Visible until {fmt(vUntil)}s — drag to adjust"
						aria-label="Adjust visible-until time"
					></button>
					<button
						type="button"
						class="ann-handle outer"
						style="left: {pct(vUntil + fOut)}%"
						onpointerdown={(e) => startAnnHandleDrag(e, 'fadeOut')}
						title="Fade out: {fOut.toFixed(2)}s — drag to adjust"
						aria-label="Adjust fade-out end"
					></button>
				{/if}
			</div>
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

	/* Selected-annotation lane: a colored bar at the bottom of the track,
	   with triangular tails on each side for fade-in / fade-out durations,
	   and four drag handles at the four time-significant points. The lane
	   itself is non-interactive — only the bar (when both bounds are set)
	   and the handles capture pointer events. `background` on the bar/tails
	   is set per-element from the annotation's color. */
	.ann-lane {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 4px;
		height: 10px;
		pointer-events: none;
	}
	.ann-bar {
		position: absolute;
		top: 0;
		bottom: 0;
		opacity: 0.7;
		border-radius: 1px;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
		touch-action: none;
	}
	.ann-bar.draggable {
		pointer-events: auto;
		cursor: grab;
	}
	.ann-bar.draggable:active {
		cursor: grabbing;
	}
	.ann-fade-in,
	.ann-fade-out {
		position: absolute;
		top: 0;
		bottom: 0;
		opacity: 0.7;
	}
	/* Triangle: 0 height on the outside edge, full height on the inside edge. */
	.ann-fade-in {
		clip-path: polygon(0 100%, 100% 0, 100% 100%);
	}
	.ann-fade-out {
		clip-path: polygon(0 0, 100% 100%, 0 100%);
	}
	/* Drag handles. `inner` marks the visibleFrom/visibleUntil edges (where
	   full opacity starts/ends); `outer` marks the fade tips (where opacity
	   is 0). Inner is bigger and more prominent so users grab it for the
	   common "extend the bar" interaction. Outer is a small dot stuck to the
	   tip — visible even at fade=0 because it sits on top of the inner. */
	.ann-handle {
		position: absolute;
		top: 50%;
		padding: 0;
		background: #fff;
		border: 1px solid rgba(0, 0, 0, 0.6);
		cursor: ew-resize;
		touch-action: none;
		pointer-events: auto;
		transform: translate(-50%, -50%);
	}
	.ann-handle.inner {
		width: 4px;
		height: 16px;
		border-radius: 1px;
		z-index: 2;
	}
	.ann-handle.outer {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		z-index: 3;
		/* Sit at the bottom of the lane, where the fade triangle's "0 height"
		   tip actually is — the centered position floated above empty space
		   and looked disconnected from the triangle it controls. */
		top: 100%;
	}
	.ann-handle:hover {
		background: #4a9eff;
		border-color: #fff;
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
