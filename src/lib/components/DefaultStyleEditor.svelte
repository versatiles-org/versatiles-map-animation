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
		DEFAULT_ANNOTATION_COLOR,
		DEFAULT_ANNOTATION_ICON,
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

	const defaults = $derived(store.defaultAnnotation);

	function patchDefault(p: Partial<Annotation>): void {
		store.defaultAnnotation = { ...store.defaultAnnotation, ...p };
	}
	function unsetDefaults(...keys: (keyof Annotation)[]): void {
		const next = { ...store.defaultAnnotation };
		for (const k of keys) delete next[k];
		store.defaultAnnotation = next;
	}
	function isDefaultSet(...keys: (keyof Annotation)[]): boolean {
		return keys.some((k) => k in store.defaultAnnotation);
	}

	const onText = makeOnText(patchDefault);
	const onNum = makeOnNum(patchDefault);
</script>

<div class="default-style-header">
	<h3 class="section">Default style</h3>
	<button
		type="button"
		class="mini"
		onclick={() => (store.defaultAnnotation = {})}
		disabled={Object.keys(store.defaultAnnotation).length === 0}
		title="Clear every default — new markers fall back to the hardcoded baseline"
	>
		Reset all
	</button>
</div>
<p class="hint">
	Style applied to <strong>new</strong> markers (Pin button). Doesn't change existing ones. The
	<strong>⟲</strong> next to each row clears just that field.
</p>

<!-- Icon -->
<div class="row">
	<span class="lbl">Shape</span>
	<IconPicker
		value={defaults.icon ?? DEFAULT_ANNOTATION_ICON}
		onChange={(icon) => patchDefault({ icon })}
		ariaLabel="Default icon"
	/>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('icon')}
		disabled={!isDefaultSet('icon')}
		title="Reset shape to the hardcoded default"
		aria-label="Reset default shape">⟲</button
	>
</div>

<ColorRow
	label="Color"
	value={defaults.iconColor ?? DEFAULT_ANNOTATION_COLOR}
	onColorChange={onText('iconColor')}
	onReset={() => unsetDefaults('iconColor')}
	canReset={isDefaultSet('iconColor')}
	colorAriaLabel="Default icon color"
	resetTitle="Reset icon color to the hardcoded default"
	resetAriaLabel="Reset default icon color"
/>

<HaloRow
	color={defaults.iconHaloColor ?? DEFAULT_ICON_HALO_COLOR}
	onColorChange={onText('iconHaloColor')}
	width={defaults.iconHaloWidth ?? DEFAULT_ICON_HALO_WIDTH}
	onWidthChange={onNum('iconHaloWidth')}
	onReset={() => unsetDefaults('iconHaloColor', 'iconHaloWidth')}
	canReset={isDefaultSet('iconHaloColor', 'iconHaloWidth')}
	colorAriaLabel="Default icon halo color"
	widthAriaLabel="Default icon halo width"
	resetTitle="Reset icon halo to the hardcoded default"
	resetAriaLabel="Reset default icon halo"
/>

<SliderRow
	label="Size"
	value={defaults.iconSize ?? 1}
	min={0.4}
	max={2.5}
	step={0.05}
	onChange={onNum('iconSize')}
	formatValue={(v) => `${v.toFixed(2)}×`}
	onReset={() => unsetDefaults('iconSize')}
	canReset={isDefaultSet('iconSize')}
	resetTitle="Reset icon size to the hardcoded default"
	resetAriaLabel="Reset default icon size"
/>

<!-- Label -->
<h3 class="section">Default label</h3>

<label class="row">
	<span class="lbl">Font</span>
	<FontSelect
		value={defaults.labelFont ?? DEFAULT_ANNOTATION_LABEL_FONT}
		onChange={(font) => patchDefault({ labelFont: font })}
	/>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('labelFont')}
		disabled={!isDefaultSet('labelFont')}
		title="Reset font to the hardcoded default"
		aria-label="Reset default font">⟲</button
	>
</label>

<ColorRow
	label="Color"
	value={defaults.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR}
	onColorChange={onText('labelColor')}
	onReset={() => unsetDefaults('labelColor')}
	canReset={isDefaultSet('labelColor')}
	colorAriaLabel="Default label color"
	resetTitle="Reset label color to the hardcoded default"
	resetAriaLabel="Reset default label color"
/>

<HaloRow
	color={defaults.labelHaloColor ?? haloAuto(defaults.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)}
	onColorChange={onText('labelHaloColor')}
	width={defaults.labelHaloWidth ?? DEFAULT_LABEL_HALO_WIDTH}
	onWidthChange={onNum('labelHaloWidth')}
	onReset={() => unsetDefaults('labelHaloColor', 'labelHaloWidth')}
	canReset={isDefaultSet('labelHaloColor', 'labelHaloWidth')}
	colorAriaLabel="Default label halo color"
	widthAriaLabel="Default label halo width"
	resetTitle="Reset label halo to the hardcoded default"
	resetAriaLabel="Reset default label halo"
/>

<SliderRow
	label="Size"
	value={defaults.labelSize ?? 1}
	min={0.4}
	max={2.5}
	step={0.05}
	onChange={onNum('labelSize')}
	formatValue={(v) => `${v.toFixed(2)}×`}
	onReset={() => unsetDefaults('labelSize')}
	canReset={isDefaultSet('labelSize')}
	resetTitle="Reset label size to the hardcoded default"
	resetAriaLabel="Reset default label size"
/>

<PositionGrid
	value={defaults.labelPosition ?? DEFAULT_LABEL_POSITION}
	onChange={(labelPosition) => patchDefault({ labelPosition })}
	onReset={() => unsetDefaults('labelPosition')}
	canReset={isDefaultSet('labelPosition')}
	ariaPrefix="Default label position"
	resetTitle="Reset label position to the hardcoded default"
	resetAriaLabel="Reset default label position"
/>

<SliderRow
	label="Gap"
	value={defaults.labelDistance ?? DEFAULT_LABEL_DISTANCE}
	min={0}
	max={5}
	step={0.1}
	onChange={onNum('labelDistance')}
	formatValue={(v) => v.toFixed(1)}
	onReset={() => unsetDefaults('labelDistance')}
	canReset={isDefaultSet('labelDistance')}
	resetTitle="Reset gap to the hardcoded default"
	resetAriaLabel="Reset default gap"
/>

<style>
	.section {
		margin: 0.4rem 0 0.1rem;
		padding: 0.2rem 0 0.15rem;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: #888;
		border-top: 1px solid #2a2f37;
	}
	.default-style-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;

		.section {
			margin: 0;
			border-top: none;
			padding: 0;
			flex: 1 1 auto;
		}
	}
	.hint {
		margin: 0.2rem 0;
		font-size: 11px;
		color: #888;
		line-height: 1.45;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.45rem;

		.lbl {
			flex: 0 0 auto;
			width: 60px;
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #888;
		}
	}

	/* All field-row chrome (color/range inputs, .num/.hex readouts, the
	   icon picker, the halo combo, the font select, the position grid)
	   lives in scoped sub-components: ColorRow / SliderRow / IconPicker /
	   HaloRow / FontSelect / PositionGrid. */

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
</style>
