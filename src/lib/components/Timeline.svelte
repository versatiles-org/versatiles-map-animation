<script lang="ts">
	import { resolveAnnotation, type AnimationStore } from '../animation.svelte';
	import { MOVE_KIND_LABELS, type Move } from '../moves';
	import { SPEED_FAST, SPEED_VERY_FAST, speedProfile } from '../speed';
	import { departureOf, holdOf, snapTime, TIME_RESOLUTION } from '../types';
	import PathIcon from './PathIcon.svelte';
	import Transport from './Transport.svelte';

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

	/**
	 * Pointer-drag boilerplate: captures the pointer on `el`, registers
	 * `pointermove` + `pointerup` + `pointercancel` on window, and on release
	 * (or cancel) releases capture, removes all three listeners, and runs the
	 * optional `onUp`. Every drag handler in this file is built on top of this.
	 */
	function capturePointer(
		el: HTMLElement,
		e: PointerEvent,
		cb: { onMove: (ev: PointerEvent) => void; onUp?: (ev: PointerEvent) => void }
	): void {
		el.setPointerCapture(e.pointerId);
		function up(ev: PointerEvent) {
			if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
			window.removeEventListener('pointermove', cb.onMove);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
			cb.onUp?.(ev);
		}
		window.addEventListener('pointermove', cb.onMove);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
	}

	function startScrub(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('.marker, .hold, .hold-handle')) return;
		// A press on a move's band selects that move; anywhere else on the
		// track drops the selection. Either way it also scrubs.
		const band = target.closest<HTMLElement>('.move');
		if (band) store.selectMove(Number(band.dataset.start));
		else store.clearMoveSelection();
		e.preventDefault();
		store.pause();
		store.isScrubbing = true;
		store.seekTo(tFromClientX(e.clientX));
		capturePointer(trackEl, e, {
			onMove: (ev) => store.seekTo(tFromClientX(ev.clientX)),
			onUp: () => {
				store.isScrubbing = false;
			}
		});
	}

	// ---------------------------------------------------------------------------
	// Selected-annotation drag handles. Each of the four time-significant points
	// in the visibility window can be dragged directly on the lane. Constraints
	// keep the four times ordered (fade-in tip ≤ visibleFrom ≤ visibleUntil ≤
	// fade-out tip) with a small minimum gap so nothing collapses past zero.
	// Dragging the bar middle translates `visibleFrom`/`visibleUntil` together
	// while leaving fade durations attached.
	// ---------------------------------------------------------------------------

	const ANN_MIN_GAP = TIME_RESOLUTION; // keeps the inner handles distinguishable
	const round2 = snapTime;

	type FadeHandle = 'fadeIn' | 'visibleFrom' | 'visibleUntil' | 'fadeOut';

	function startAnnHandleDrag(e: PointerEvent, kind: FadeHandle): void {
		e.stopPropagation();
		e.preventDefault();
		const idx = store.selectedAnnotationIndex;
		if (idx === null) return;
		store.pause();
		store.isScrubbing = true; // lifts the edit-mode floor — real opacity preview
		capturePointer(e.target as HTMLElement, e, {
			onMove: (ev) => {
				const ann = store.selectedAnnotation;
				if (!ann) return;
				const t = Math.max(0, tFromClientX(ev.clientX));
				const vFrom = ann.visibleFrom;
				const vUntil = ann.visibleUntil;
				const fIn = Math.max(0, ann.fadeIn ?? 0);

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
			},
			onUp: () => {
				store.isScrubbing = false;
			}
		});
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
		store.pause();
		store.isScrubbing = true;
		capturePointer(e.target as HTMLElement, e, {
			onMove: (ev) => {
				let dt = tFromClientX(ev.clientX) - startT;
				// Don't push the fade-in tip past 0 (and therefore never below 0).
				const minDt = fIn - startVFrom;
				if (dt < minDt) dt = minDt;
				store.updateAnnotation(idx, {
					visibleFrom: round2(startVFrom + dt),
					visibleUntil: round2(startVUntil + dt)
				});
			},
			onUp: () => {
				store.isScrubbing = false;
			}
		});
	}

	/**
	 * How far the pointer has to travel before a press on a keyframe becomes
	 * a drag. A click is rarely perfectly still, and there is no undo.
	 */
	const DRAG_THRESHOLD_PX = 4;

	/**
	 * A press on a keyframe (or on the block of its hold). On an unselected
	 * keyframe it only selects — retiming one takes a second, deliberate
	 * gesture. On the selected keyframe it starts a drag once the pointer has
	 * moved `DRAG_THRESHOLD_PX`.
	 */
	function startDragMarker(e: PointerEvent, index: number) {
		e.stopPropagation();
		e.preventDefault();
		const wasSelected = store.selectedIndex === index;
		store.selectAt(index);
		store.pause();
		const kf = store.keyframes[index];
		if (!wasSelected || !kf) return;
		// Where on the keyframe it was grabbed, so it doesn't jump to the pointer.
		const grab = tFromClientX(e.clientX) - kf.t;
		let dragging = false;
		capturePointer(e.target as HTMLElement, e, {
			onMove: (ev) => {
				if (!dragging) {
					if (Math.abs(ev.clientX - e.clientX) < DRAG_THRESHOLD_PX) return;
					dragging = true;
					// Dragging a keyframe re-seeks the playhead each frame, so it's a
					// scrub in disguise — flag it so the editor's edit-mode chrome bows
					// out and the user sees the real animation pose at the dragged time.
					store.isScrubbing = true;
				}
				// Track the moving keyframe via `selectedIndex` rather than the
				// captured `index`: when the keyframe is dragged past a neighbor,
				// `setKeyframeTime` re-sorts the array and updates the selection
				// to follow it. Reading the live selection picks up the new slot
				// on the next frame.
				const i = store.selectedIndex;
				if (i === null) return;
				store.setKeyframeTime(i, tFromClientX(ev.clientX) - grab);
				const moved = store.keyframes[store.selectedIndex ?? i];
				if (moved) store.currentTime = moved.t;
			},
			onUp: () => {
				store.isScrubbing = false;
			}
		});
	}

	/**
	 * Drag the right edge of a stop: sets how long the camera rests there.
	 * Later keyframes move along (see `setKeyframeHold`), which changes the
	 * animation's length — so the view stops auto-fitting while dragging, or
	 * the timeline would rescale under the pointer. Same rules as for the
	 * keyframe itself: select first, then drag past the threshold.
	 */
	function startDragHold(e: PointerEvent, index: number) {
		e.stopPropagation();
		e.preventDefault();
		const kf = store.keyframes[index];
		if (!kf) return;
		const wasSelected = store.selectedIndex === index;
		store.selectAt(index);
		store.pause();
		if (!wasSelected) return;
		const wasAutoFit = viewSpan === null;
		// Where on the handle it was grabbed, so it doesn't jump to the pointer.
		const grab = tFromClientX(e.clientX) - departureOf(kf);
		let dragging = false;
		capturePointer(e.target as HTMLElement, e, {
			onMove: (ev) => {
				if (!dragging) {
					if (Math.abs(ev.clientX - e.clientX) < DRAG_THRESHOLD_PX) return;
					dragging = true;
					viewSpan = span;
					viewStart = start;
				}
				const current = store.keyframes[index];
				if (!current) return;
				store.setKeyframeHold(index, tFromClientX(ev.clientX) - grab - current.t);
				store.currentTime = departureOf(store.keyframes[index]);
			},
			onUp: () => {
				// Back to fitting the whole animation, now at its new length.
				if (dragging && wasAutoFit) viewSpan = null;
			}
		});
	}

	/**
	 * Where a move is too fast to follow: a colour per moment, clear below
	 * `SPEED_FAST`, orange up to `SPEED_VERY_FAST`, red beyond. Drawn as a
	 * strip along the bottom of the move's band.
	 */
	function speedColor(speed: number): string {
		if (speed < SPEED_FAST) return 'transparent';
		if (speed >= SPEED_VERY_FAST) return '#ff4d4d';
		const alpha = 0.55 + (0.45 * (speed - SPEED_FAST)) / (SPEED_VERY_FAST - SPEED_FAST);
		return `rgba(255, 165, 40, ${alpha.toFixed(2)})`;
	}
	function speedTint(move: Move): { peak: number; gradient: string | null } {
		const from = departureOf(store.keyframes[move.start]);
		const to = store.keyframes[move.end].t;
		const profile = speedProfile(store.keyframes, store.projection, from, to);
		const peak = Math.max(0, ...profile);
		if (peak < SPEED_FAST) return { peak, gradient: null };
		const stops = profile.map(
			(speed, i) => `${speedColor(speed)} ${(((i + 0.5) / profile.length) * 100).toFixed(1)}%`
		);
		return { peak, gradient: `linear-gradient(to right, ${stops.join(', ')})` };
	}
	const speedTints = $derived(store.moves.map(speedTint));
	function speedNote(peak: number): string {
		if (peak < SPEED_FAST) return '';
		const word = peak >= SPEED_VERY_FAST ? 'very fast' : 'fast';
		return ` — ${word}: up to ${peak.toFixed(1)} frame widths per second`;
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
		const startStart = start;
		const startEnd = end;
		const rect = panbarEl.getBoundingClientRect();
		// Capture the panbar's time scale at drag start so the cursor-to-time
		// mapping stays stable even when panbarMax grows during the drag (which
		// happens when the user drags past the current end).
		const initialMax = panbarMax;
		const startX = e.clientX;
		capturePointer(panbarEl, e, {
			onMove: (ev) => {
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
		});
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
	<Transport {store} {isFit} onFit={fitView} />

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

		{#each store.moves as move, m (move.start)}
			{@const tint = speedTints[m]}
			{@const from = departureOf(store.keyframes[move.start])}
			{@const to = store.keyframes[move.end].t}
			<button
				type="button"
				class="move {move.kind}"
				class:selected={store.selectedMove?.start === move.start}
				data-start={move.start}
				style="left: {pct(from)}%; width: {pct(to) - pct(from)}%"
				onclick={() => store.selectMove(move.start)}
				title="Move: {MOVE_KIND_LABELS[move.kind]}, {fmt(to - from)}s{speedNote(
					tint?.peak ?? 0
				)} — click to select"
				aria-label="Move from keyframe {move.start + 1} to {move.end + 1}: {MOVE_KIND_LABELS[
					move.kind
				]}"
			>
				<!-- One icon per stretch between two keyframes: a move through
				     waypoints shows its curve between each pair of them. -->
				{#each { length: move.end - move.start }, s (s)}
					{@const a = s === 0 ? from : store.keyframes[move.start + s].t}
					{@const b = store.keyframes[move.start + s + 1].t}
					<span
						class="stretch"
						style="left: {((a - from) / (to - from)) * 100}%; width: {((b - a) / (to - from)) *
							100}%"
					>
						<PathIcon icon={move.kind} size={14} />
					</span>
				{/each}
				{#if tint?.gradient}
					<span class="speed" style="background: {tint.gradient}"></span>
				{/if}
			</button>
		{/each}

		{#each store.keyframes as kf, i (i)}
			{@const hold = holdOf(kf)}
			{#if hold > 0}
				<!-- The time the camera rests on a stop. Dragging it moves the
				     keyframe, like dragging its marker. -->
				<div
					class="hold"
					class:selected={store.selectedIndex === i}
					style="left: {pct(kf.t)}%; width: {pct(kf.t + hold) - pct(kf.t)}%"
					onpointerdown={(e) => startDragMarker(e, i)}
					title="Stop {i + 1} rests for {fmt(hold)}s — {store.selectedIndex === i
						? 'drag to retime'
						: 'click to select, then drag to retime'}"
					role="presentation"
				></div>
			{/if}
			{#if !kf.waypoint && (hold > 0 || store.selectedIndex === i)}
				<button
					type="button"
					class="hold-handle"
					class:detached={hold === 0}
					class:selected={store.selectedIndex === i}
					style="left: {pct(kf.t + hold)}%"
					onpointerdown={(e) => startDragHold(e, i)}
					title={store.selectedIndex !== i
						? `Rests for ${fmt(hold)}s — click to select, then drag to change`
						: hold > 0
							? `Rests for ${fmt(hold)}s — drag to change. Everything after moves along.`
							: 'Drag right to let the camera rest here. Everything after moves along.'}
					aria-label="Hold time of stop {i + 1}"
				></button>
			{/if}
		{/each}

		{#each store.keyframes as kf, i (i)}
			<button
				type="button"
				class="marker"
				class:selected={store.selectedIndex === i}
				class:waypoint={kf.waypoint}
				style="left: {pct(kf.t)}%"
				onpointerdown={(e) => startDragMarker(e, i)}
				title="{kf.waypoint ? 'Waypoint' : 'Stop'} {i + 1} at {fmt(
					kf.t
				)}s — {store.selectedIndex === i
					? 'drag to retime'
					: 'click to select, then drag to retime'}"
				aria-label="{kf.waypoint ? 'Waypoint' : 'Stop'} {i + 1}"
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
			{@const resolvedSel = resolveAnnotation(selAnn, store.defaultAnnotation)}
			{@const annColor = resolvedSel.iconColor}
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
							pct(vFrom - fIn)}%; background: {annColor};"
						title="Fade in {fIn.toFixed(2)}s"
						aria-hidden="true"
					></div>
				{/if}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<!-- tabindex is only set when role is 'slider' (i.e. when the bar is
				     interactive); the static check can't see that correlation. -->
				<div
					class="ann-bar"
					class:draggable={barDraggable}
					style="left: {pct(barL)}%; width: {pct(barR) - pct(barL)}%; background: {annColor};"
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
							pct(vUntil)}%; background: {annColor};"
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

		&:focus {
			outline: 1px solid #4a9eff;
			outline-offset: -1px;
		}
		&:active {
			cursor: ew-resize;
		}
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
	/* One band per move, from the stop it starts at to the stop it ends on,
	   behind the keyframe markers. The colour says how the camera travels. */
	.move {
		--move-color: 74, 158, 255;
		position: absolute;
		top: 50%;
		height: 18px;
		transform: translateY(-50%);
		box-sizing: border-box;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(var(--move-color), 0.22);
		border: 1px solid rgba(var(--move-color), 0.55);
		border-radius: 3px;
		color: rgb(var(--move-color));
		cursor: pointer;
		overflow: hidden;

		&.linear {
			--move-color: 63, 200, 170;
		}
		&.curve {
			--move-color: 190, 150, 255;
		}
		&:hover {
			background: rgba(var(--move-color), 0.35);
		}
		&.selected {
			background: rgba(255, 210, 74, 0.3);
			border-color: #ffd24a;
			color: #ffd24a;
		}
		.stretch {
			position: absolute;
			top: 0;
			bottom: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			pointer-events: none;
			/* For hiding the icon when its stretch gets too narrow for it. */
			container-type: inline-size;
		}
		@container (max-width: 40px) {
			:global(svg) {
				display: none;
			}
		}
		/* Strip that marks where the picture moves too fast — see `speedTint`. */
		.speed {
			position: absolute;
			left: 0;
			right: 0;
			bottom: 0;
			height: 5px;
			pointer-events: none;
		}
	}
	/* A stop that rests: a solid block from arrival to departure, in the
	   colour of the keyframe markers, with a grip on its right edge. */
	.hold {
		position: absolute;
		top: 50%;
		height: 18px;
		transform: translateY(-50%);
		box-sizing: border-box;
		background: #4a9eff;
		border: 1px solid #fff;
		border-radius: 3px;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
		/* Only the selected keyframe can be dragged; the cursor says which. */
		cursor: pointer;

		&.selected {
			background: #ffd24a;
			cursor: ew-resize;
		}
	}
	.hold-handle {
		position: absolute;
		top: 50%;
		width: 9px;
		height: 26px;
		/* Sits on the block's right edge, mostly inside it. */
		transform: translate(-7px, -50%);
		padding: 0;
		background: #fff;
		border: 1px solid rgba(0, 0, 0, 0.6);
		border-radius: 3px;
		cursor: pointer;

		&.selected {
			background: #ffd24a;
			cursor: col-resize;
		}
		/* No hold yet: the grip stands right of the diamond, ready to be pulled out. */
		&.detached {
			transform: translate(11px, -50%);
			height: 18px;
			opacity: 0.85;
		}
	}
	.marker {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 20px;
		height: 20px;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;

		&.selected {
			cursor: ew-resize;
		}
		&.selected .diamond {
			background: #ffd24a;
		}
		/* A waypoint is flown through, so it is a small round dot instead of
		   the diamond the camera rests on. */
		&.waypoint .diamond {
			width: 10px;
			height: 10px;
			border-radius: 50%;
		}
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

		&.draggable {
			pointer-events: auto;
			cursor: grab;

			&:active {
				cursor: grabbing;
			}
		}
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

		&.inner {
			width: 4px;
			height: 16px;
			border-radius: 1px;
			z-index: 2;
		}
		&.outer {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			z-index: 3;
			/* Sit at the bottom of the lane, where the fade triangle's "0 height"
			   tip actually is — the centered position floated above empty space
			   and looked disconnected from the triangle it controls. */
			top: 100%;
		}
		&:hover {
			background: #4a9eff;
			border-color: #fff;
		}
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

		&:active {
			cursor: grabbing;
			background: rgba(74, 158, 255, 0.75);
		}
	}
	.thumb-handle {
		flex: 0 0 6px;
		background: #4a9eff;
		cursor: ew-resize;

		&:hover {
			background: #6fb1ff;
		}
	}
	.thumb-handle-left {
		border-radius: 4px 0 0 4px;
	}
	.thumb-handle-right {
		border-radius: 0 4px 4px 0;
	}
</style>
