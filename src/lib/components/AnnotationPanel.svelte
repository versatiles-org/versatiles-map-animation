<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import { spritePreviewStyle } from '../sprite_meta';
	import {
		ANNOTATION_ICONS,
		DEFAULT_ANNOTATION_COLOR,
		DEFAULT_ANNOTATION_LABEL_COLOR,
		DEFAULT_LABEL_DISTANCE,
		DEFAULT_LABEL_POSITION,
		type Annotation,
		type AnnotationIcon,
		type LabelPosition
	} from '../types';

	let { store }: { store: AnimationStore } = $props();

	let iconMenuOpen = $state(false);
	let iconMenuEl: HTMLDivElement | undefined = $state();

	const ann = $derived(store.selectedAnnotation);
	const idx = $derived(store.selectedAnnotationIndex);

	function patch(p: Partial<Annotation>): void {
		if (idx !== null) store.updateAnnotation(idx, p);
	}

	function shortName(icon: string): string {
		return icon.replace(/^symbol-/, '').replace(/^icon-/, '');
	}
	function normalizeHex(c: string): string {
		// <input type=color> requires #rrggbb (no shorthand, no alpha). Falling
		// back to white prevents the picker from snapping to black on garbage.
		const six = /^#([0-9a-fA-F]{6})$/.exec(c.trim());
		if (six) return '#' + six[1].toLowerCase();
		const three = /^#([0-9a-fA-F]{3})$/.exec(c.trim());
		if (three) {
			const [r, g, b] = three[1];
			return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
		}
		return DEFAULT_ANNOTATION_COLOR;
	}

	function onLabel(e: Event) {
		patch({ label: (e.currentTarget as HTMLInputElement).value });
	}
	function onColor(e: Event) {
		patch({ color: (e.currentTarget as HTMLInputElement).value });
	}
	function onLabelColor(e: Event) {
		patch({ labelColor: (e.currentTarget as HTMLInputElement).value });
	}
	function onIcon(icon: AnnotationIcon) {
		patch({ icon });
		iconMenuOpen = false;
	}

	function handleDocClick(e: MouseEvent) {
		if (!iconMenuOpen || !iconMenuEl) return;
		if (!iconMenuEl.contains(e.target as Node)) iconMenuOpen = false;
	}

	$effect(() => {
		document.addEventListener('click', handleDocClick);
		return () => document.removeEventListener('click', handleDocClick);
	});
	function onRotation(e: Event) {
		patch({ rotation: Number((e.currentTarget as HTMLInputElement).value) });
	}
	function onIconSize(e: Event) {
		patch({ iconSize: Number((e.currentTarget as HTMLInputElement).value) });
	}
	function onLabelSize(e: Event) {
		patch({ labelSize: Number((e.currentTarget as HTMLInputElement).value) });
	}
	function onLabelPosition(p: LabelPosition) {
		patch({ labelPosition: p });
	}
	function onLabelDistance(e: Event) {
		patch({ labelDistance: Number((e.currentTarget as HTMLInputElement).value) });
	}

	// 3×3 grid of label-position options. The dot in the center represents
	// the icon; each surrounding slot is one cardinal/diagonal placement.
	const POSITION_GRID: { label: string; value: LabelPosition }[] = [
		{ label: '↖', value: 'top-left' },
		{ label: '↑', value: 'top' },
		{ label: '↗', value: 'top-right' },
		{ label: '←', value: 'left' },
		{ label: '·', value: 'center' },
		{ label: '→', value: 'right' },
		{ label: '↙', value: 'bottom-left' },
		{ label: '↓', value: 'bottom' },
		{ label: '↘', value: 'bottom-right' }
	];
	// Visibility/fade are time values displayed as numbers in the panel and
	// also driven by the timeline drag handles. Two invariants we enforce
	// uniformly here:
	//   1. visibleFrom + ANN_MIN_GAP ≤ visibleUntil (matches the timeline)
	//   2. fadeIn / fadeOut ≥ 0 and stay ≤ their reference bound
	// Plus we round all four to centi-second precision so dragged values
	// don't stick floating-point dust into the input fields.
	const ANN_MIN_GAP = 0.01;
	const round2 = (v: number) => Math.round(v * 100) / 100;

	function readNonNegativeOrUndefined(e: Event): number | undefined {
		const raw = (e.currentTarget as HTMLInputElement).value;
		if (raw === '') return undefined;
		const v = Number(raw);
		return Number.isFinite(v) ? Math.max(0, v) : undefined;
	}

	// Svelte 5 short-circuits `<input value={x}>` updates when `x` is unchanged
	// from the previous render — but the user's intermediate typing may have
	// changed the DOM in between, so the clamped value never makes it back to
	// the field. Force the DOM to mirror the clamped value after every patch.
	function syncInput(input: HTMLInputElement, v: number | undefined): void {
		const want = v === undefined ? '' : String(v);
		if (input.value !== want) input.value = want;
	}

	function onVisibleFrom(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = readNonNegativeOrUndefined(e);
		if (raw === undefined) {
			// Clearing the bound also resets its fade — a dangling fadeIn would
			// be silently invisible (the opacity helper ignores it when there's
			// no anchor) but would still persist via the codec, and re-enabling
			// the bound would surprise the user with a fade they didn't ask for.
			patch({ visibleFrom: undefined, fadeIn: 0 });
			return;
		}
		const until = ann?.visibleUntil;
		const max = until !== undefined ? until - ANN_MIN_GAP : Number.POSITIVE_INFINITY;
		const clamped = round2(Math.min(max, raw));
		patch({ visibleFrom: clamped });
		syncInput(input, clamped);
	}
	function onVisibleUntil(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = readNonNegativeOrUndefined(e);
		if (raw === undefined) {
			patch({ visibleUntil: undefined, fadeOut: 0 });
			return;
		}
		const from = ann?.visibleFrom;
		const min = from !== undefined ? from + ANN_MIN_GAP : 0;
		const clamped = round2(Math.max(min, raw));
		patch({ visibleUntil: clamped });
		syncInput(input, clamped);
	}
	function onClearFrom() {
		patch({ visibleFrom: undefined, fadeIn: 0 });
	}
	function onClearUntil() {
		patch({ visibleUntil: undefined, fadeOut: 0 });
	}
	function onFadeIn(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (!Number.isFinite(v)) {
			patch({ fadeIn: 0 });
			syncInput(input, 0);
			return;
		}
		// Fade-in can't extend past the visible-from time (would push the
		// fade-in tip into negative time). With no visibleFrom set, fade-in
		// has no anchor — clamp to a sane upper bound to keep the input tidy.
		const from = ann?.visibleFrom;
		const max = from !== undefined ? from : Number.POSITIVE_INFINITY;
		const clamped = round2(Math.max(0, Math.min(max, v)));
		patch({ fadeIn: clamped });
		syncInput(input, clamped);
	}
	function onFadeOut(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (!Number.isFinite(v)) {
			patch({ fadeOut: 0 });
			syncInput(input, 0);
			return;
		}
		const clamped = round2(Math.max(0, v));
		patch({ fadeOut: clamped });
		syncInput(input, clamped);
	}
	function onMoveHere() {
		const cam = store.liveCamera;
		patch({ lng: cam.lng, lat: cam.lat });
	}
	function onDelete() {
		if (idx !== null) store.deleteAnnotation(idx);
	}
	function onClose() {
		store.clearAnnotationSelection();
	}
</script>

<div class="annotation-panel">
	{#if ann && idx !== null}
		<div class="title-row">
			<span class="title">Annotation #{idx + 1}</span>
			<button
				type="button"
				class="close"
				onclick={onClose}
				aria-label="Deselect annotation"
				title="Deselect"
			>
				✕
			</button>
		</div>

		<label class="row">
			<span class="lbl">Label</span>
			<input type="text" value={ann.label} oninput={onLabel} placeholder="(no label)" />
		</label>

		<div class="row">
			<span class="lbl">Icon</span>
			<div class="icon-dropdown" bind:this={iconMenuEl}>
				<button
					type="button"
					class="icon-trigger"
					onclick={() => (iconMenuOpen = !iconMenuOpen)}
					aria-haspopup="listbox"
					aria-expanded={iconMenuOpen}
					title={ann.icon}
				>
					<span class="icon-prev" style={spritePreviewStyle(ann.icon, 22)}></span>
					<span class="icon-name">{shortName(ann.icon)}</span>
					<span class="caret" aria-hidden="true">▾</span>
				</button>
				{#if iconMenuOpen}
					<ul class="icon-menu" role="listbox" aria-label="Icon">
						{#each ANNOTATION_ICONS as icon (icon)}
							<li>
								<button
									type="button"
									class="icon-option"
									class:selected={ann.icon === icon}
									onclick={() => onIcon(icon)}
									role="option"
									aria-selected={ann.icon === icon}
									title={icon}
								>
									<span class="icon-prev" style={spritePreviewStyle(icon, 22)}></span>
									<span class="icon-name">{shortName(icon)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>

		<label class="row">
			<span class="lbl">Icon col</span>
			<input
				type="color"
				value={normalizeHex(ann.color)}
				oninput={onColor}
				aria-label="Icon color"
			/>
			<span class="hex">{ann.color}</span>
		</label>

		<label class="row">
			<span class="lbl">Label col</span>
			<input
				type="color"
				value={normalizeHex(ann.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)}
				oninput={onLabelColor}
				aria-label="Label color"
				title="Label text color. The halo automatically flips to a contrasting brightness to keep the label legible."
			/>
			<span class="hex">{ann.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR}</span>
		</label>

		<label class="row">
			<span class="lbl">Rotation</span>
			<input
				type="range"
				min="0"
				max="359"
				step="1"
				value={ann.rotation ?? 0}
				oninput={onRotation}
			/>
			<span class="num">{Math.round(ann.rotation ?? 0)}°</span>
		</label>

		<label class="row">
			<span class="lbl">Icon size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={ann.iconSize ?? 1}
				oninput={onIconSize}
			/>
			<span class="num">{(ann.iconSize ?? 1).toFixed(2)}×</span>
		</label>

		<label class="row">
			<span class="lbl">Label size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={ann.labelSize ?? 1}
				oninput={onLabelSize}
			/>
			<span class="num">{(ann.labelSize ?? 1).toFixed(2)}×</span>
		</label>

		<div class="row">
			<span class="lbl">Label pos</span>
			<div class="pos-grid">
				{#each POSITION_GRID as p (p.value)}
					<button
						type="button"
						class:active={(ann.labelPosition ?? DEFAULT_LABEL_POSITION) === p.value}
						onclick={() => onLabelPosition(p.value)}
						title={p.value}
						aria-label={`Place label ${p.value}`}
					>
						{p.label}
					</button>
				{/each}
			</div>
		</div>

		<label class="row">
			<span class="lbl">Label gap</span>
			<input
				type="range"
				min="0"
				max="5"
				step="0.1"
				value={ann.labelDistance ?? DEFAULT_LABEL_DISTANCE}
				oninput={onLabelDistance}
			/>
			<span class="num">{(ann.labelDistance ?? DEFAULT_LABEL_DISTANCE).toFixed(1)}</span>
		</label>

		<div class="row visibility">
			<span class="lbl">Visible</span>
			<div class="visibility-grid">
				<span class="sublbl">from</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={ann.visibleFrom ?? ''}
					oninput={onVisibleFrom}
					placeholder="start"
				/>
				<button
					type="button"
					class="mini"
					onclick={onClearFrom}
					disabled={ann.visibleFrom === undefined}
					title="Show from the start of the animation"
				>
					⟲
				</button>
				<span class="sublbl">until</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={ann.visibleUntil ?? ''}
					oninput={onVisibleUntil}
					placeholder="end"
				/>
				<button
					type="button"
					class="mini"
					onclick={onClearUntil}
					disabled={ann.visibleUntil === undefined}
					title="Show until the end of the animation"
				>
					⟲
				</button>
			</div>
		</div>

		<div class="row visibility">
			<span class="lbl">Fade</span>
			<div class="visibility-grid">
				<span class="sublbl">in</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={ann.fadeIn ?? 0}
					oninput={onFadeIn}
					disabled={ann.visibleFrom === undefined}
					title={ann.visibleFrom === undefined
						? 'Fade-in needs a "Visible from" time'
						: 'Seconds the marker takes to fade in before its visible-from time'}
					placeholder="0"
				/>
				<span class="sublbl">s</span>
				<span class="sublbl">out</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={ann.fadeOut ?? 0}
					oninput={onFadeOut}
					disabled={ann.visibleUntil === undefined}
					title={ann.visibleUntil === undefined
						? 'Fade-out needs a "Visible until" time'
						: 'Seconds the marker takes to fade out after its visible-until time'}
					placeholder="0"
				/>
				<span class="sublbl">s</span>
			</div>
		</div>

		<div class="row position">
			<span class="lbl">Position</span>
			<span class="coord">
				{ann.lat.toFixed(4)}, {ann.lng.toFixed(4)}
			</span>
			<button
				type="button"
				class="mini"
				onclick={onMoveHere}
				title="Move this annotation to the current map center"
			>
				⤴ Move here
			</button>
		</div>

		<footer>
			<button type="button" class="danger" onclick={onDelete}>✕ Delete</button>
		</footer>
	{:else}
		<p class="placeholder">
			No annotation selected. Click <strong>📍 Pin</strong> below to add one, or click an annotation marker
			on the map to edit it.
		</p>
	{/if}
</div>

<style>
	.annotation-panel {
		color: #ddd;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.placeholder {
		margin: 0.2rem 0;
		font-size: 12px;
		color: #888;
		line-height: 1.45;
	}
	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.15rem;
	}
	.title {
		font-size: 12px;
		font-weight: 600;
		color: #ccc;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.close {
		background: transparent;
		border: none;
		color: #888;
		cursor: pointer;
		padding: 0 0.2rem;
		font-size: 14px;
		line-height: 1;
	}
	.close:hover {
		color: #fff;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.row.visibility,
	.row.position {
		align-items: flex-start;
	}
	.row .lbl {
		flex: 0 0 auto;
		width: 60px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}

	input[type='text'],
	input[type='number'] {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.3rem 0.45rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
	}
	input[type='text']:focus,
	input[type='number']:focus {
		outline: none;
		border-color: #4a9eff;
	}
	input[type='color'] {
		width: 36px;
		height: 26px;
		padding: 0;
		background: transparent;
		border: 1px solid #333;
		border-radius: 4px;
		cursor: pointer;
	}
	input[type='range'] {
		flex: 1 1 auto;
		min-width: 0;
	}
	.num,
	.hex,
	.coord {
		font-variant-numeric: tabular-nums;
		color: #aaa;
		font-size: 11px;
	}
	.coord {
		flex: 1 1 auto;
	}

	.icon-dropdown {
		flex: 1 1 auto;
		position: relative;
		min-width: 0;
	}
	.icon-trigger {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.25rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.icon-trigger:hover {
		border-color: #4a9eff;
	}
	.icon-trigger .icon-name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.icon-trigger .caret {
		color: #888;
		font-size: 11px;
	}
	.icon-prev {
		position: relative;
		display: inline-block;
		flex: 0 0 auto;
		/* The atlas ships as black-on-transparent in the PNG. We render the
		   sprite via a ::after pseudo-element with `invert(1)` so the icon
		   pixels flip to white while the parent's black chip background stays
		   intact. Inline styles set `--sprite-bg / --sprite-pos / --sprite-size`. */
		border-radius: 2px;
	}
	.icon-prev::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image: var(--sprite-bg);
		background-position: var(--sprite-pos);
		background-size: var(--sprite-size);
		background-repeat: no-repeat;
		filter: invert(1);
	}
	.icon-menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 240px;
		overflow-y: auto;
		margin: 0;
		padding: 3px;
		list-style: none;
		background: #11161e;
		border: 1px solid #333;
		border-radius: 4px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
		z-index: 10;
	}
	.icon-menu li {
		margin: 0;
	}
	.icon-option {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.25rem 0.4rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 3px;
		color: #ccc;
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.icon-option:hover {
		background: rgba(74, 158, 255, 0.12);
		border-color: rgba(74, 158, 255, 0.4);
	}
	.icon-option.selected {
		background: rgba(74, 158, 255, 0.18);
		border-color: #4a9eff;
		color: #fff;
	}
	.icon-option .icon-name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pos-grid {
		display: grid;
		grid-template-columns: repeat(3, 22px);
		grid-template-rows: repeat(3, 22px);
		gap: 2px;
	}
	.pos-grid button {
		padding: 0;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #2a2f37;
		border-radius: 3px;
		color: #888;
		font:
			14px/1 ui-monospace,
			monospace;
		cursor: pointer;
	}
	.pos-grid button:hover {
		border-color: #4a9eff;
		color: #ddd;
	}
	.pos-grid button.active {
		background: rgba(74, 158, 255, 0.18);
		border-color: #4a9eff;
		color: #fff;
	}
	.visibility-grid {
		flex: 1 1 auto;
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.25rem 0.4rem;
		align-items: center;
	}
	.sublbl {
		color: #888;
		font-size: 11px;
	}

	.mini {
		padding: 0.2rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 3px;
		color: #aaa;
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	.mini:hover:not(:disabled) {
		border-color: #4a9eff;
		color: #ddd;
	}
	.mini:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.2rem;
	}
	.danger {
		padding: 0.3rem 0.6rem;
		background: rgba(255, 80, 80, 0.12);
		border: 1px solid rgba(255, 80, 80, 0.35);
		border-radius: 4px;
		color: #ffaaaa;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	.danger:hover {
		background: rgba(255, 80, 80, 0.22);
		color: #fff;
	}
</style>
