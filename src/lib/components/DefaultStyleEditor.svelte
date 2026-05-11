<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import {
		familyLabel,
		FONT_GROUPS,
		fontVariantLabel,
		haloAuto,
		makeOnNum,
		makeOnText,
		normalizeHex,
		POSITION_GRID,
		shortName
	} from '../annotation_panel_helpers';
	import { spritePreviewStyle } from '../sprite_meta';
	import {
		ANNOTATION_ICONS,
		DEFAULT_ANNOTATION_COLOR,
		DEFAULT_ANNOTATION_ICON,
		DEFAULT_ANNOTATION_LABEL_COLOR,
		DEFAULT_ANNOTATION_LABEL_FONT,
		DEFAULT_ICON_HALO_COLOR,
		DEFAULT_ICON_HALO_WIDTH,
		DEFAULT_LABEL_DISTANCE,
		DEFAULT_LABEL_HALO_WIDTH,
		DEFAULT_LABEL_POSITION,
		type Annotation,
		type AnnotationIcon,
		type AnnotationLabelFont
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

	let iconMenuOpen = $state(false);
	let iconMenuEl: HTMLDivElement | undefined = $state();

	function onIcon(icon: AnnotationIcon) {
		patchDefault({ icon });
		iconMenuOpen = false;
	}
	function onLabelFont(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value as AnnotationLabelFont;
		patchDefault({ labelFont: v });
	}

	function handleDocClick(e: MouseEvent) {
		if (iconMenuOpen && iconMenuEl && !iconMenuEl.contains(e.target as Node)) iconMenuOpen = false;
	}
	$effect(() => {
		document.addEventListener('click', handleDocClick);
		return () => document.removeEventListener('click', handleDocClick);
	});
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
	<div class="icon-dropdown" bind:this={iconMenuEl}>
		<button
			type="button"
			class="icon-trigger"
			onclick={() => (iconMenuOpen = !iconMenuOpen)}
			aria-haspopup="listbox"
			aria-expanded={iconMenuOpen}
			title={defaults.icon ?? DEFAULT_ANNOTATION_ICON}
		>
			<span
				class="icon-prev"
				style={spritePreviewStyle(defaults.icon ?? DEFAULT_ANNOTATION_ICON, 22)}
			></span>
			<span class="icon-name">{shortName(defaults.icon ?? DEFAULT_ANNOTATION_ICON)}</span>
			<span class="caret" aria-hidden="true">▾</span>
		</button>
		{#if iconMenuOpen}
			<ul class="icon-menu" role="listbox" aria-label="Default icon">
				{#each ANNOTATION_ICONS as icon (icon)}
					<li>
						<button
							type="button"
							class="icon-option"
							class:selected={(defaults.icon ?? DEFAULT_ANNOTATION_ICON) === icon}
							onclick={() => onIcon(icon)}
							role="option"
							aria-selected={(defaults.icon ?? DEFAULT_ANNOTATION_ICON) === icon}
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
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('icon')}
		disabled={!isDefaultSet('icon')}
		title="Reset shape to the hardcoded default"
		aria-label="Reset default shape">⟲</button
	>
</div>

<label class="row">
	<span class="lbl">Color</span>
	<input
		type="color"
		value={normalizeHex(defaults.iconColor ?? DEFAULT_ANNOTATION_COLOR)}
		oninput={onText('iconColor')}
		aria-label="Default icon color"
	/>
	<span class="hex">{defaults.iconColor ?? DEFAULT_ANNOTATION_COLOR}</span>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('iconColor')}
		disabled={!isDefaultSet('iconColor')}
		title="Reset icon color to the hardcoded default"
		aria-label="Reset default icon color">⟲</button
	>
</label>

<div class="row">
	<span class="lbl">Halo</span>
	<input
		type="color"
		value={normalizeHex(defaults.iconHaloColor ?? DEFAULT_ICON_HALO_COLOR)}
		oninput={onText('iconHaloColor')}
		aria-label="Default icon halo color"
	/>
	<input
		class="halo-width"
		type="range"
		min="0"
		max="4"
		step="0.1"
		value={defaults.iconHaloWidth ?? DEFAULT_ICON_HALO_WIDTH}
		oninput={onNum('iconHaloWidth')}
		aria-label="Default icon halo width"
	/>
	<span class="num">{(defaults.iconHaloWidth ?? DEFAULT_ICON_HALO_WIDTH).toFixed(1)}</span>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('iconHaloColor', 'iconHaloWidth')}
		disabled={!isDefaultSet('iconHaloColor', 'iconHaloWidth')}
		title="Reset icon halo to the hardcoded default"
		aria-label="Reset default icon halo">⟲</button
	>
</div>

<label class="row">
	<span class="lbl">Size</span>
	<input
		type="range"
		min="0.4"
		max="2.5"
		step="0.05"
		value={defaults.iconSize ?? 1}
		oninput={onNum('iconSize')}
	/>
	<span class="num">{(defaults.iconSize ?? 1).toFixed(2)}×</span>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('iconSize')}
		disabled={!isDefaultSet('iconSize')}
		title="Reset icon size to the hardcoded default"
		aria-label="Reset default icon size">⟲</button
	>
</label>

<!-- Label -->
<h3 class="section">Default label</h3>

<label class="row">
	<span class="lbl">Font</span>
	<select
		class="font-select"
		value={defaults.labelFont ?? DEFAULT_ANNOTATION_LABEL_FONT}
		onchange={onLabelFont}
	>
		{#each FONT_GROUPS as g (g.family)}
			<optgroup label={familyLabel(g.family)}>
				{#each g.fonts as f (f)}
					<option value={f}>{fontVariantLabel(f)}</option>
				{/each}
			</optgroup>
		{/each}
	</select>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('labelFont')}
		disabled={!isDefaultSet('labelFont')}
		title="Reset font to the hardcoded default"
		aria-label="Reset default font">⟲</button
	>
</label>

<label class="row">
	<span class="lbl">Color</span>
	<input
		type="color"
		value={normalizeHex(defaults.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)}
		oninput={onText('labelColor')}
		aria-label="Default label color"
	/>
	<span class="hex">{defaults.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR}</span>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('labelColor')}
		disabled={!isDefaultSet('labelColor')}
		title="Reset label color to the hardcoded default"
		aria-label="Reset default label color">⟲</button
	>
</label>

<div class="row">
	<span class="lbl">Halo</span>
	<input
		type="color"
		value={normalizeHex(
			defaults.labelHaloColor ?? haloAuto(defaults.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)
		)}
		oninput={onText('labelHaloColor')}
		aria-label="Default label halo color"
	/>
	<input
		class="halo-width"
		type="range"
		min="0"
		max="4"
		step="0.1"
		value={defaults.labelHaloWidth ?? DEFAULT_LABEL_HALO_WIDTH}
		oninput={onNum('labelHaloWidth')}
		aria-label="Default label halo width"
	/>
	<span class="num">{(defaults.labelHaloWidth ?? DEFAULT_LABEL_HALO_WIDTH).toFixed(1)}</span>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('labelHaloColor', 'labelHaloWidth')}
		disabled={!isDefaultSet('labelHaloColor', 'labelHaloWidth')}
		title="Reset label halo to the hardcoded default"
		aria-label="Reset default label halo">⟲</button
	>
</div>

<label class="row">
	<span class="lbl">Size</span>
	<input
		type="range"
		min="0.4"
		max="2.5"
		step="0.05"
		value={defaults.labelSize ?? 1}
		oninput={onNum('labelSize')}
	/>
	<span class="num">{(defaults.labelSize ?? 1).toFixed(2)}×</span>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('labelSize')}
		disabled={!isDefaultSet('labelSize')}
		title="Reset label size to the hardcoded default"
		aria-label="Reset default label size">⟲</button
	>
</label>

<div class="row">
	<span class="lbl">Side</span>
	<div class="pos-grid">
		{#each POSITION_GRID as p (p.value)}
			<button
				type="button"
				class:active={(defaults.labelPosition ?? DEFAULT_LABEL_POSITION) === p.value}
				onclick={() => patchDefault({ labelPosition: p.value })}
				title={p.value}
				aria-label={`Default label position ${p.value}`}
			>
				{p.label}
			</button>
		{/each}
	</div>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('labelPosition')}
		disabled={!isDefaultSet('labelPosition')}
		title="Reset label position to the hardcoded default"
		aria-label="Reset default label position">⟲</button
	>
</div>

<label class="row">
	<span class="lbl">Gap</span>
	<input
		type="range"
		min="0"
		max="5"
		step="0.1"
		value={defaults.labelDistance ?? DEFAULT_LABEL_DISTANCE}
		oninput={onNum('labelDistance')}
	/>
	<span class="num">{(defaults.labelDistance ?? DEFAULT_LABEL_DISTANCE).toFixed(1)}</span>
	<button
		type="button"
		class="mini reset"
		onclick={() => unsetDefaults('labelDistance')}
		disabled={!isDefaultSet('labelDistance')}
		title="Reset gap to the hardcoded default"
		aria-label="Reset default gap">⟲</button
	>
</label>

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
	.font-select {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.25rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
		font-size: 12px;
		cursor: pointer;

		&:hover,
		&:focus {
			border-color: #4a9eff;
			outline: none;
		}
	}

	.num,
	.hex {
		font-variant-numeric: tabular-nums;
		color: #aaa;
		font-size: 11px;
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

		&:hover {
			border-color: #4a9eff;
		}
		.icon-name {
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.caret {
			color: #888;
			font-size: 11px;
		}
	}
	.icon-prev {
		position: relative;
		display: inline-block;
		flex: 0 0 auto;
		border-radius: 2px;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			background-image: var(--sprite-bg);
			background-position: var(--sprite-pos);
			background-size: var(--sprite-size);
			background-repeat: no-repeat;
			filter: invert(1);
			transform: rotate(var(--sprite-rotate, 0deg));
		}
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

		li {
			margin: 0;
		}
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

		&:hover {
			background: rgba(74, 158, 255, 0.12);
			border-color: rgba(74, 158, 255, 0.4);
		}
		&.selected {
			background: rgba(74, 158, 255, 0.18);
			border-color: #4a9eff;
			color: #fff;
		}
		.icon-name {
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
	.pos-grid {
		display: grid;
		grid-template-columns: repeat(3, 22px);
		grid-template-rows: repeat(3, 22px);
		gap: 2px;

		button {
			padding: 0;
			background: rgba(255, 255, 255, 0.04);
			border: 1px solid #2a2f37;
			border-radius: 3px;
			color: #888;
			font:
				14px/1 ui-monospace,
				monospace;
			cursor: pointer;

			&:hover {
				border-color: #4a9eff;
				color: #ddd;
			}
			&.active {
				background: rgba(74, 158, 255, 0.18);
				border-color: #4a9eff;
				color: #fff;
			}
		}
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
</style>
