<script lang="ts">
	import { normalizeHex } from '../annotation_panel_helpers';

	let {
		color,
		onColorChange,
		width,
		onWidthChange,
		onReset,
		canReset = true,
		colorAriaLabel = 'Halo color',
		widthAriaLabel = 'Halo width',
		colorTitle,
		widthTitle = 'Halo width in px. 0 turns the halo off.',
		resetTitle = 'Reset halo to the current default',
		resetAriaLabel = 'Reset halo'
	}: {
		color: string;
		onColorChange: (e: Event) => void;
		width: number;
		onWidthChange: (e: Event) => void;
		onReset: () => void;
		canReset?: boolean;
		colorAriaLabel?: string;
		widthAriaLabel?: string;
		colorTitle?: string;
		widthTitle?: string;
		resetTitle?: string;
		resetAriaLabel?: string;
	} = $props();
</script>

<div class="row">
	<span class="lbl">Halo</span>
	<input
		type="color"
		value={normalizeHex(color)}
		oninput={onColorChange}
		aria-label={colorAriaLabel}
		title={colorTitle}
	/>
	<input
		class="halo-width"
		type="range"
		min="0"
		max="4"
		step="0.1"
		value={width}
		oninput={onWidthChange}
		aria-label={widthAriaLabel}
		title={widthTitle}
	/>
	<span class="num">{width.toFixed(1)}</span>
	<button
		type="button"
		class="mini reset"
		onclick={onReset}
		disabled={!canReset}
		title={resetTitle}
		aria-label={resetAriaLabel}>⟲</button
	>
</div>

<style>
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
	.num {
		font-variant-numeric: tabular-nums;
		color: #aaa;
		font-size: 11px;
	}
	.mini {
		padding: 0.2rem 0.35rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 3px;
		color: #aaa;
		font: inherit;
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
		flex: 0 0 auto;

		&:hover:not(:disabled) {
			border-color: #4a9eff;
			color: #ddd;
		}
		&:disabled {
			opacity: 0.35;
			cursor: not-allowed;
		}
	}
</style>
