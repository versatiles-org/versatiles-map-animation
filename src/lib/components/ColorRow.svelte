<script lang="ts">
	import { normalizeHex } from '../annotation_panel_helpers';

	let {
		label,
		value,
		onColorChange,
		onReset,
		canReset = true,
		colorAriaLabel,
		colorTitle,
		resetTitle,
		resetAriaLabel
	}: {
		label: string;
		value: string;
		onColorChange: (e: Event) => void;
		onReset: () => void;
		canReset?: boolean;
		colorAriaLabel?: string;
		colorTitle?: string;
		resetTitle?: string;
		resetAriaLabel?: string;
	} = $props();
</script>

<label class="row">
	<span class="lbl">{label}</span>
	<input
		type="color"
		value={normalizeHex(value)}
		oninput={onColorChange}
		aria-label={colorAriaLabel ?? label}
		title={colorTitle}
	/>
	<span class="hex">{value}</span>
	<button
		type="button"
		class="mini reset"
		onclick={onReset}
		disabled={!canReset}
		title={resetTitle}
		aria-label={resetAriaLabel}>⟲</button
	>
</label>

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
	.hex {
		font-variant-numeric: tabular-nums;
		color: #aaa;
		font-size: 11px;
	}
	.mini {
		flex: 0 0 auto;
		padding: 0.2rem 0.35rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 3px;
		color: #aaa;
		font: inherit;
		font-size: 12px;
		line-height: 1;
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
</style>
