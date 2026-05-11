<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import { haloAuto, makeOnNum, makeOnText } from '../annotation_panel_helpers';
	import ColorRow from './ColorRow.svelte';
	import FontSelect from './FontSelect.svelte';
	import HaloRow from './HaloRow.svelte';
	import IconPicker from './IconPicker.svelte';
	import PositionGrid from './PositionGrid.svelte';
	import SliderRow from './SliderRow.svelte';
	import {
		ANNOTATION_FIELD_DEFAULTS,
		DEFAULT_ANNOTATION_LABEL_COLOR,
		DEFAULT_ANNOTATION_LABEL_FONT,
		DEFAULT_ICON_HALO_COLOR,
		DEFAULT_ICON_HALO_WIDTH,
		DEFAULT_LABEL_DISTANCE,
		DEFAULT_LABEL_HALO_WIDTH,
		DEFAULT_LABEL_POSITION,
		type Annotation
	} from '../types';

	let { store }: { store: AnimationStore } = $props();

	const ann = $derived(store.selectedAnnotation);
	const idx = $derived(store.selectedAnnotationIndex);

	function patch(p: Partial<Annotation>): void {
		if (idx !== null) store.updateAnnotation(idx, p);
	}

	const onText = makeOnText(patch);
	const onNum = makeOnNum(patch);

	/**
	 * Resolve a field on reset: user-defined default → hardcoded baseline
	 * (`ANNOTATION_FIELD_DEFAULTS`) → `undefined` (which `updateAnnotation`
	 * treats as "delete the override"). For required fields like `icon` /
	 * `iconColor` the table guarantees a real value; for present-only fields
	 * like `labelHaloColor` it's `undefined`, so the field is removed and
	 * the renderer's auto-flip kicks back in.
	 */
	function resetAnnFields(...keys: (keyof Annotation)[]): void {
		if (idx === null) return;
		const p: Record<string, unknown> = {};
		for (const k of keys) {
			const fromDefault = (store.defaultAnnotation as Record<string, unknown>)[k];
			const hardcoded = (ANNOTATION_FIELD_DEFAULTS as Record<string, unknown>)[k];
			p[k] = fromDefault ?? hardcoded;
		}
		store.updateAnnotation(idx, p as Partial<Annotation>);
	}
	function isAnnSet(...keys: (keyof Annotation)[]): boolean {
		return ann !== null && keys.some((k) => k in ann);
	}

	// Visibility/fade clamping. Two invariants:
	//   1. visibleFrom + ANN_MIN_GAP ≤ visibleUntil (matches the timeline)
	//   2. fadeIn / fadeOut ≥ 0 and stay ≤ their reference bound
	// Plus we round to centi-second precision so dragged values don't stick
	// floating-point dust into the input fields.
	const ANN_MIN_GAP = 0.01;
	const round2 = (v: number) => Math.round(v * 100) / 100;

	/**
	 * Force the DOM input to mirror the clamped value. Svelte 5 short-circuits
	 * `<input value={x}>` when `x` hasn't changed across renders — but the
	 * user's intermediate typing might have moved the DOM forward of the
	 * stored state, so we patch the DOM directly after each clamp.
	 */
	function syncInput(input: HTMLInputElement, v: number | undefined): void {
		const want = v === undefined ? '' : String(v);
		if (input.value !== want) input.value = want;
	}

	/**
	 * Build a clamped-time input handler shared by visibleFrom/Until and
	 * fadeIn/Out. The four were near-identical: read the value, clamp into
	 * `[getMin(), getMax()]`, round, patch, sync. The visibility variants
	 * additionally reset their associated fade when the user clears the field.
	 */
	function clampedTimeHandler(opts: {
		key: 'visibleFrom' | 'visibleUntil' | 'fadeIn' | 'fadeOut';
		getMin: () => number;
		getMax: () => number;
		/** Field to also reset when the user clears the input (visibility only). */
		clearAlso?: 'fadeIn' | 'fadeOut';
		/** Fades default to 0 instead of `undefined` on empty input. */
		emptyValue: number | undefined;
	}) {
		return (e: Event) => {
			const input = e.currentTarget as HTMLInputElement;
			const raw = input.value;
			if (raw === '' || !Number.isFinite(Number(raw))) {
				const reset: Partial<Annotation> = { [opts.key]: opts.emptyValue };
				if (opts.clearAlso) reset[opts.clearAlso] = 0;
				patch(reset);
				if (opts.emptyValue !== undefined) syncInput(input, opts.emptyValue);
				return;
			}
			const clamped = round2(Math.max(opts.getMin(), Math.min(opts.getMax(), Number(raw))));
			patch({ [opts.key]: clamped });
			syncInput(input, clamped);
		};
	}

	const onVisibleFrom = $derived(
		clampedTimeHandler({
			key: 'visibleFrom',
			getMin: () => 0,
			getMax: () =>
				ann?.visibleUntil !== undefined ? ann.visibleUntil - ANN_MIN_GAP : Number.POSITIVE_INFINITY,
			clearAlso: 'fadeIn',
			emptyValue: undefined
		})
	);
	const onVisibleUntil = $derived(
		clampedTimeHandler({
			key: 'visibleUntil',
			getMin: () => (ann?.visibleFrom !== undefined ? ann.visibleFrom + ANN_MIN_GAP : 0),
			getMax: () => Number.POSITIVE_INFINITY,
			clearAlso: 'fadeOut',
			emptyValue: undefined
		})
	);
	const onFadeIn = $derived(
		clampedTimeHandler({
			key: 'fadeIn',
			getMin: () => 0,
			// Fade-in can't push past visibleFrom (negative-time tip); with no
			// visibleFrom, leave it free.
			getMax: () => ann?.visibleFrom ?? Number.POSITIVE_INFINITY,
			emptyValue: 0
		})
	);
	const onFadeOut = $derived(
		clampedTimeHandler({
			key: 'fadeOut',
			getMin: () => 0,
			getMax: () => Number.POSITIVE_INFINITY,
			emptyValue: 0
		})
	);

	function onMoveHere() {
		const cam = store.liveCamera;
		patch({ lng: cam.lng, lat: cam.lat });
	}
	function onDelete() {
		if (idx !== null) store.deleteAnnotation(idx);
	}
	function onDuplicate() {
		if (idx !== null) store.duplicateAnnotation(idx);
	}
	function onClose() {
		store.clearAnnotationSelection();
	}
</script>

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

	<!-- Icon section: shape + appearance + orientation -->
	<h3 class="section">Icon</h3>

	<div class="row">
		<span class="lbl">Shape</span>
		<IconPicker value={ann.icon} onChange={(icon) => patch({ icon })} />
		<button
			type="button"
			class="mini reset"
			onclick={() => resetAnnFields('icon')}
			title="Reset shape to the current default"
			aria-label="Reset shape">⟲</button
		>
	</div>

	<ColorRow
		label="Color"
		value={ann.iconColor}
		onColorChange={onText('iconColor')}
		onReset={() => resetAnnFields('iconColor')}
		colorAriaLabel="Icon color"
		resetTitle="Reset color to the current default"
		resetAriaLabel="Reset icon color"
	/>

	<HaloRow
		color={ann.iconHaloColor ?? DEFAULT_ICON_HALO_COLOR}
		onColorChange={onText('iconHaloColor')}
		width={ann.iconHaloWidth ?? DEFAULT_ICON_HALO_WIDTH}
		onWidthChange={onNum('iconHaloWidth')}
		onReset={() => resetAnnFields('iconHaloColor', 'iconHaloWidth')}
		canReset={isAnnSet('iconHaloColor', 'iconHaloWidth')}
		colorAriaLabel="Icon halo color"
		widthAriaLabel="Icon halo width"
		colorTitle="Halo (icon outline) color. Default white; only visible when width > 0."
		widthTitle="Halo width in px. 0 turns the halo off (default)."
		resetTitle="Reset icon halo to the current default"
		resetAriaLabel="Reset icon halo"
	/>

	<SliderRow
		label="Size"
		value={ann.iconSize ?? 1}
		min={0.4}
		max={2.5}
		step={0.05}
		onChange={onNum('iconSize')}
		formatValue={(v) => `${v.toFixed(2)}×`}
		onReset={() => resetAnnFields('iconSize')}
		canReset={isAnnSet('iconSize')}
		resetTitle="Reset size to the current default"
		resetAriaLabel="Reset icon size"
	/>

	<SliderRow
		label="Rotation"
		value={ann.rotation ?? 0}
		min={0}
		max={359}
		step={1}
		onChange={onNum('rotation')}
		formatValue={(v) => `${Math.round(v)}°`}
		onReset={() => resetAnnFields('rotation')}
		canReset={isAnnSet('rotation')}
		resetTitle="Reset rotation to 0"
		resetAriaLabel="Reset rotation"
	/>

	<!-- Label section: text + appearance + placement -->
	<h3 class="section">Label</h3>

	<label class="row text-row">
		<span class="lbl">Text</span>
		<textarea
			class="label-text"
			value={ann.label}
			oninput={onText('label')}
			placeholder="(no label)"
			rows="2"
			title="Press Enter for a line break — MapLibre renders \\n as a hard wrap in the label."
		></textarea>
	</label>

	<label class="row">
		<span class="lbl">Font</span>
		<FontSelect
			value={ann.labelFont ?? DEFAULT_ANNOTATION_LABEL_FONT}
			onChange={(font) => patch({ labelFont: font })}
			title="Glyph font for this label. Drawn from the VersaTiles tileserver's bundled fonts."
		/>
		<button
			type="button"
			class="mini reset"
			onclick={() => resetAnnFields('labelFont')}
			disabled={!isAnnSet('labelFont')}
			title="Reset font to the current default"
			aria-label="Reset font">⟲</button
		>
	</label>

	<ColorRow
		label="Color"
		value={ann.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR}
		onColorChange={onText('labelColor')}
		onReset={() => resetAnnFields('labelColor')}
		canReset={isAnnSet('labelColor')}
		colorAriaLabel="Label color"
		colorTitle="Label text color. The halo defaults to a contrasting brightness; override below."
		resetTitle="Reset label color to the current default"
		resetAriaLabel="Reset label color"
	/>

	<HaloRow
		color={ann.labelHaloColor ?? haloAuto(ann.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)}
		onColorChange={onText('labelHaloColor')}
		width={ann.labelHaloWidth ?? DEFAULT_LABEL_HALO_WIDTH}
		onWidthChange={onNum('labelHaloWidth')}
		onReset={() => resetAnnFields('labelHaloColor', 'labelHaloWidth')}
		canReset={isAnnSet('labelHaloColor', 'labelHaloWidth')}
		colorAriaLabel="Label halo color"
		widthAriaLabel="Label halo width"
		colorTitle="Halo (text outline) color. Defaults to a contrasting brightness; pick to override."
		widthTitle="Halo width in px. 0 turns the halo off."
		resetTitle="Reset label halo to the current default"
		resetAriaLabel="Reset label halo"
	/>

	<SliderRow
		label="Size"
		value={ann.labelSize ?? 1}
		min={0.4}
		max={2.5}
		step={0.05}
		onChange={onNum('labelSize')}
		formatValue={(v) => `${v.toFixed(2)}×`}
		onReset={() => resetAnnFields('labelSize')}
		canReset={isAnnSet('labelSize')}
		resetTitle="Reset label size to the current default"
		resetAriaLabel="Reset label size"
	/>

	<PositionGrid
		value={ann.labelPosition ?? DEFAULT_LABEL_POSITION}
		onChange={(labelPosition) => patch({ labelPosition })}
		onReset={() => resetAnnFields('labelPosition')}
		canReset={isAnnSet('labelPosition')}
		resetTitle="Reset label position to the current default"
		resetAriaLabel="Reset label position"
	/>

	<SliderRow
		label="Gap"
		value={ann.labelDistance ?? DEFAULT_LABEL_DISTANCE}
		min={0}
		max={5}
		step={0.1}
		onChange={onNum('labelDistance')}
		formatValue={(v) => v.toFixed(1)}
		onReset={() => resetAnnFields('labelDistance')}
		canReset={isAnnSet('labelDistance')}
		resetTitle="Reset gap to the current default"
		resetAriaLabel="Reset gap"
	/>

	<!-- Visibility section: time window + fade tails -->
	<h3 class="section">Visibility</h3>

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
				onclick={() => patch({ visibleFrom: undefined, fadeIn: 0 })}
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
				onclick={() => patch({ visibleUntil: undefined, fadeOut: 0 })}
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

	<!-- Position section: lat/lng + helper -->
	<h3 class="section">Position</h3>

	<div class="row position">
		<span class="lbl">Coords</span>
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
		<button
			type="button"
			class="footer-btn"
			onclick={onDuplicate}
			title="Clone this annotation slightly offset from the original"
		>
			⧉ Duplicate
		</button>
		<button type="button" class="danger" onclick={onDelete}>✕ Delete</button>
	</footer>
{/if}

<style>
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

		&:hover {
			color: #fff;
		}
	}

	.section {
		margin: 0.4rem 0 0.1rem;
		padding: 0.2rem 0 0.15rem;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: #888;
		border-top: 1px solid #2a2f37;

		&:first-of-type {
			border-top: none;
			margin-top: 0.1rem;
		}
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.45rem;

		&.visibility,
		&.position {
			align-items: flex-start;
		}
		.lbl {
			flex: 0 0 auto;
			width: 60px;
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #888;
		}
	}

	input[type='number'],
	.label-text {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.3rem 0.45rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;

		&:focus {
			outline: none;
			border-color: #4a9eff;
		}
	}
	.label-text {
		resize: vertical;
		min-height: 2.4rem;
		line-height: 1.3;
		font-family: inherit;
	}
	.text-row {
		align-items: flex-start;

		.lbl {
			padding-top: 0.4rem;
		}
	}
	/* Color/range/font-select/.num/.hex styles live in their respective
	   sub-components (ColorRow, SliderRow, FontSelect, HaloRow). */
	.coord {
		font-variant-numeric: tabular-nums;
		color: #aaa;
		font-size: 11px;
		flex: 1 1 auto;
	}

	/* Icon-picker styles live in IconPicker.svelte; halo-row styles live in
	   HaloRow.svelte. Both are scoped, so nothing leaks back here. */
	/* `.pos-grid` styles live in PositionGrid.svelte. */
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

		&:hover:not(:disabled) {
			border-color: #4a9eff;
			color: #ddd;
		}
		&:disabled {
			opacity: 0.35;
			cursor: not-allowed;
		}
	}
	.mini.reset {
		flex: 0 0 auto;
		padding: 0.2rem 0.35rem;
		font-size: 12px;
		line-height: 1;
	}

	footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
		margin-top: 0.2rem;
	}
	.footer-btn {
		padding: 0.3rem 0.6rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
		font-size: 12px;
		cursor: pointer;

		&:hover {
			background: rgba(255, 255, 255, 0.12);
			border-color: #4a9eff;
		}
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

		&:hover {
			background: rgba(255, 80, 80, 0.22);
			color: #fff;
		}
	}
</style>
